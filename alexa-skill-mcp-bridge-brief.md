# Brief for Claude Code: `alexa-skill-mcp-bridge`

Read this whole document before writing code. Section 12 lists things that must be verified against live AWS behavior on day one; do those first.

---

## 1. What this is

An open-source bridge that lets a developer test their MCP server on a physical Alexa device (Echo) as if it were an Alexa+ add-on, before they have access to Amazon's Alexa+ add-on tooling.

The developer clones the repo, puts their MCP server URL into one config file, runs a generator that turns the server's tools into an Alexa interaction model, deploys one CDK stack, deploys the Alexa Skill with the ASK CLI, and talks to their MCP server through an Echo. An LLM agent (Amazon Bedrock AgentCore Runtime, Strands Agents, Amazon Nova 2 Lite) does what the Alexa+ orchestrator would do: picks the tool, fills arguments, handles elicitation, turns tool results into short spoken answers, and keeps conversation context.

Context: this is a community contribution for an Alexa+ hackathon and may itself be entered in the hackathon's open-source mini-challenge. Hackathon MCP servers must speak MCP spec **2025-11-25 or later over Streamable HTTP**. Alexa+ itself is an MCP client (Amazon's docs show `initialize`, `tools/call`, `structuredContent`, and `_meta.ui.resourceUri` for widgets). The bridge reproduces the mechanics, not Alexa's own model judgment; the README must say so plainly.

Owner: Kay Lerch (personal GitHub account). License: Apache-2.0. Locale: en-US only for now, but nothing may hardcode it.

---

## 2. Hard requirements

1. **MCP 2025-11-25 or later, Streamable HTTP.** The bridge is the MCP client. It must declare the `elicitation` capability at `initialize`, otherwise servers never send elicitation requests. Elicitation arrives as a server-to-client request on the open `tools/call` stream (form mode). The client must hold that stream open across Alexa turns; see section 5.3.
2. **TypeScript and Node.js end to end**: Lambda, agent container, generator, CLI, CDK, sample server. Node 22 LTS. npm workspaces (no pnpm/yarn, fewer moving parts for contributors).
3. **Region us-east-1.** All resources in one CDK stack. The Alexa Skill is deployed separately with the ASK CLI and references the Lambda ARN from the stack output.
4. **8-second Alexa turn limit.** The Lambda budgets **6.5 s** for the agent call. Everything is designed around that.
5. **One config file** for every developer input. Secrets are never stored in it (see section 6).
6. **Cost-safe by default.** Nothing in the stack accrues meaningful cost at idle. Costs that do accrue are documented where they occur, and the developer is told how to tear down.
7. **Frontend-agnostic core.** The Alexa Skill is one frontend. A web frontend delivering a `userId` and `sessionId` must be able to replace it without touching the agent package.
8. **Elicitation supported in v1.** Visual/widget responses out of scope, but the response contract carries a `visual` field (null for now) and nothing in the design prevents rendering `_meta.ui` widgets later.
9. **Clean, understandable, maintainable code.** Rules in section 10.

---

## 3. Architecture

```
Echo device
   │  voice
   ▼
Alexa NLU  ──(intent + slots)──►  Skill Lambda (ASK SDK, thin)
                                      │  InvokeAgentRuntime(runtimeSessionId = hash(userId), payload)
                                      ▼
                               AgentCore Runtime (one microVM per user, Node container)
                                      │  Strands Agent + Nova 2 Lite (Bedrock)
                                      │  McpClient over Streamable HTTP  ──►  developer's MCP server
                                      │  AgentCore Memory (short-term events, optional long-term)
                                      ▼
                               {speech, reprompt, question?, endSession, visual: null}
                                      │
                                      ▼
                               Skill Lambda renders SSML  ──►  Echo speaks
```

Components:

- **Skill Lambda** (`packages/skill-lambda`): Alexa endpoint. Maps ASK requests onto the bridge's `Turn` interface and renders the result. Contains no MCP or LLM logic.
- **Agent** (`packages/agent`): the container that runs on AgentCore Runtime. Owns the MCP session, the agent loop, elicitation parking, memory, and prompts. This is where the sophisticated logic lives.
- **Core** (`packages/core`): the shared, frontend-agnostic contract (`TurnInput`, `TurnOutput`, `Question`, config types, ID hashing).
- **Generator** (`packages/generator`): scans the MCP server and generates the interaction model and the tool manifest.
- **CLI** (`packages/cli`): local test harness.
- **Infra** (`infra/`): CDK app, one stack.
- **Skill package** (`skill-package/`): ASK CLI project (`skill.json`, generated interaction model).
- **Sample MCP server** (`examples/sample-mcp-server`): for testing without a developer's server.

AgentCore Gateway is **optional and off by default** (feature toggle). It adds a hop, per-call billing, and credential setup, and on 2025-11-25 it does not remove the need for the client to hold the elicitation stream. Its value comes later (durable session store, tool aggregation, version translation). Implement the CDK toggle and the client switch; do not make it the primary path.

There is **no DynamoDB in v1**. Alexa session attributes carry per-session state on the skill side; AgentCore Memory carries conversation context; the microVM carries in-flight elicitation state. If a concrete need for a table appears, add an on-demand table, not before.

---

## 4. Repo layout

```
alexa-skill-mcp-bridge/
├── bridge.config.ts            # THE config file (typed, commented, validated with zod)
├── package.json                # npm workspaces root; scripts: generate, chat, agent:dev, deploy, destroy
├── packages/
│   ├── core/                   # Turn contract, config schema + loader, id hashing, no AWS deps
│   ├── agent/                  # AgentCore Runtime container (src/, prompts/, Dockerfile)
│   ├── skill-lambda/           # ASK SDK handlers, reads generated/tool-manifest.json
│   ├── generator/              # MCP scan → interaction model + manifest + utterances
│   └── cli/                    # local harness: in-process agent or remote runtime
├── infra/                      # CDK app: bin/, lib/alexa-mcp-bridge-stack.ts
├── skill-package/              # ASK CLI: skill.json, interactionModels/custom/en-US.json (generated)
├── examples/sample-mcp-server/ # Streamable HTTP MCP server with one elicitation tool
├── docs/                       # architecture.md, config.md, cost.md, troubleshooting.md
├── README.md, LICENSE (Apache-2.0), CONTRIBUTING.md, CLAUDE.md
```

`CLAUDE.md` at the root tells a coding agent the same things a human reads in README: where config lives, run `npm run generate` after config changes, never edit generated files, and the code style rules from section 10.

---

## 5. Detailed design

### 5.1 The Turn contract (`packages/core`)

This is the boundary between any frontend and the agent. Keep it small and stable.

```ts
type TurnInput =
  | { type: 'warmup' }
  | { type: 'turn'; utterance: UtteranceHint }          // a new user request
  | { type: 'answer'; questionId: string; answer: AnswerHint }  // reply to a pending question
  | { type: 'poll' }                                     // fetch the result of a turn that ran past the deadline
  | { type: 'cancel' }                                   // user said stop / session ended

type UtteranceHint = {
  text?: string;                 // free text if the frontend has it (web, SearchQuery slot)
  intent?: string;               // Alexa intent name, if any
  tool?: string;                 // tool the intent maps to (from the manifest), a hint, not a command
  slots?: Record<string, SlotValue>;  // resolved slot values with type info
}

type AnswerHint = { text?: string; slots?: Record<string, SlotValue>; yesNo?: boolean }

type TurnOutput = {
  status: 'done' | 'question' | 'pending' | 'error';
  speech: string;                // plain text, TTS-friendly, no markdown
  reprompt?: string;
  question?: Question;           // present when status === 'question'
  endSession: boolean;
  visual: null;                  // reserved for widget rendering later
  debug?: { toolCalls: ..., elapsedMs: number };   // only when config.debug is true
}

type Question = {
  id: string;
  source: 'elicitation' | 'agent';   // MCP elicitation vs. the agent asking for a missing argument
  message: string;                    // what to speak
  schema?: JsonSchema;                // the elicitation's requestedSchema, flat primitives only
  expects: 'yesNo' | 'date' | 'number' | 'choice' | 'text';   // tells the frontend which answer intents apply
  choices?: string[];
}
```

Identity: frontends pass their raw `userId` and `sessionId`; `core` exposes `hashId()` (SHA-256 hex). The hashed user ID is the AgentCore runtime session ID (64 chars, satisfies the 33-char minimum, contains no dots) and the Memory `actorId`. The hashed Alexa session ID is the Memory `sessionId`. Raw Alexa IDs never reach AWS logs.

### 5.2 Agent container (`packages/agent`)

- Plain Node HTTP server (no framework, or Fastify if it stays small): `POST /invocations`, `GET /ping`, port 8080, listens on 0.0.0.0. Image built for **linux/arm64** (AgentCore Runtime is ARM64; x86 images fail silently).
- `/ping` returns `{"status":"Healthy"}`. A parked elicitation must **not** flip it to `HealthyBusy` (see 5.3). Only a turn still running past the deadline (5.4) may report busy, and only while it runs.
- One `BridgeSession` object per container (one container = one user). It holds: the Strands `Agent`, the `McpClient`, the pending-question queue, the last unfinished turn, and the Memory adapter.
- Strands Agents TypeScript SDK (`@strands-agents/sdk`) with `BedrockModel`. Default model `us.amazon.nova-2-lite-v1:0`, reasoning effort at the lowest setting (config). Alternative documented in config: Claude Haiku 4.5 via its `us.` inference profile.
- `McpClient` from Strands with a Streamable HTTP transport from `@modelcontextprotocol/sdk`. The client must advertise `capabilities.elicitation = {}` and use protocol version 2025-11-25 or later. Use Strands' `ElicitationCallback` if it gives access to the request and lets us resolve it asynchronously; otherwise use the `client` accessor and `setRequestHandler(ElicitRequestSchema, …)` on the raw MCP client. Confirm on day one (section 12).
- Auth to the MCP server: none, bearer token, or API key header from config (secret fetched from Secrets Manager at startup). OAuth client-credentials via the MCP SDK's auth provider if config asks for it. Authorization-code account linking is out of scope.
- **Warm-up**: on `{type:'warmup'}` respond immediately once the process is up, then run MCP `initialize` + `tools/list` + memory hydration in the background. A `turn` that arrives before that finishes awaits it.
- **Memory**: thin adapter over `@aws-sdk/client-bedrock-agentcore` (CreateEvent, ListEvents, RetrieveMemoryRecords) implementing Strands' `MemoryStore`/conversation manager interface. Short-term: every user/assistant turn is an event under `(actorId, sessionId)`. On cold start, rehydrate the last N events for this actor into the agent's message history. Long-term (user preferences / summary strategy) is a config toggle, default on, with the cost note in docs.
- **Prompts** live in `packages/agent/prompts/*.md`, loaded at build time, with simple `{{placeholders}}`:
  - `system.md`: voice assistant persona for an Echo. Rules: answer in one to three short sentences; no markdown, lists, URLs, or symbols; numbers and dates in spoken form; ask exactly one question at a time; when a tool returns several results, summarize the top one or two and offer to hear more; end each answer with at most one natural follow-up when the conversation should continue; when nothing more is needed, answer and stop.
  - `tool-result.md`: how to read `structuredContent` and `content` (prefer structured; errors become a short apology plus what the user can try); never read raw JSON aloud.
  - `elicitation.md`: how to turn an elicitation `message` + `requestedSchema` into one spoken question (enum → offer the choices; boolean → yes/no question), and how to map a spoken answer back onto the schema.
  - The tool list and the server's `instructions` string (if any) are injected into the system prompt.
- **Tool selection**: the agent decides. The manifest's intent→tool mapping arrives as `utterance.tool` and is injected as a hint ("The user's request matched tool X with these values"), never forced.

### 5.3 Elicitation parking (the core trick)

MCP 2025-11-25 delivers elicitation as a server→client request on the still-open `tools/call` stream. The Alexa turn has already ended by the time the user answers. The microVM stays provisioned between turns, so the promise can wait.

Sequence:

1. Turn N: agent calls a tool; the server sends `elicitation/create`. The callback creates a `PendingQuestion {id, params, resolve}` and pushes it on the queue. The turn loop sees a pending question, builds a `Question`, and returns `status:'question'` to the Lambda without awaiting the tool result.
2. Lambda speaks the question and stores `{questionId, expects}` in Alexa session attributes; the Alexa session stays open (reprompt set).
3. Turn N+1: the user answers. The Lambda sends `{type:'answer', questionId, answer}`. The agent maps the answer onto `requestedSchema` (deterministic where the slot type matches: date, number, yes/no, enum; otherwise a small structured-output model call), calls `resolve({action:'accept', content})`, and the original tool call continues. The turn loop then returns the tool's spoken result or the next question.
4. If a second elicitation arrives while one is pending, queue it; ask one at a time.
5. `{type:'cancel'}` (user says stop, `SessionEndedRequest`, Alexa reprompt unanswered) resolves the pending question with `{action:'cancel'}` so the server's tool call ends cleanly instead of timing out. Also apply a config timeout (`elicitation.answerTimeoutSeconds`, default 120): on expiry, cancel and log.
6. URL-mode elicitation (2025-11-25 defines it): decline with a spoken explanation on voice frontends; leave a hook for the web frontend to open the URL.

Known hazard to document: idle timeouts on the path between the runtime and the MCP server (cloudflared, ALBs, API Gateway) can cut a stream that waits for a spoken answer. The MCP TypeScript SDK's default request timeout (60 s) on the server side is a second limit. Document both in `docs/troubleshooting.md`.

### 5.4 Turn budget and cold start

- The Lambda wraps `InvokeAgentRuntime` in an `AbortController` with `turn.budgetMs` (default 6500).
- **LaunchRequest** sends `{type:'warmup'}` and waits up to the budget. On success it speaks the greeting from config (default names the MCP server and lists two example phrases). On timeout it speaks the configured cold-start message ("I'm still starting up. Give me a moment and open me again.") and **ends the Alexa session**. The runtime keeps provisioning; the next launch hits a warm session.
- Any other turn that exceeds the budget: the agent keeps working in the background (mark busy only while it runs), stores the finished `TurnOutput` as `lastResult`, and the Lambda speaks the configured "still working" line and keeps the session open. The next request of any kind first sends `{type:'poll'}`; if a result is waiting, it is spoken before handling the new input.
- Runtime lifecycle config: `idleTimeoutMinutes` default **20**, `maxLifetimeHours` 8. Runtime session ID is `hash(userId)`, stable across Alexa sessions, so a user who returns within the idle timeout gets a warm session. Rationale for docs: runtime CPU is billed only while active; memory is billed for peak footprint while the session exists (128 MB floor), so a 256 MB container idling for 20 minutes costs about a tenth of a cent.

### 5.5 Skill Lambda (`packages/skill-lambda`)

ASK SDK for Node (`ask-sdk-core`). Every handler must read as: build `TurnInput` → call `bridge.turn()` → render `TurnOutput`. No handler contains MCP or model logic.

Handlers:

- `LaunchRequestHandler` (warm-up flow above).
- `ToolIntentHandler`: one generic handler for all generated intents. Uses `generated/tool-manifest.json` to resolve intent → tool and slot → argument, then sends a `turn` with the hint.
- `AnswerHandlers`: `AMAZON.YesIntent`, `AMAZON.NoIntent`, `DateAnswerIntent` (AMAZON.DATE), `NumberAnswerIntent` (AMAZON.NUMBER), `FreeTextAnswerIntent` (AMAZON.SearchQuery with a carrier phrase). They only fire when session attributes hold a pending `questionId`; then they send `{type:'answer'}`. Without a pending question, Yes/No fall through to the agent as a `turn`.
- `FreeTextIntent` (AMAZON.SearchQuery, carrier phrases like "ask {query}", "tell {query}"): sends the free text as a `turn`. Closest thing to how Alexa+ receives requests.
- Standard: Help, Stop/Cancel (`cancel` to the agent, then goodbye), Fallback (send as `turn` with `text` unset and let the agent ask what the user meant), `SessionEndedRequest` (`cancel`).
- Rendering: `speech` → SSML `<speak>` with light escaping; `reprompt` set whenever `endSession` is false.

Alexa invokes the Lambda through the Alexa Skills Kit trigger; CDK adds the resource-based permission for `alexa-appkit.amazon.com` with the skill ID as event source token when `skill.id` is set in config. See deploy order in section 8.

### 5.6 Generator (`packages/generator`)

`npm run generate` must be deterministic except for the utterance step, and must be re-runnable.

1. Connect to `mcp.url` with the same client settings as the agent; `initialize`, `tools/list`. Fail with a clear message if the server is unreachable, needs auth that isn't configured, or negotiates a protocol version older than 2025-11-25.
2. Write `packages/skill-lambda/generated/tool-manifest.json`: for each tool, the intent name (`PascalCase(tool.name) + "Intent"`), the argument→slot mapping, and the tool's schema snapshot.
3. Map JSON Schema properties to slot types: `format: date` or names like `checkIn`/`date` → `AMAZON.DATE`; `integer`/`number` → `AMAZON.NUMBER`; `boolean` → custom `YesNoType`; `enum` → custom slot type named after the property with the enum values (entity resolution on); everything else → `AMAZON.SearchQuery`. Enforce Alexa's rules: at most one `AMAZON.SearchQuery` slot per intent, and a sample utterance containing a SearchQuery slot needs a carrier phrase and no other slots; when a tool has more than one free-text argument, keep the primary one as a slot and let the agent elicit the rest.
4. Sample utterances: 8–15 per tool generated by Nova 2 Lite from tool name, description, and schema, with a deterministic template fallback when no AWS credentials are present. Merge `skill-package/overrides/en-US.utterances.json` if it exists (developer-authored additions survive regeneration).
5. Always add: the answer intents, `FreeTextIntent`, and the standard AMAZON intents. Invocation name from config.
6. Write `skill-package/interactionModels/custom/en-US.json`. Locale is a config value; the code path is per-locale even though only en-US ships.
7. Mark every generated file with a "generated by … do not edit" header and list them in `.gitattributes` as generated.

### 5.7 Local harness (`packages/cli`)

- `npm run chat`: REPL that runs the agent package **in-process** (no container, no AgentCore) against `mcp.url`, with a fake user and session, using the same `Turn` contract. Prints speech, handles questions by prompting the terminal, shows tool calls when `--debug`. This is the fastest dev loop and the seed of the web frontend.
- `npm run chat -- --remote`: same REPL, but through `InvokeAgentRuntime` against the deployed runtime.
- `npm run agent:dev`: builds and runs the container locally on `:8080` (Docker/Finch), so `/invocations` can be exercised with curl.

### 5.8 Sample MCP server (`examples/sample-mcp-server`)

`@modelcontextprotocol/sdk` `McpServer` over Streamable HTTP, protocol 2025-11-25, no auth by default. Two tools: `search_hotels(destination, checkIn, checkOut, guests?)` returning `structuredContent` with a small fixed dataset and **eliciting `guests` when missing**; `get_weather(city)`. Document exposing it to AWS with a cloudflared quick tunnel for device tests. The generator and the harness are tested against it in CI.

---

## 6. The config file (`bridge.config.ts`)

Typed, commented, validated with zod at load time in every consumer (generator, Lambda bundle, agent, CDK). Every field has a safe default except `mcp.url`. Shape (adjust names for clarity, keep the grouping):

```ts
export default defineConfig({
  mcp: {
    url: 'https://…/mcp',                     // required
    auth: { type: 'none' | 'bearer' | 'apiKey' | 'oauthClientCredentials',
            secretName?: string,              // Secrets Manager secret holding the token / client secret
            headerName?: string },
    protocolVersion: '2025-11-25',
  },
  skill: {
    invocationName: 'my bridge',
    id: undefined,                            // set after `ask deploy`, then `cdk deploy` again tightens the Lambda permission
    locales: ['en-US'],
    greeting: undefined,                      // default derived from server name + example phrases
    coldStartMessage: "I'm still starting up. Give me a moment and open me again.",
    stillWorkingMessage: "I'm still working on that. Ask me again in a moment.",
  },
  agent: {
    modelId: 'us.amazon.nova-2-lite-v1:0',
    reasoningEffort: 'low',
    fallbackModelId: undefined,               // e.g. Claude Haiku 4.5 profile, documented
  },
  runtime: { idleTimeoutMinutes: 20, maxLifetimeHours: 8, memoryMb: 512 },
  turn: { budgetMs: 6500 },
  elicitation: { answerTimeoutSeconds: 120 },
  memory: { shortTerm: true, longTerm: true, hydrateLastEvents: 20 },
  features: { gateway: false, debug: false },
  aws: { region: 'us-east-1', budgetUsd: 5, budgetEmail: undefined, logRetentionDays: 7 },
});
```

Secrets: config holds names, never values. The developer creates the secret with one documented `aws secretsmanager create-secret` command; the CDK stack grants read access to the runtime role.

---

## 7. CDK stack (`infra/`)

One stack, `AlexaMcpBridgeStack`, reading `bridge.config.ts`. Use the stable `aws-cdk-lib/aws-bedrockagentcore` constructs (Runtime, Memory, Gateway, GatewayTarget, credential providers), not the alpha package.

Resources:

- **Skill Lambda**: `NodejsFunction`, Node 22, arm64, timeout 8 s, memory 512 MB, bundled with esbuild, env vars for runtime ARN and config. Permission for `alexa-appkit.amazon.com`, with `eventSourceToken = skill.id` when set; when unset, print a loud warning in the deploy output and README that the permission is open until the skill ID is configured.
- **Agent image**: `DockerImageAsset` (platform linux/arm64) → ECR. **AgentCore Runtime** from that image, with `lifecycleConfiguration` set **explicitly** from config (a past CDK default rendered a 60-second idle timeout), environment from config, execution role with `bedrock:InvokeModel*` on the configured model profiles, Memory data-plane permissions, Secrets Manager read on the configured secret, CloudWatch logs.
- **AgentCore Memory**: short-term always; long-term strategy when `memory.longTerm`.
- **Gateway + MCP server target** only when `features.gateway`; sessions and response streaming enabled (required for elicitation); NoAuth or the configured credential provider; the agent then points at the gateway URL with SigV4.
- **AWS Budgets** cost budget at `aws.budgetUsd` with email notification when `budgetEmail` is set (warn in output if not).
- Log groups with `logRetentionDays`.
- Outputs: Lambda ARN (for `skill.json`), runtime ARN, memory ID, gateway URL if enabled.
- Deployment role needs `iam:CreateServiceLinkedRole` for AgentCore; document it.
- Bedrock model access must be enabled in the account for the chosen models; document the console step and give a `scripts/check-model-access.ts` that calls `InvokeModel` once and reports.

`npm run deploy` = `cdk deploy` with a pre-flight that validates config and checks model access. `npm run destroy` = `cdk destroy` plus deletion of the ECR images and a reminder about the Alexa skill (`ask smapi delete-skill`).

---

## 8. Developer setup flow (what the README's quick start must be)

Keep it to about ten numbered steps, each one command or one action, with context only where it changes a decision.

1. Prerequisites: Node 22, AWS CLI with credentials, CDK bootstrapped in us-east-1, Docker or Finch, ASK CLI logged in, Bedrock model access enabled for Nova 2 Lite.
2. `git clone`, `npm install`.
3. Edit `bridge.config.ts`: set `mcp.url` (and auth secret name if needed).
4. `npm run generate` → review the generated interaction model, add overrides if wanted.
5. `npm run chat` → talk to your server locally; fix tool descriptions if the agent picks badly.
6. `npm run deploy` → note the Lambda ARN in the output. Cost callout printed here: what starts costing money and when.
7. Put the Lambda ARN into `skill-package/skill.json`; `cd skill-package && ask deploy` → note the skill ID.
8. Put the skill ID into `bridge.config.ts`; `npm run deploy` again (tightens the Lambda permission).
9. Enable testing in the Alexa developer console (development stage); say "Alexa, open <invocation name>" on a device on the same Amazon account. First launch may hit the cold-start message; open it again.
10. When done: `npm run destroy`. Explain what lingers if you don't (idle sessions expire on their own; Memory records and logs are pennies; the skill stays in your developer account).

If a cleaner order exists that avoids the second `cdk deploy` (for example creating the skill first without an endpoint to obtain the ID), use it and document it instead.

---

## 9. Cost safety (must be reflected in code, output, and docs)

- The stack accrues no meaningful cost at idle: no always-on compute, no provisioned capacity, on-demand everything.
- What costs money, and where the docs say so: model tokens per turn (`docs/cost.md` with a worked example per turn); runtime CPU while active and memory while a session exists; Memory events and long-term extraction (a model call per session when enabled); Gateway per call when enabled; CloudWatch logs.
- Defaults chosen for cost: Nova 2 Lite, 512 MB container, 20-minute idle, 7-day log retention, budget alarm at $5.
- `npm run deploy` prints a short cost note at the end. `npm run destroy` is documented on the README's first screen.

---

## 10. Code style rules (from the project owner, apply throughout)

- Clean and understandable. Short, useful comments where they help; no narration of the obvious.
- Not overwhelming. The sophisticated work (MCP session, elicitation parking, memory, prompt assembly, answer mapping) sits at the back, in `packages/agent`. Frontend code (skill handlers) stays thin.
- Abstraction must not produce a black box. The main flow of a turn should be readable from the outside: `packages/agent/src/turn.ts` (or equivalent) reads top to bottom as the story of one turn, delegating to well-named modules. Someone reading `skill-lambda` should understand what happens without opening `agent`, and someone reading `turn.ts` should understand the elicitation mechanism without reading the MCP client wrapper.
- One file per concern; small modules; explicit types at boundaries; zod validation at every input edge (config, invocation payloads, MCP results).
- No generated code for handlers. Generated artifacts are data (JSON) with a header saying so.
- Errors are turned into short spoken messages at the edge and logged with structure inside. Never speak raw error text or JSON.
- Docs in plain language, concise, decision-oriented. Context only where it helps the developer choose.
- Tests: unit tests for the generator's slot mapping and manifest, the answer→schema mapper, and the turn state machine (question, pending, poll, cancel); an integration test running the in-process harness against the sample server, including one elicitation round trip. Keep CI to `npm test` + `cdk synth`.

---

## 11. Out of scope for v1 (prepare for, do not build)

- Widget/visual rendering (`visual` stays null; keep `_meta.ui.resourceUri` in the tool-result type so it can be surfaced later, likely as an APL image from a server-side screenshot).
- Web frontend (the CLI harness and the `Turn` contract are its foundation).
- OAuth authorization-code account linking.
- Additional locales.
- MCP 2026-07-28 multi-round-trip elicitation (stateless). The 2025-11-25 path is the requirement; leave a version switch in the client so 2026-07-28 can be added.
- Alexa progressive responses (speak "let me check" while working). Can be a later addition to the Lambda.

---

## 12. Verify on day one (before building on these assumptions)

Each of these is either uncertain or reported inconsistently. Write a throwaway script or test for each and record the outcome in `docs/architecture.md`.

1. **Strands TS elicitation**: confirm the `ElicitationCallback` receives the request and can resolve it later from another invocation (i.e. it can return a promise that we settle externally). If not, use the raw MCP `Client` request handler.
2. **Parked promise survives between invocations** on AgentCore Runtime: start a tool call that elicits, return from `/invocations`, invoke again 20 seconds later, resolve, and confirm the tool result arrives. Also confirm that leaving `/ping` at `Healthy` during the wait does not cause the runtime to reclaim the session, and whether reporting `HealthyBusy` blocks new invocations for the same session (one third-party source says it does; the official docs don't say).
3. **Session ID reuse** after the microVM was reclaimed (idle timeout or 8-hour max) starts a fresh session with the same `runtimeSessionId` without error.
4. **Abandoned first invocation** (Lambda aborts at 6.5 s during cold start) still leaves a provisioned, warm microVM for the next launch.
5. **Cold-start time** of the Node container end to end (provision + boot + warm-up response). Tune the image size accordingly (multi-stage build, production deps only).
6. **runtimeSessionId constraints** accept a 64-char hex string.
7. **Streamable HTTP idle behavior** through a cloudflared tunnel with a 30-second gap between elicitation and answer.
8. **Nova 2 Lite tool-use latency** with the lowest reasoning setting for a typical turn (one tool call + phrasing), measured through the harness. If a typical turn does not fit inside the budget with headroom, revisit prompt size and the tool-list injection before considering another model.
9. **CDK constructs**: `aws-cdk-lib/aws-bedrockagentcore` Runtime supports `lifecycleConfiguration` and container image from `DockerImageAsset` as expected; Gateway MCP target accepts NoAuth.
10. **ASK trigger permission**: confirm the CDK permission with `eventSourceToken` works and the deploy order in section 8 holds, or find the cleaner order.

---

## 13. References

- Alexa+ MCP client lifecycle (payload shapes): https://developer.amazon.com/docs/alexaplus/add-ons/category-sdk-mcp-client-lifecycle.html
- Alexa+ MCP quickstart (requirements, Streamable HTTP, auth): https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html
- Alexa+ Local Inspector (how Amazon's own tooling drives an MCP server): https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html
- Alexa+ web simulator: https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html
- MCP spec 2025-11-25 (Streamable HTTP, elicitation): https://modelcontextprotocol.io/specification/2025-11-25
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Strands Agents TypeScript: https://strandsagents.com/docs/user-guide/quickstart/typescript/ and MCP tools: https://strandsagents.com/docs/user-guide/concepts/tools/mcp-tools/
- Strands TS deployment to AgentCore Runtime: https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/
- AgentCore Runtime async / ping semantics: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html
- AgentCore Runtime invoke: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-invoke-agent.html
- AgentCore Gateway elicitation: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-mcp-elicitation.html
- AgentCore Gateway sessions/streaming: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-sessions.html
- CDK AgentCore constructs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html
- Nova 2 Lite model card and IDs: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html
- Lambda + AgentCore router pattern (reference only): https://github.com/aws-samples/sample-host-openclaw-on-amazon-bedrock-agentcore
- ASK SDK for Node: https://github.com/alexa/alexa-skills-kit-sdk-for-nodejs ; ASK CLI: https://developer.amazon.com/docs/alexa/smapi/ask-cli-intro.html

---

## 14. Suggested build order

1. Repo scaffold, workspaces, config schema, `core` types, sample MCP server, CI skeleton.
2. Agent package running in-process via the CLI harness against the sample server: turn, tool call, spoken result. Then elicitation parking in-process.
3. Generator: manifest + interaction model + utterances; tests.
4. Container + CDK stack (Lambda, Runtime, Memory, budget); day-one verification items 2–6 and 9.
5. Skill Lambda handlers; `skill-package`; deploy flow end to end on a device; verification items 1, 7, 8, 10.
6. Memory hydration, long-term toggle, Gateway toggle.
7. Docs pass: README quick start, cost, troubleshooting, architecture with recorded verification results.

Ship after step 5 works on a device; steps 6–7 finish v1.
