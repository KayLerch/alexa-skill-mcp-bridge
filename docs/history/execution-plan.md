# Execution plan: `alexa-skill-mcp-bridge`

> **Frozen on 2026-09-05.** This is a document the project was built from, kept for provenance.
> It is not maintained and parts of it no longer match the code. Current truth lives in
> [README.md](../../README.md), [docs/architecture.md](../architecture.md),
> [docs/config.md](../config.md) and [docs/decisions.md](../decisions.md).

Written 2026-09-03 as the build order for the [brief](brief.md), with per-phase checkboxes and rough
effort figures for one developer. Its two lasting outputs, the decision table and the verification log,
now live in [docs/decisions.md](../decisions.md) and are maintained there; the phases and checkboxes
below are a snapshot of how the work was sequenced, not a status board. Ports, names and defaults in it
have moved on (the sample server listens on 3939; the device is an Alexa+ device).

Reading guide:

- Phase 0 is the day-one verification pass the brief asks for. It runs first because three of the ten items can invalidate the elicitation design.
- Phases 1 to 5 reach the ship point (works on an Echo). Phases 6 and 7 complete v1.
- Every phase lists goal, tasks, artifacts, tests, and exit criteria. Tasks marked `∥` can run in parallel within their phase.
- Effort figures are rough sizing for one developer working with Claude Code, not commitments.

| Phase | Name | Rough effort |
|---|---|---|
| 0 | Verification spikes | 1 to 2 days |
| 1 | Scaffold, core, sample server, CI | 0.5 to 1 day |
| 2 | Agent in-process plus CLI harness | 2 to 3 days |
| 3 | Generator | 1 to 1.5 days |
| 4 | Container plus CDK stack | 1 to 2 days |
| 5 | Alexa Skill Lambda, Alexa Skill package, device end to end | 1.5 to 2 days |
| 6 | Memory hydration, long-term toggle, Gateway toggle | 1 to 1.5 days |
| 7 | Docs and release pass | 1 day |

---

## 1. Fixed by the brief (not up for debate)

| Topic | Value |
|---|---|
| Language and runtime | TypeScript end to end, Node 22 LTS, npm workspaces |
| MCP | Streamable HTTP, client declares `elicitation` at `initialize`, no protocol floor of our own; below 2025-11-25 the bridge warns (Alexa+ add-on floor) but runs (D34) |
| Region and infra | us-east-1, one CDK stack, Alexa Skill deployed separately with ASK CLI |
| Turn budget | 6500 ms for the agent call inside Alexa's 8 s limit |
| Model | `us.amazon.nova-2-lite-v1:0`, lowest reasoning effort; Claude Haiku 4.5 profile as documented alternative |
| Agent stack | AgentCore Runtime (arm64 container), Strands Agents TS SDK, AgentCore Memory |
| State | No DynamoDB. Alexa session attributes, AgentCore Memory, microVM in-flight state |
| Gateway | Optional, off by default, CDK and client toggle exist |
| Runtime lifecycle | Idle 20 min, max lifetime 8 h, 512 MB container |
| Config | One `bridge.config.ts`, zod-validated in every consumer, secrets by name only |
| Cost | Nothing always-on, 7-day log retention, costs documented where they occur (no budget alarm, D35) |
| Frontends | Alexa is one frontend; `packages/core` Turn contract is the boundary; `visual: null` reserved |
| Locale | en-US only, never hardcoded |
| License | Apache-2.0 |

---

## 2. Decisions this plan adds

The brief leaves these open. Each is a default; the "revisit if" column says what would change it.

| # | Decision | Rationale | Revisit if |
|---|---|---|---|
| D1 | Agent HTTP server is plain `node:http`, no framework | Two routes, zero deps, smaller image | A third route or middleware need appears |
| D2 | Config reaches Lambda and container as one `BRIDGE_CONFIG` JSON env var set by CDK at synth; each consumer re-validates with zod | Single source, no config file inside the image, no runtime file reads | Config grows past env var limits (Lambda: 4 KB total) |
| D3 | Greeting is rendered by the Lambda from the manifest (server name plus two example phrases captured at generate time), not by the agent | LaunchRequest must not wait for MCP `initialize` | Greeting needs live server data |
| D4 | Agent-sourced questions use a built-in `ask_user` tool (`{message, expects, choices?}`) instead of parsing final text | Deterministic; the Lambda needs `expects` to enable answer intents; a plain text question would leave `DateAnswerIntent` and friends unable to fire | Strands offers a first-class "ask the user" primitive |
| D5 | An elicitation with N properties becomes N sequential `Question`s (required properties first); answers accumulate and the elicitation resolves once | Voice can carry one question at a time | Servers commonly send multi-field forms that must be answered atomically |
| D6 | Answer mapping is deterministic first (yes/no, AMAZON.DATE, AMAZON.NUMBER, enum match with entity resolution), model-backed structured output only as fallback for `text` answers against typed schemas | Cheap, testable, no latency for the common case | Deterministic mapping misfires in testing |
| D7 | A new `turn` arriving while a question is pending cancels the elicitation (`action: 'cancel'`), waits up to 2 s for the parked tool call to unwind, discards that turn's output, then runs the new turn | User changed topic; the stale tool result must not be spoken | Users frequently answer questions via a tool intent (then map instead of cancel) |
| D8 | Deadline enforcement lives in the agent: the invocation envelope carries `budgetMs`; the agent returns `pending` at `budgetMs - 500 ms`; the Lambda's `AbortController` is the safety net | Clean `pending` result beats a torn connection; the agent knows when it went into overrun | Verification item 4 shows aborted invocations kill the microVM |
| D9 | `poll` returns the stored result, or `pending` while running, or `done` with empty `speech` when nothing is waiting | Keeps the brief's status enum; Lambda treats empty speech as "nothing to say" | A fifth status proves clearer in practice |
| D10 | Test model: `packages/agent` builds its model via `createModel(config)`; tests inject a scripted model that emits fixed tool calls | CI must run the elicitation round trip without AWS credentials | Strands has no pluggable model interface (then the integration test becomes `test:live`, credential-gated) |
| D11 | Spikes live in `spikes/` at the repo root, outside npm workspaces, each with its own `package.json`; kept after the docs pass with a README so contributors can re-run them | AWS behavior changes; a re-runnable probe is worth more than a paragraph | Owner prefers a clean tree (then delete after recording outcomes) |
| D12 | Structured logging is a 30-line module in `packages/core`; no logging library | Fewer deps, JSON lines are enough for CloudWatch | Log volume or redaction needs grow |
| D13 | Tooling: `tsc` per package with project references, `vitest`, ESLint flat config with `typescript-eslint`, Prettier | Conventional, minimal | Contributor friction |
| D14 | Sample server runs stateful Streamable HTTP (session IDs), sends MCP `ping` to the client every 15 s while a tool call waits on elicitation, and calls `elicitInput` with a 10-minute timeout | Stateless mode cannot route the elicitation reply back to the pending request; SDK default request timeout is 60 s; tunnels drop idle streams | Verification item 7 shows pings are unnecessary |
| D15 | Lambda also calls `SkillBuilders.custom().withSkillId(config.skill.id)` when the ID is set | Defense in depth while the resource permission is open | Never |
| D16 | The Lambda's `bridge` client always sends `poll` first when session attributes say a result is outstanding, and subtracts the poll's elapsed time from the budget of the main call | Keeps the 6.5 s promise honest | Poll round trips measure above 400 ms |
| D17 | Package build outputs go to `dist/`; Lambda is bundled by `NodejsFunction` from source; the container image is a multi-stage build with production deps only | Small image, fast cold start (verification item 5) | Cold start still too slow (then prune further or prebuild the workspace) |
| D18 | TypeScript 5.9, not 7 | typescript-eslint 8.69 supports TypeScript below 6.1 only | typescript-eslint supports TypeScript 7 |
| D19 | vitest 3.2 | npm 10.8's resolver crashes on vitest 4.1's peer set (`Cannot read properties of null (reading 'edgesOut')`); vitest 3.2 installs cleanly | npm 11 becomes the baseline |
| D20 | `agent.reasoningEffort` accepts `off` and defaults to it; `off` sends no `reasoningConfig` | Measured in S4: one hotel turn takes 4.2 s with 160 output tokens at `off` versus 5.7 s with 622 output tokens at `low`. `off` is the lowest setting and the only one with headroom inside 6.5 s | Tool choice or argument quality suffers at `off` |
| D21 | The agent uses the raw MCP SDK `Client` (thin wrapper in `mcp/client.ts`), not Strands' `McpClient`; Strands stays for the Agent loop, `BedrockModel`, and tools | Strands' `McpTool` drops `structuredContent`, its `callTool` has no timeout option (SDK default 60 s, confirmed in S1 `long-strands`), and the negotiated protocol version is only readable from the transport | Strands exposes a per-call timeout and structured content |
| D22 | `runtime.memoryMb` is not a config field | AgentCore Runtime has no memory-size setting; memory is billed by peak footprint. A no-op field would mislead | AgentCore adds a memory setting |
| D23 | `bridge.config.ts` is loaded with Node 22's built-in type stripping (`import()`), no tsx or ts-node; scripts under `scripts/` run the same way | Zero tooling in the runtime path; verified on Node 22.23 with no flags or warnings. Requires Node 22.18 or later and erasable syntax only (no enums, parameter properties, namespaces) | The config needs non-erasable syntax |
| D24 | `ask_user` answers travel through the same `QuestionQueue` as MCP elicitation; the tool's result is the answer text or `{answered: false}` | One parking mechanism, one `Question` shape for the frontend | Never |
| D25 | For a `done` result, `endSession` is true unless the spoken answer ends with a question mark; the reprompt repeats the answer when the session stays open | Deterministic reading of "end with at most one follow-up when the conversation should continue; when nothing more is needed, answer and stop" | Users find sessions closing too eagerly |
| D26 | The agent's `tools/call` timeout is 10 minutes; the per-answer timeout (`elicitation.answerTimeoutSeconds`) is enforced by the queue | A form with several properties parks the same tool call across several spoken answers | Servers commonly time out earlier (then document per server) |
| D27 | The sample server exports `startSampleServer({port: 0})`; the agent's state machine tests and the CLI round trip run against it in-process | One real MCP server in tests instead of a mock, no port clashes | Never |
| D28 | A tool result handed to the model carries one content block: `json` (structuredContent) when present and not an error, else `text` | Nova 2 Lite collapses its context on a result that mixes `json` and `text` (measured: 545 input tokens instead of 1712, empty answer or a rambling one that hits the token cap); `json` only or `text` only both answer in about 25 tokens | Nova handles mixed content, or another model needs the text alongside |
| D29 | `ask-resources.json` lives at the repo root with `skillMetadata.src: ./skill-package`; `ask deploy` runs from the root, not from `skill-package/` | ASK CLI v2 zips the `src` folder as the Alexa Skill package; running from inside it would put `ask-resources.json` and `.ask/` into the upload. `overrides/` inside `skill-package/` is a known risk for the same reason, to be checked at the first `ask deploy` | SMAPI rejects the upload because of `overrides/` (then move it to `skill-overrides/`) |
| D30 | AgentCore Memory is integrated through the bridge's own `MemoryAdapter` (one event per exchange, rehydration into the agent's message history at warm-up, preferences into the system prompt), not through Strands' `MemoryStore` | Strands' `MemoryStore` is a retrieval-injection abstraction with its own tools and extraction; the bridge needs deterministic replay of recent history and a small preference block | Strands ships an AgentCore Memory store with history replay |
| D31 | Long-term memory namespaces are explicit: `/users/{actorId}/preferences` and `/users/{actorId}/sessions/{sessionId}` | The CDK built-in strategies default to `/strategies/{memoryStrategyId}/actors/{actorId}`, and the runtime does not know the strategy id | Never |
| D32 | The sample server listens on 3939 by default (`PORT=` overrides), and `bridge.config.ts` ships with that URL | 3000 is the most collision-prone port on a developer machine; the owner's first run hit `EADDRINUSE` (a Docker container held it) with a raw stack trace. The server now names the conflict and the fix | Never |
| D33 | Onboarding guards: `.npmrc engine-strict`, a plain-JS Node check before every npm script, `npm run doctor -- --track local\|cloud\|skill`, and `npm run chat` explaining a failed MCP connection before the first turn | The owner's first run failed three times (wrong Node, taken port, a wrong script path) with nothing saying what was missing. The README is organized by track with install commands per prerequisite | A prerequisite check produces false failures |
| D34 | No configurable MCP protocol floor. The SDK decides what it can negotiate; `ALEXA_PLUS_PROTOCOL_VERSION` (2025-11-25) is advisory only, and the generator, `npm run doctor`, and the agent log a warning naming the negotiated version when a server falls below it | A floor the bridge cannot justify technically only blocks legitimate testing: most public MCP servers still negotiate 2025-06-18 or 2025-03-26, and the bridge works against them. The Alexa+ requirement is real but it belongs in a warning, not in a refusal | The bridge stops working against a version the SDK still accepts (then fail on that version specifically, with the reason) |
| D35 | No AWS Budgets alarm. `docs/cost.md` and the deploy output say what accrues and how to stop it; nothing emails you | A budget that notifies needs an email address, and an address in tracked config is exactly the value this repo keeps out of commits. The alarm without a subscriber was decoration | The stack ever gains a resource that can run away on its own |
| D36 | The five fields that identify a developer rather than the project (`mcp.url`, `mcp.auth.type`, `mcp.auth.secretName`, `skill.id`, `aws.region`) can come from a git-ignored `.env`, applied in `loadConfigFile` before zod runs. `bridge.config.ts` ships ready to commit and nobody needs to edit it | The repo is public: every clone that edits the tracked config file risks committing its own endpoint, Alexa Skill id, or account. Real environment variables still win over `.env`, so CI and one-off runs are unaffected; the Lambda and the container are unaffected because they read the merged `BRIDGE_CONFIG` | A sixth field turns out to be developer-specific (add it to `ENV_OVERRIDES`, its `.env.example` line, and docs/config.md) |
| D37 | Generated artifacts carry no source URL (`_generated` is `by` and `notice` only), and `npm run check:leaks` (pre-commit hook plus CI) refuses a commit carrying an AWS account id, an Alexa Skill id, a non-local endpoint, a tunnel host, or credentials in a URL | `npm run generate` used to write `mcp.url` into two tracked files, so a `.env` alone would not have kept an endpoint out of a commit. The check is the backstop for the values that reach tracked files by other routes (`skill-package/skill.json` takes a real Lambda ARN by design) | A rule produces false positives often enough that people commit with `--no-verify` by habit |

---

## 3. Package map and dependency rules

```
packages/core          no AWS SDK deps; zod, node:crypto only
packages/agent         core, @strands-agents/sdk, @modelcontextprotocol/sdk, @aws-sdk/client-bedrock-agentcore, @aws-sdk/client-secrets-manager
packages/skill-lambda  core, ask-sdk-core, ask-sdk-model, @aws-sdk/client-bedrock-agentcore
packages/generator     core, @modelcontextprotocol/sdk, @aws-sdk/client-bedrock-runtime
packages/cli           core, agent (in-process), @aws-sdk/client-bedrock-agentcore (remote)
infra                  core, aws-cdk-lib, constructs
examples/sample-mcp-server  @modelcontextprotocol/sdk, zod (standalone; no dependency on packages/*)
```

Rules:

- Import direction is downward only: `cli → agent → core`, `skill-lambda → core`, `generator → core`, `infra → core`. Nothing imports from `skill-lambda`.
- `core` owns every type that crosses a boundary: `TurnInput`, `TurnOutput`, `Question`, `AgentInvocation` (envelope: turn, actorId, sessionId, locale, budgetMs), `ToolManifest`, `BridgeConfig`.
- Every input edge validates with zod: config load, `/invocations` body, MCP `tools/list` and `tools/call` results, elicitation params, manifest file, Alexa slot values.
- Raw Alexa IDs are hashed in the Lambda before they leave it. Logs everywhere carry hashed IDs only.

---

## 4. Phase 0: verification spikes

Goal: settle every item in brief section 12 with evidence before building on it. Each spike is a small script or a throwaway deploy, and each outcome gets a paragraph in `docs/architecture.md` (created in Phase 7; keep notes in section 16 until then).

### 4.1 Spike inventory

| Spike | Covers brief items | What it does |
|---|---|---|
| S1 `spikes/strands-elicitation` | 1 | Local only. Inline 40-line MCP server (Streamable HTTP, one tool that elicits) plus a Strands `McpClient`. Elicitation callback returns a deferred promise settled 20 s later from a timer. Confirms the callback exposes the request and accepts a late resolution. Also confirms the installed `@modelcontextprotocol/sdk` negotiates 2025-11-25 and that `capabilities.elicitation` is advertised. Falls back to `client.setRequestHandler(ElicitRequestSchema, …)` and records which path works. |
| S2 `spikes/probe-runtime` | 2, 3, 4, 5, 6, 9 (Runtime part) | A minimal arm64 Node container with `/ping` and `/invocations` supporting commands: `boot-info` (process start time, invocation counter), `park` (starts a fake tool call awaiting a promise, returns), `resolve` (settles it, returns the fake result), `slow N` (returns after N seconds), `heartbeat` (returns a buffer written by a 1 s `setInterval`, exposing any gap where the VM was paused), `hold-stream` (opens an SSE connection to a local sample server through a tunnel and reports whether it is still open). A minimal CDK stack deploys it with `lifecycleConfiguration` set explicitly. A driver script runs the sequences below. |
| S3 `spikes/tunnel-idle` | 7 | Sample server behind `cloudflared tunnel --url`, a local MCP client calls the eliciting tool, waits 30 s and then 90 s before answering. Runs with and without the server-side 15 s `ping`. |
| S4 `spikes/nova-latency` | 8 (baseline) | Raw Bedrock Converse call with a system prompt of realistic size, two tool definitions, one tool round trip, lowest reasoning setting. Records p50 and p95 over 20 runs. The full measurement through the harness happens in Phase 2. |
| S5 `spikes/cdk-synth-gateway` | 9 (Gateway part) | Synth-only: `Gateway` plus MCP `GatewayTarget` with NoAuth from `aws-cdk-lib/aws-bedrockagentcore`. Confirms the construct surface and property names. |
| S6 `spikes/ask-deploy-order` | 10 | Hello-world Lambda with the `alexa-appkit.amazon.com` permission and `eventSourceToken`. Tries the candidate cleaner order: `ask smapi create-skill-for-vendor` with a manifest lacking an endpoint to obtain the Alexa Skill ID first, then one CDK deploy, then `ask deploy` with the ARN. Records whether SMAPI accepts a custom Alexa Skill without an endpoint. |

S2 driver sequences:

1. Cold start: new session ID, `boot-info`, time to first byte. Repeat 5 times with fresh IDs. (item 5)
2. Park and resolve: `park`, wait 20 s, `resolve`, expect the fake result. Ping stays `Healthy` throughout. Then repeat with a 5 min gap. (item 2)
3. Heartbeat: invoke `heartbeat` 60 s after the previous invocation and inspect the buffer for gaps. This tells whether the microVM keeps running between invocations at all. (item 2)
4. Busy semantics: flip `/ping` to `HealthyBusy`, invoke again on the same session, record whether the invocation is served, queued, or rejected. (item 2)
5. Abandoned first invocation: fresh session ID, client aborts at 6.5 s, wait 30 s, invoke `boot-info` and confirm the process start time predates the abort. (item 4)
6. Session reuse after reclaim: set idle timeout to the minimum the API allows, wait past it, invoke with the same session ID, expect a fresh process and no error. (item 3)
7. Session ID format: 64-char hex, and one with a dot to confirm the constraint. (item 6)
8. Held stream: `hold-stream`, wait 60 s, check state on the next invocation. (item 2 in combination with 7)

### 4.2 Decision gates

| Item | If it fails | Fallback |
|---|---|---|
| 1 | Strands callback cannot be settled later | Register the raw MCP request handler on the underlying `Client`; keep the Strands `McpClient` for tool listing only |
| 2a | Heartbeat shows gaps: the VM is paused between invocations while `Healthy` | Report `HealthyBusy` while a question is pending (brief prefers `Healthy`; document why) |
| 2b | `HealthyBusy` blocks new invocations for the same session | Elicitation parking in v1 is at risk. Escalate to the owner with the measurements. Candidate directions, in order: keep `Healthy` and shorten the answer window; hold the invocation open from a second Lambda invoked asynchronously (`Event` invocation type) that waits for the turn to finish; scope elicitation to the Gateway path if Gateway sessions hold the stream server-side |
| 3 | Reusing a session ID after reclaim errors | Session ID becomes `hash(userId + dayBucket)`; document the reduced warm-hit rate |
| 4 | Aborted first invocation kills provisioning | Add a "warmer" Lambda invoked asynchronously by the Alexa Skill Lambda on LaunchRequest; it calls `InvokeAgentRuntime` with a long timeout and no abort. No idle cost |
| 5 | Cold start above 6 s after image tuning | Warmer Lambda from item 4 becomes the default path and the cold-start message is expected on the first launch of a day |
| 6 | 64-char hex rejected | Shorten or re-encode the hash in `core.hashId()`; the contract stays |
| 7 | Tunnel cuts idle streams | Server-side `ping` every 15 s (D14) plus a troubleshooting entry; if pings do not help, document the tunnel timeout and recommend a named tunnel |
| 8 | Baseline above 4 s p95 | Shrink the system prompt, inject tool names with one-line descriptions only, cap output tokens, then measure Haiku 4.5 |
| 9 | L2 constructs lack `lifecycleConfiguration` or image-from-asset | Use the L1 `CfnRuntime` for those properties; keep the L2 elsewhere |
| 10 | SMAPI refuses a manifest without an endpoint | Keep the two-deploy order from the brief and make `npm run deploy` detect the missing Alexa Skill ID and print the exact next step |

### 4.3 Tasks

- [x] Write `spikes/README.md` listing the spikes, how to run them, and the account prerequisites (CDK bootstrap, Bedrock model access, `iam:CreateServiceLinkedRole`)
- [x] S1 `∥` (run 2026-09-03; see section 16)
- [ ] S4 `∥` (script ready; one run each at `low` and `off` done, the 20-run loop waits for the owner's go-ahead)
- [x] S5 `∥` (synth run 2026-09-03; see section 16)
- [ ] S2 container, stack, driver; run sequences 1 to 8 (container, stack, and driver written; deploy not run: creates billable resources, see `spikes/probe-runtime/README.md`)
- [ ] S3 (script written; not run: `cloudflared` is not installed on the dev machine)
- [ ] S6 (script written; not run: creates an Alexa Skill and a Lambda)
- [x] Record outcomes and chosen fallbacks in section 16, with numbers (S1, S4 partial, S5; S2, S3, S6 pending)
- [ ] Tear down the probe stack

### 4.4 Exit criteria

- Items 1, 2, 5, 6 have recorded outcomes. Item 2 in particular is either "parking works with `Healthy`" or a fallback is chosen.
- The elicitation mechanism is confirmed viable, or the owner has been told it is not and has picked a direction.
- Cold-start p50 and Nova baseline p95 are known numbers.

---

## 5. Phase 1: scaffold, core, sample server, CI

Goal: a repo that installs, lints, builds, and tests in CI, with the shared contract and config schema in place and a sample server to develop against.

### 5.1 Tasks

- [x] Root: `package.json` with workspaces (`packages/*`, `infra`, `examples/*`), scripts `build`, `lint`, `test`, `generate`, `chat`, `agent:dev`, `deploy`, `destroy`, `synth`, `sample:start`. `.nvmrc` with 22. `.editorconfig`, `.gitignore`, `.gitattributes` (generated file markers added in Phase 3).
- [x] Tooling (D13): root `tsconfig.base.json` (strict, `NodeNext`, ES2022 target), per-package `tsconfig.json` with references, ESLint flat config, Prettier, vitest workspace config.
- [x] `LICENSE` (Apache-2.0), `CONTRIBUTING.md` (short: how to run tests, where code goes, the style rules by reference), placeholder `README.md` with the one-paragraph description and "docs coming in Phase 7".
- [x] `packages/core`:
  - [x] `src/turn.ts`: `TurnInput`, `UtteranceHint`, `AnswerHint`, `SlotValue`, `TurnOutput`, `Question` as zod schemas with inferred types. `visual: z.null()`.
  - [x] `src/invocation.ts`: `AgentInvocation` envelope schema (turn, actorId, sessionId, locale, budgetMs, debug).
  - [x] `src/manifest.ts`: `ToolManifest` schema (server name and version, instructions, per-tool intent name, argument to slot map with slot types, schema snapshot, example phrases).
  - [x] `src/config.ts`: `bridgeConfigSchema` with every default from brief section 6, `defineConfig()`, `loadConfigFile(path)` (used by generator, CLI, CDK), `loadConfigFromEnv()` (used by Lambda and container). Validation errors print the field path and the fix.
  - [x] `src/ids.ts`: `hashId(raw): string` SHA-256 hex.
  - [x] `src/log.ts`: JSON-lines logger with `child(bindings)` (D12).
  - [x] Unit tests: config defaults and required `mcp.url`, `hashId` shape, schema round trips.
- [x] `bridge.config.ts` at root: fully commented, shipped with `mcp.url` pointing at the sample server (`http://localhost:3000/mcp`) so `npm run chat` works out of the box. README step 3 tells the developer to replace it.
- [x] `examples/sample-mcp-server`:
  - [x] `McpServer` over `StreamableHTTPServerTransport`, stateful (D14), port from `PORT` (default 3000), path `/mcp`, no auth.
  - [x] `search_hotels(destination, checkIn, checkOut, guests?)`: fixed dataset of 8 hotels across 3 destinations; when `guests` is missing, elicit it (form mode, `{guests: integer, minimum 1, maximum 6}`) with a 10-minute timeout and a 15 s server `ping` loop while waiting; returns `structuredContent` plus text.
  - [x] `get_weather(city)`: fixed table, returns `structuredContent`.
  - [x] `instructions` string on the server (the agent injects it).
  - [x] Optional `MCP_BEARER_TOKEN` env: when set, requires the header (lets the auth path be tested locally).
  - [x] `README.md`: run, cloudflared quick tunnel command, note on stateful mode and elicitation timeouts.
- [x] CI `.github/workflows/ci.yml`: Node 22, `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run synth`. No AWS credentials. Confirm `cdk synth` does not require Docker (Docker image assets build at deploy time); if it does, gate synth behind a Docker-enabled job.

### 5.2 Exit criteria

- `npm install && npm run build && npm test` passes locally and in CI.
- `npm run sample:start` serves the sample server; `curl` of `initialize` shows protocol 2025-11-25 and elicitation-capable behavior (a `tools/call` without `guests` produces an `elicitation/create` on the stream).

---

## 6. Phase 2: agent in-process plus CLI harness

Goal: `npm run chat` talks to the sample server through the real agent code, including one elicitation round trip, without a container or AWS beyond Bedrock model calls. This phase carries most of the design weight.

### 6.1 Agent package layout

```
packages/agent/
  src/server.ts                 node:http, /ping, /invocations; validates the envelope; hands off to the session
  src/session.ts                BridgeSession: state, agent, MCP client, question queue, lastResult, memory adapter
  src/turn.ts                   runTurn(): the story of one turn, top to bottom, delegating to modules below
  src/turn-run.ts               TurnRun: one agent loop execution exposing waitForOutcome(deadline)
  src/mcp/client.ts             connect, initialize with elicitation capability, list tools, register elicitation handler, reconnect
  src/mcp/auth.ts               none | bearer | apiKey | oauthClientCredentials; secret fetched once at startup
  src/mcp/version.ts            protocol version switch (2025-11-25 now; slot for 2026-07-28)
  src/elicitation/queue.ts      PendingQuestion queue, one-at-a-time, answer timeout, cancel
  src/elicitation/question.ts   elicitation params → Question[] (D5); URL mode → decline with spoken explanation
  src/elicitation/answer-mapper.ts  AnswerHint + property schema → typed value (D6)
  src/agent/build-agent.ts      Strands Agent assembly: model, MCP tools, ask_user tool, system prompt
  src/agent/model.ts            createModel(config): BedrockModel or scripted test model (D10)
  src/agent/prompt.ts           load prompts/*.md at build time, fill {{placeholders}}
  src/agent/tools.ts            MCP tools → Strands tools; ask_user
  src/memory/store.ts           AgentCore Memory adapter (Phase 6; stub here)
  src/speech.ts                 model text → TTS-friendly plain text
  prompts/system.md, prompts/tool-result.md, prompts/elicitation.md
  Dockerfile                    Phase 4
```

### 6.2 The turn state machine

States: `cold`, `warming`, `ready`, `running`, `overrun`, `awaiting-answer`.

| Input | In state | Behavior |
|---|---|---|
| `warmup` | `cold` | Return `done` immediately; start `initialize`, `tools/list`, memory hydration in the background; → `warming` then `ready` |
| `warmup` | any other | Return `done` (idempotent) |
| `turn` | `warming` | Await warm-up (bounded by the deadline), then as `ready` |
| `turn` | `ready` | Start a `TurnRun`, `waitForOutcome(deadline)`: result → `done`; question → `awaiting-answer`; deadline → `overrun`, return `pending` |
| `turn` | `overrun` | Return `pending` without starting another run (the Lambda polls first, so this is rare) |
| `turn` | `awaiting-answer` | D7: cancel the pending elicitation, unwind (2 s cap), discard, then as `ready` |
| `answer` | `awaiting-answer`, matching `questionId` | Map the answer (D6); if more properties remain, return the next question; else resolve the elicitation (or append the user message for `ask_user` questions) and `waitForOutcome(deadline)` on the same run |
| `answer` | stale or unknown `questionId` | Treat as `turn` with `text` = the answer text; never drop what the user said |
| `poll` | `overrun` | Result ready → return it and → `ready`; still running → `pending` |
| `poll` | any other | `done` with empty speech (D9) |
| `cancel` | `awaiting-answer` | Resolve `{action: 'cancel'}`, unwind, → `ready` |
| `cancel` | `running` or `overrun` | Abort the run, clear `lastResult`, → `ready` |
| `cancel` | other | No-op, `done` |

Timers: `elicitation.answerTimeoutSeconds` cancels a pending question and logs it. `/ping` reports `HealthyBusy` only in `overrun` (subject to gate 2b).

`TurnRun.waitForOutcome(deadline)` resolves on whichever comes first: the agent loop finished, a question was queued, or the deadline passed. This single primitive serves `turn`, `answer`, and `poll`, which is what keeps `turn.ts` readable.

### 6.3 Tasks

- [x] `mcp/client.ts`: transport from `@modelcontextprotocol/sdk`, `capabilities: {elicitation: {}}`, read the negotiated protocol version from the transport after `initialize` and warn below 2025-11-25 (D34), tool list cache, elicitation handler path chosen by S1, reconnect on transport close with a single retry.
- [x] `mcp/auth.ts`: header injection for bearer and API key, Secrets Manager fetch at startup (skipped when `type: 'none'`), OAuth client credentials through the SDK auth provider.
- [x] `elicitation/queue.ts` and `elicitation/question.ts`: `PendingQuestion {id, elicitationId, property, schema, resolve}`, expects derivation (boolean → yesNo, `format: date` → date, integer or number → number, enum → choice, else text), required-first ordering (D5), answer timeout, cancel and decline.
- [x] `elicitation/answer-mapper.ts`: deterministic mappers with unit tests per `expects`; model fallback that asks Nova for a JSON object matching the property schema (only for `text` answers against non-string properties).
- [x] `agent/build-agent.ts`, `agent/tools.ts`, `agent/model.ts`: Strands Agent with `BedrockModel`, lowest reasoning setting (verify the Nova 2 parameter name), MCP tools, `ask_user` (D4), tool hint injection from `utterance.tool` and slots.
- [x] `agent/prompt.ts` and `prompts/*.md` per brief 5.2, with `{{serverName}}`, `{{serverInstructions}}`, `{{toolList}}`, `{{locale}}` placeholders. Keep `system.md` short; measure its token count.
- [x] `speech.ts`: strip markdown, bullets, URLs, code; collapse whitespace; leave SSML escaping to the frontend.
- [x] `turn-run.ts`, `turn.ts`, `session.ts`: the state machine above, with structured logs at every transition.
- [x] `server.ts`: `/ping`, `/invocations` with zod-validated envelope, error → `status: 'error'` with a spoken apology and a logged cause.
- [x] `packages/cli`: `chat` REPL (in-process, fake user and session, prompts the terminal for questions, `--debug` shows tool calls and timings, `--budget` to simulate the Alexa deadline), `chat --remote` stub that errors until Phase 4.
- [ ] Measure brief item 8 through the harness with `--debug`: 20 turns of "find hotels in Berlin from the fifth to the seventh of October for two guests". Record p50 and p95. Apply gate 8 if needed.
- [x] Tests: unit for the state machine (question, pending, poll, cancel, stale answer, D7), answer mapper, question derivation, speech cleanup; integration test with the scripted model (D10) against the sample server, including the `guests` elicitation round trip.

### 6.4 Exit criteria

- `npm run chat`: "find hotels in Berlin for October fifth to seventh" → agent asks for guests → "two" → spoken result. Weather works. Stop cancels a pending question cleanly (the sample server logs a cancelled elicitation, not a timeout).
- `npm test` covers the four state machine paths and the round trip without AWS credentials.
- A typical turn fits in the budget with headroom, or the owner has the numbers and gate 8 has been applied.

---

## 7. Phase 3: generator

Goal: `npm run generate` turns any reachable MCP server into a tool manifest and an Alexa interaction model, deterministically except for model-written utterances.

### 7.1 Tasks

- [x] `src/scan.ts`: reuse the agent's client settings (same auth module) to `initialize` and `tools/list`; clear failures for unreachable, unauthorized, and old protocol.
- [x] `src/manifest.ts`: intent name `PascalCase(tool.name) + 'Intent'`, argument to slot map, schema snapshot, server name and instructions, two example phrases (first utterance of the first two tools) for the greeting (D3).
- [x] `src/slots.ts`: mapping from brief 5.6 step 3 (date by format or name, number, `YesNoType`, enum types with entity resolution, `AMAZON.SearchQuery` otherwise). Enforce: one SearchQuery per intent, SearchQuery utterances carry a phrase and no other slot, extra free-text arguments left to elicitation. Unit tests per rule.
- [x] `src/utterances/model.ts`: 8 to 15 utterances per tool from Nova 2 Lite through the Bedrock Converse API, validated (slot names present, no forbidden characters, SearchQuery rules), deduplicated. `src/utterances/template.ts`: deterministic fallback when no credentials. `src/utterances/overrides.ts`: merge `skill-package/overrides/<locale>.utterances.json`.
- [x] `src/interaction-model.ts`: per-locale builder; adds answer intents (`AMAZON.YesIntent`, `AMAZON.NoIntent`, `DateAnswerIntent`, `NumberAnswerIntent`, `FreeTextAnswerIntent`), `FreeTextIntent`, standard intents, `YesNoType`, invocation name.
- [x] `src/write.ts`: "generated by alexa-skill-mcp-bridge, do not edit" header (JSON files get a top-level `_generated` field with the tool name and timestamp-free provenance), `.gitattributes` `linguist-generated` entries.
- [x] Snapshot tests against the sample server's tool list with the template fallback (deterministic).
- [ ] Nice to have after the ship point: `OrdinalAnswerIntent` (AMAZON.Ordinal) for `choice` questions, and a `AnswerChoiceType` seeded from every enum in the tool schemas.

### 7.2 Exit criteria

- Running `npm run generate` twice without credentials yields identical files.
- The generated model passes the Alexa developer console's model validation when uploaded (checked in Phase 5).
- Manifest and model exist for the sample server and are committed.

---

## 8. Phase 4: container plus CDK stack

Goal: the agent runs on AgentCore Runtime and `npm run chat -- --remote` works against it.

### 8.1 Tasks

- [x] `packages/agent/Dockerfile`: multi-stage, `node:22-slim` arm64, workspace install with `--omit=dev`, prune to `agent` and `core`, `NODE_ENV=production`, non-root user, `EXPOSE 8080`. Target image size under 200 MB; measure cold start against the S2 numbers.
- [x] `npm run agent:dev`: build and run locally with Docker or Finch, `BRIDGE_CONFIG` from `bridge.config.ts`, curl examples in the script output.
- [x] `infra/bin/app.ts` and `infra/lib/alexa-mcp-bridge-stack.ts` reading `bridge.config.ts` through `core.loadConfigFile`:
  - [x] Alexa Skill Lambda: `NodejsFunction`, Node 22, arm64, 8 s, 512 MB, env `BRIDGE_CONFIG`, `AGENT_RUNTIME_ARN`; `alexa-appkit.amazon.com` permission with `eventSourceToken` when `skill.id` is set, loud `Annotations.addWarning` when not.
  - [x] Agent image: `DockerImageAsset` (linux/arm64) → AgentCore `Runtime` with explicit `lifecycleConfiguration` from config, environment from config, execution role: `bedrock:InvokeModel*` on the configured inference profile and the underlying foundation model ARNs in every region the profile routes to, Memory data-plane actions on the memory ARN, `secretsmanager:GetSecretValue` on the named secret, logs.
  - [x] Lambda role: `bedrock-agentcore:InvokeAgentRuntime` on the runtime and its `DEFAULT` endpoint.
  - [x] AgentCore Memory: short-term always; long-term strategies when `memory.longTerm` (wired in Phase 6, resource created here).
  - [x] Log groups with `logRetentionDays`.
  - [x] ~~AWS Budgets cost budget~~ removed 2026-09-04 (D35): the alarm needed an email address in tracked config.
  - [x] Outputs: Lambda ARN, runtime ARN, memory ID, gateway URL when enabled.
- [x] `scripts/check-model-access.ts`: one `Converse` call per configured model, prints a pass or the console step to enable access.
- [x] `scripts/deploy.ts`: validate config, check model access, `cdk deploy --outputs-file`, print outputs, print the cost note (what starts costing money and when), print the next step (skill.json ARN, or "set skill.id and deploy again").
- [x] `scripts/destroy.ts`: `cdk destroy`, delete ECR images left by the asset, remind about `ask smapi delete-skill`.
- [x] `chat --remote`: `InvokeAgentRuntime` with `runtimeSessionId = hashId(fakeUser)`, same REPL.
- [ ] Re-run S2 sequences 1 and 2 against the real container and record numbers.

### 8.2 Exit criteria

- `npm run deploy` from a clean account (bootstrapped, model access on) succeeds in one go.
- `npm run chat -- --remote` completes the hotel round trip with an elicitation gap of at least 30 s.
- `cdk synth` in CI passes without credentials or Docker.
- `npm run destroy` leaves no ECR images or log groups behind.

---

## 9. Phase 5: Alexa Skill Lambda, Alexa Skill package, device end to end

Goal: ship point. The bridge works on an Echo against the sample server.

### 9.1 Lambda layout

```
packages/skill-lambda/
  src/index.ts              SkillBuilder wiring, withSkillId (D15), error handler that speaks an apology
  src/bridge.ts             BridgeClient: envelope, InvokeAgentRuntime, AbortController, poll-first (D16)
  src/render.ts             TurnOutput → ASK response: SSML with escaping, reprompt when the session stays open, session attributes
  src/session-attrs.ts      typed accessors: pendingQuestion {id, expects, source}, awaitingResult
  src/manifest.ts           loads generated/tool-manifest.json through core's schema
  src/greeting.ts           D3
  src/handlers/launch.ts, tool-intent.ts, answers.ts, free-text.ts, standard.ts
  generated/tool-manifest.json
```

Every handler reads as: build `TurnInput` → `bridge.turn()` → `render()`.

### 9.2 Tasks

- [x] `bridge.ts`: hashes IDs, builds the envelope with `budgetMs` = 6500 minus elapsed poll time, aborts at the budget, maps abort and transport errors to `{status: 'pending'}` (for turns) or `{status: 'error'}` with the configured message.
- [x] Handlers per brief 5.5: launch (warm-up, cold-start message ends the session), generic tool intent (manifest lookup, slot values with entity resolution passed as `SlotValue`), answer intents gated on a pending question, free text, help, stop and cancel (`cancel` then goodbye), fallback, `SessionEndedRequest` (`cancel`).
- [x] `render.ts`: escape `& < >`, wrap in `<speak>`, set reprompt whenever `endSession` is false, store `pendingQuestion` when status is `question`, set `awaitingResult` when `pending`.
- [x] `skill-package/skill.json` (manifest with placeholders for the Lambda ARN), `ask-resources.json`, generated `interactionModels/custom/en-US.json`, `overrides/` folder with an example.
- [ ] Deploy order per S6 outcome (S6 not run; the two-deploy order stands and `npm run deploy` prints the exact next step; `ask deploy` runs from the repo root, D29). Either implement `scripts/create-skill.ts` (create without endpoint, write `.ask/ask-states.json`, print the ID) or keep the two-deploy order with clear output. Optional: `ask smapi set-skill-enablement` for the development stage.
- [ ] Device test script (manual checklist in `docs/troubleshooting.md` later): launch cold, launch warm, hotel search with elicitation, answer with a number, answer with "no" (decline), change topic mid-question (D7), overrun (simulate with `slow` tool on the sample server behind a flag), stop.
- [ ] Verification items 1, 7, 8, 10 confirmed end to end on a device; record in section 16.
- [x] Unit tests: render (SSML, reprompt, attributes), answer-intent gating, manifest lookup, greeting.

### 9.3 Exit criteria

- On an Echo: "Alexa, open <invocation>", cold-start message on first launch if it applies, second launch greets; hotel search with elicitation round trip; stop ends cleanly.
- CloudWatch shows hashed IDs only.
- The quick start in brief section 8 has been followed literally from a fresh clone and works.

---

## 10. Phase 6: memory hydration, long-term toggle, Gateway toggle

### 10.1 Tasks

- [x] `memory/agentcore-memory.ts` (store and hydrate in one module): `CreateEvent` per exchange under `(actorId, sessionId)`; implements the Strands conversation manager or memory store interface (confirm the exact interface name in the installed SDK). Failures log and never break a turn.
- [x] `memory/hydrate.ts`: on warm-up, `ListSessions(actorId)` → most recent sessions → `ListEvents` → last `hydrateLastEvents` events into the agent's message history. With `memory.longTerm`, `RetrieveMemoryRecords` for the actor's preference namespace and inject a short "known about this user" block into the system prompt.
- [x] CDK: long-term strategies (user preference, summary) when `memory.longTerm`; cost note in `docs/cost.md`.
- [x] Gateway toggle (CDK and client switch built; the round trip through a deployed Gateway is not yet tested): CDK `Gateway` plus MCP target (sessions and response streaming on, NoAuth or credential provider from config); agent points at the gateway URL with a SigV4-signing `fetch` passed to the transport. Test the elicitation round trip through the Gateway and record whether it still requires the client to hold the stream.
- [ ] `chat` shows hydrated context with `--debug`.
- [x] Tests: store adapter with a mocked client; hydration ordering.

### 10.2 Exit criteria

- Close the Alexa Skill, reopen within 20 minutes: the agent remembers the last search. Reopen after a reclaim: history is rehydrated from Memory.
- `features.gateway: true` deploys and the hotel round trip works through the Gateway.

---

## 11. Phase 7: docs and release pass

### 11.1 Tasks

- [x] `README.md`: what it is, the "reproduces mechanics, not Alexa's judgment" statement, quick start (about ten steps per brief 8, order per S6), `npm run destroy` on the first screen, cost summary, links to docs.
- [x] `docs/architecture.md`: the diagram, the turn story, elicitation parking, the state machine table, and every Phase 0 outcome with numbers.
- [x] `docs/config.md`: every field, default, and effect. Secrets command.
- [x] `docs/cost.md`: worked example per turn (tokens, runtime CPU and memory, Memory events, logs), idle cost, long-term extraction, Gateway per call.
- [x] `docs/troubleshooting.md`: cold-start message loops, tunnel idle timeouts, MCP SDK 60 s server-side timeout, model access errors, open Lambda permission warning, session ID errors, "still working" loops.
- [x] `CONTRIBUTING.md` final, `CLAUDE.md` refreshed against the real layout, `spikes/README.md` per D11.
- [ ] Dependency and license check, `npm audit`, final CI green, tag `v1.0.0`.

### 11.2 Exit criteria

- A developer who has never seen the repo follows the README on a fresh account and reaches a talking Echo. Ideally tested by someone other than the owner.

---

## 12. Cross-cutting

Testing:

- Unit tests sit next to code as `*.test.ts`; vitest workspace at the root.
- Integration test lives in `packages/cli/test/roundtrip.test.ts`: starts the sample server on an ephemeral port, runs the in-process agent with the scripted model, asserts the elicitation round trip. Credential-gated `test:live` runs the same with the real model.
- CI is `npm test` plus `cdk synth`. Nothing in CI touches AWS.

Logging and privacy:

- JSON lines with `level`, `msg`, `actorId` (hashed), `sessionId` (hashed), `turnId`, `state`, `elapsedMs`. Tool arguments logged only when `features.debug` is on.
- Spoken text on errors comes from config or a small fixed set in `core`; the cause goes to the log.

Cost guardrails in code:

- `runtime.idleTimeoutMinutes` and `maxLifetimeHours` always rendered into `lifecycleConfiguration`.
- `deploy.ts` prints the cost note every time; there is no budget gate (D35).
- Log retention always set; no log group without it.

Conventions:

- Intent name `PascalCase(tool.name) + 'Intent'`; slot name `camelCase(argument)`.
- Generated JSON carries a `_generated` field and a `.gitattributes` entry.
- Prompts are markdown with `{{placeholders}}`; no prompt strings in code.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MicroVM paused between invocations (gate 2a/2b) | Medium | Breaks elicitation parking | Phase 0 first; fallbacks listed; owner decides early |
| Cold start above budget | Medium | Cold-start message on every first launch | Image tuning, warmer Lambda fallback |
| Nova 2 Lite tool-use latency or quality | Medium | Turns overrun or pick wrong tools | Prompt diet, tool-list injection, Haiku 4.5 profile as the documented switch |
| SDK API names in the brief drift (`McpClient`, `ElicitationCallback`, CDK L2) | High | Rework | Verify at install time; keep wrappers thin so swaps stay local |
| Tunnel drops the elicitation stream | Medium | Elicitation times out on device tests | Server-side `ping`, documented timeouts |
| Alexa NLU maps free text poorly to generated intents | Medium | Wrong tool hints | Hints are hints; `FreeTextIntent` is the escape hatch; utterance overrides |
| Two-deploy order confuses users | Low | Setup friction | S6 cleaner order or very explicit deploy output |

---

## 14. Open questions for the owner

1. Is there a hackathon deadline that should decide whether Phase 6 Gateway work is in or out of the first tag?
2. Keep `spikes/` in the repo after the docs pass (D11), or delete once `docs/architecture.md` records the outcomes?
3. Should this workspace directory become the repo, or is the repo created elsewhere and these two documents moved in?
4. GitHub Actions on the personal account is assumed for CI. Any objection?
5. Preferred handling if S6 shows SMAPI accepts an Alexa Skill without an endpoint: a `scripts/create-skill.ts` helper, or documented CLI commands only?

---

## 15. Definition of done for v1

- Every hard requirement in brief section 2 holds and is covered by a test or a documented manual check.
- All ten verification items have recorded outcomes.
- Quick start works from a fresh clone on a fresh account.
- `npm run destroy` leaves nothing that costs money.
- The README says plainly that the bridge reproduces mechanics, not Alexa's model judgment.

---

## 16. Decision log and verification outcomes

Append-only. Move to `docs/architecture.md` in Phase 7.

| Date | Item | Outcome | Consequence |
|---|---|---|---|
| 2026-09-03 | Plan v1 written | Decisions D1 to D17 adopted as defaults | Revisit per the "revisit if" column |
| 2026-09-03 | Toolchain | Node 22.23 via nvm (system default is 18; `nvm use` at the root). Docker 28 (arm64 host). ASK CLI 2.28 logged in. AWS CLI 2.1.33 predates Bedrock; the JS SDK is used for model checks. `cloudflared` not installed. CDK bootstrapped in us-east-1 (bootstrap version 30) | D18, D19, D23 |
| 2026-09-03 | SDK surfaces (brief "verify before you rely on it") | Installed: `@strands-agents/sdk` 1.16.0, `@modelcontextprotocol/sdk` 1.30.0, `aws-cdk-lib` 2.268.0, `@aws-sdk/client-bedrock-agentcore` 3.1125. Strands: `McpClient`, `ElicitationCallback = (context, params) => Promise<ElicitResult>` registered through `setRequestHandler(ElicitRequestSchema)`, advertises `capabilities.elicitation {form, url}`; `BedrockModel` takes `additionalRequestFields` → `additionalModelRequestFields`; `MemoryStore` interface `{name, writable, search, add?, addMessages?}`; hooks `BeforeToolCallEvent`, `AfterToolCallEvent`, `AfterModelCallEvent`, `MessageAddedEvent`. MCP SDK: `StreamableHTTPClientTransport.protocolVersion` getter after initialize, `LATEST_PROTOCOL_VERSION = 2025-11-25`, `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` applies to every `request()` including `callTool` and server-side `elicitInput`, `ClientCredentialsProvider` in `client/auth-extensions.js`. CDK stable module: `Runtime.lifecycleConfiguration {idleRuntimeSessionTimeout, maxLifetime}` (Duration), `AgentRuntimeArtifact.fromAsset(dir, {platform})`, `runtime.grantInvoke()`, `Memory.memoryStrategies` with `MemoryStrategy.usingBuiltInUserPreference()` and `usingBuiltInSummarization()`, `Gateway` with `NoAuthAuthorizer`, `gateway.addMcpServerTarget({endpoint, credentialProviderConfigurations})` (credential providers required; `GatewayCredentialProvider.fromIamRole()` works), `MCPProtocolVersion` enum stops at 2025-06-18 but `.of('2025-11-25')` synthesizes. AgentCore data plane: `InvokeAgentRuntime {agentRuntimeArn, runtimeSessionId, payload}` → `response` stream; Memory `CreateEvent {memoryId, actorId, sessionId, eventTimestamp, payload:[{conversational:{content:{text}, role}}]}`, `ListEvents`, `ListSessions`, `RetrieveMemoryRecords {namespace, searchCriteria:{searchQuery, topK}}` | Brief's names hold except that Strands' `McpClient` is not used for calls (D21) |
| 2026-09-03 | Nova 2 Lite reasoning parameter | `additionalModelRequestFields: {reasoningConfig: {type: 'enabled', maxReasoningEffort: 'low'}}` accepted by `Converse` on `us.amazon.nova-2-lite-v1:0`; model access confirmed in the owner's account (us-east-1) | `agent/model.ts` |
| 2026-09-03 | S1 strands-elicitation (brief item 1) | Both paths work: Strands `elicitationCallback` and the raw `setRequestHandler(ElicitRequestSchema)` receive the request and accept a promise settled 20 s later; the tool result arrives (20013 ms and 20005 ms). Negotiated protocol 2025-11-25; the server sees `clientCapabilities.elicitation.form`. A 65 s wait fails through Strands at 60001 ms (`callTool` uses the SDK default timeout) and succeeds through the raw client with an explicit timeout (65011 ms; also 55 s and 62 s in `bracket.ts`). An earlier "long-raw" failure was a leaked timer in the spike script, since fixed | Item 1 confirmed. D21, D26 |
| 2026-09-03 | S4 nova-latency (brief item 8, baseline) | One run each, system prompt about 600 tokens, two tools, one tool round trip. `low`: 5697 ms (2409 + 3288), 3097 input / 622 output tokens. `off` (no reasoningConfig): 4165 ms (1791 + 2374), 2997 input / 160 output tokens. Tool picked correctly both times. The 20-run p50/p95 has not been run (it is a model-call loop; needs the owner's go-ahead: `cd spikes/nova-latency && node spike.ts --runs 20`) | D20. Gate 8 is borderline at `low` and has about 2.3 s headroom at `off`. Input tokens are high (about 3000); Phase 2 measurement through the harness should check the tool-result size and the system prompt |
| 2026-09-03 | S5 cdk-synth-gateway (brief item 9, synth) | Synth passes. `AWS::BedrockAgentCore::Runtime` renders `LifecycleConfiguration {IdleRuntimeSessionTimeout: 1200, MaxLifetime: 28800}` and `AgentRuntimeArtifact.ContainerConfiguration`. Memory renders `UserPreferenceMemoryStrategy` and `SummaryMemoryStrategy`. Gateway renders `AuthorizerType NONE` and `ProtocolConfiguration.Mcp.SupportedVersions ['2025-11-25']` (CloudFormation acceptance of that version is unverified until a deploy). MCP server target renders with `CredentialProviderType GATEWAY_IAM_ROLE`. The CloudFormation schema has `StreamingConfiguration.EnableResponseStreaming` but no sessions configuration | Item 9 confirmed for the L2 surface. Gateway sessions cannot be enabled from this CDK version; Phase 6 must check the L1 schema or the API before relying on the Gateway path for elicitation |
| 2026-09-03 | Node 22 type stripping | `import()` of `bridge.config.ts` works on Node 22.23 with no flags and no warning | D23 |
| 2026-09-03 | S2, S3, S6 | Written, not run. S2 and S6 deploy billable resources; S3 needs `cloudflared` | Items 2, 3, 4, 5, 6, 7, 10 remain open |
| 2026-09-03 | Phase 1 | Scaffold, core, sample server, CI file in place. `npm run build`, `npm test`, `npm run lint` pass locally. CI has not run on GitHub yet (no remote) | Phase 1 exit criteria met locally |
| 2026-09-03 | Phase 2 | Agent package and CLI harness in place; state machine and round trip tests pass with the scripted model against the sample server (question, answer, re-ask, decline, stale answer, cancel, D7 topic change, overrun and poll, cancel during overrun, MCP server unreachable) | The measurement of item 8 through the harness (20 turns) waits for the owner's go-ahead |
| 2026-09-03 | Live round trip through the harness (Phase 2 exit) | With the real model against the sample server: hotel search with the guests elicitation and spoken answer in 2.5 s (two model calls), weather turn in 1.4 s. First attempts failed: Nova returned an empty message (2 output tokens) on a tool result with both `json` and `text` blocks, and hit the 400-token cap with a think-aloud answer on the hotel result. Raw Converse replication: json+text → 545 input tokens, empty; text only → 25 tokens, good; json only → 26 tokens, good | D28. Item 8 through the harness is comfortably inside the budget for these turns; the 20-run measurement is still owed |
| 2026-09-03 | Phase 3 | Generator: scan, slot mapping, manifest, template utterances, model utterances with fallback, overrides, interaction model with answer and standard intents, generated-file markers. 15 tests including a snapshot and a determinism check. Artifacts for the sample server generated with `--no-model` and committed (`_generated.source` shows the default port 3000; generation ran on 3210 because Docker Desktop's `open-webui` container holds 3000 on the dev machine) | Phase 3 exit criteria met except the console validation (Phase 5) |
| 2026-09-03 | Phase 4 | Dockerfile (three-stage, arm64, production deps only, build-only tsconfig), `.dockerignore` with negations so the context is manifests plus core and agent sources, CDK stack with tests (lifecycle, Lambda 8 s arm64, Alexa permission with and without `eventSourceToken`, memory strategies, gateway toggle with streaming override, budget, retention, IAM grants), scripts, `chat --remote`. `npm run synth` passes without credentials. Image size: see the next row | Not deployed: `npm run deploy` creates billable resources and waits for the owner |
| 2026-09-03 | Phase 5 | Alexa Skill Lambda: handlers per brief 5.5, poll-first bridge client (D16), render with SSML escaping and session attributes, `withSkillId` (D15), manifest bundled by JSON import; 19 tests. `skill.json`, root `ask-resources.json` (D29), overrides example | Device test, console model validation, and items 1, 7, 8, 10 end to end are owed after a deploy |
| 2026-09-03 | Phase 6 | AgentCore Memory adapter (record, hydrate with role alternation, preferences into the prompt) with mocked-client tests; explicit namespaces (D31); SigV4 gateway fetch and client switch on `MCP_GATEWAY_URL` | The Gateway elicitation round trip and the "reopen within 20 minutes" memory check need a deployment |
| 2026-09-03 | Phase 7 | README quick start, `docs/architecture.md` (turn story, state table, parking, verification table), `docs/config.md`, `docs/cost.md`, `docs/troubleshooting.md`, `CLAUDE.md` refreshed | `npm audit`, tag `v1.0.0`, and a fresh-account walk-through remain |
| 2026-09-03 | Agent image (brief item 5, size part) | `docker build --platform linux/arm64` succeeds. node:22-slim with all production deps: 476 MB. node:22-alpine with `--omit=optional` (drops Strands' optional `@tobilu/qmd`, which pulls node-llama-cpp and TypeScript): 301 MB, of which node_modules is 63 MB (110 packages) and the bridge's own code under 1 MB. Smoke test: `/ping` Healthy, `warmup` answers in 5 ms, the container connects to a sample server on the host (`host.docker.internal`), lists tools, and logs `warm-up complete` | The 200 MB target in D17 is not reachable with an official Node base image (the Node binary alone is about 100 MB); cold start against S2's numbers is still the measurement that matters and needs a deploy |
| 2026-09-03 | Dependency audit | npm audit did not finish (registry timeout on the dev machine); rerun with npm audit --omit=dev | Re-run before tagging v1.0.0 |
| 2026-09-04 | Owner's first run | Three failures reproduced: `npm run sample:start` crashed with `EADDRINUSE` on 3000 (Docker's open-webui), `npm run chat` failed with "Cannot find module packages/cli/dist/chat.js" (the script pointed at `dist/chat.js`; the CLI builds to `dist/src/`), and `npm test` under the shell's default Node 18 failed 16 tests. Fixed: script path, port 3939 with a named error, engine-strict plus a Node check before every script, `npm run doctor`, readable chat errors with guidance, README rewritten around three tracks (local, cloud, device) with install commands, "Echo" replaced by "Alexa+ device" everywhere the repo authors text | D32, D33. `npm run doctor` and a piped `npm run chat` smoke pass on the dev machine |
| 2026-09-04 | MCP protocol floor removed | `mcp.protocolVersion` deleted from the config; `assertProtocolVersion` split into `requireProtocolVersion` (throws only when the server reports no version) and `alexaPlusVersionWarning`. Verified live the same day: DeepWiki, Context7, Cloudflare docs, Exa, Firecrawl, Hugging Face and CoinGecko negotiate 2025-11-25; Microsoft Learn and grep.app negotiate 2025-06-18; AWS Knowledge and GitMCP negotiate 2025-03-26 | D34; brief section 2 requirement 1 rewritten |
| 2026-09-04 | Public-repo hardening (owner request after a security review) | Budget alarm removed (D35). `.env` override layer in `packages/core/src/config.ts` with `.env.example` and `!.env.example` in `.gitignore` (D36). `scripts/check-leaks.ts` plus `.githooks/pre-commit` and a CI step; generated files no longer carry `_generated.source` (D37). Invocation name and Alexa Skill title are now `bridge demo`; artifacts regenerated. Accepted rather than fixed, and written up in the README's "Security, privacy, and what to keep out of git": the Lambda permission stays open until `skill.id` is set (recommended step, not enforced), `skill-package/skill.json` holds a real Lambda ARN locally, MCP server instructions reach the system prompt, `features.debug` logs spoken values, and memory keeps utterances for 30 days | Review found nothing wrong with secret handling itself: names only, fetched at runtime, never logged |
