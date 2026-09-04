# CLAUDE.md

Guidance for coding agents working in `alexa-skill-mcp-bridge`. Humans read the README; you read this.

## What this is

A bridge that lets a developer test an MCP server on a physical Echo as if it were an Alexa+ add-on. An Alexa skill (thin Lambda) forwards each turn to an agent on Amazon Bedrock AgentCore Runtime. The agent (Strands Agents, Nova 2 Lite) is the MCP client: it picks tools, fills arguments, handles elicitation, and turns results into short spoken answers. It reproduces the mechanics of Alexa+, not Alexa's own model judgment.

## Read first

1. [alexa-skill-mcp-bridge-brief.md](alexa-skill-mcp-bridge-brief.md): the requirements. Section 2 lists the hard requirements, section 10 the code style, section 12 the assumptions that must be verified against live AWS before code is built on them.
2. [EXECUTION-PLAN.md](EXECUTION-PLAN.md): phases, decisions D1 to D17, verification gates, and the decision log. Tick tasks as they land. Append decisions and verification outcomes to its section 16 until `docs/architecture.md` exists.

If the brief and the plan disagree, the brief wins; say so and fix the plan.

## Repo state

Scaffolded through plan Phase 7 as of 2026-09-03: every package below exists, `npm run build`, `npm test`, `npm run lint`, and `npm run synth` pass. Not yet done: the deploy-dependent spikes (S2, S3, S6), a device test, and the 20-run latency measurement. See the plan's section 16.

## Layout

```
bridge.config.ts             THE config file. Typed, commented, zod-validated. Secrets by name only.
packages/core                Turn contract, config schema and loaders, hashId, manifest schema, logger. No AWS SDK deps.
packages/agent               AgentCore Runtime container. MCP client, elicitation parking, agent loop, prompts, memory.
packages/skill-lambda        ASK SDK handlers. Reads generated/tool-manifest.json. No MCP or model logic.
packages/generator           MCP scan → tool manifest + interaction model + utterances.
packages/cli                 npm run chat: in-process REPL, or --remote against the deployed runtime.
infra                        CDK app, one stack: Lambda, agent image, AgentCore Runtime, Memory, budget, optional Gateway.
skill-package                ASK CLI project. skill.json, generated interaction model, overrides/.
examples/sample-mcp-server   Streamable HTTP server with search_hotels (elicits guests) and get_weather.
spikes                       Day-one verification probes. Outside the npm workspaces. Re-runnable.
docs                         architecture, config, cost, troubleshooting.
scripts                      deploy, destroy, check-model-access, agent-dev. Run by Node 22 directly (type stripping).
ask-resources.json           ASK CLI project file at the root; `ask deploy` runs from here and reads skill-package/.
```

## Commands (once scaffolded)

| Command | What it does |
|---|---|
| `npm install` | Workspace install. npm only, never pnpm or yarn. |
| `npm run build` | `tsc -b` across packages. |
| `npm test` | vitest, no AWS credentials needed. |
| `npm run lint` | ESLint and Prettier check. |
| `npm run sample:start` | Sample MCP server on port 3000. |
| `npm run chat` | In-process agent REPL against `mcp.url`. Fastest dev loop. `--debug` shows tool calls and timings. |
| `npm run chat -- --remote` | Same REPL through the deployed runtime. |
| `npm run generate` | Rebuild manifest and interaction model from the MCP server. Run after any config change that touches `mcp.*`, `skill.invocationName`, or `skill.locales`. |
| `npm run agent:dev` | Build and run the container locally on 8080. |
| `npm run synth` | `cdk synth`. Safe, no AWS calls. |
| `npm run deploy` | Pre-flight, `cdk deploy`, prints outputs and the cost note. Creates billable resources. |
| `npm run destroy` | `cdk destroy` plus ECR cleanup. |

## Do not run without being asked

`npm run deploy`, `cdk deploy`, `cdk destroy`, `npm run destroy`, `ask deploy`, `ask smapi *`, anything that creates, changes, or deletes AWS or Alexa resources, and anything that calls Bedrock in a loop. Local work (`chat`, `test`, `synth`, the sample server, a single model call to check latency) is always fine. When a spike needs a deploy, say what it will create and what it costs before running it.

## Config rules

- `bridge.config.ts` is the only developer input. Every consumer (generator, Lambda, agent, CDK) validates it through `packages/core` at load time. Never read config fields from anywhere else.
- Secrets never live in config or in the repo. Config holds a Secrets Manager secret name; the runtime fetches the value at startup.
- Every field has a safe default except `mcp.url`. Adding a field means adding its default, its zod rule, its comment in `bridge.config.ts`, and its entry in `docs/config.md`.
- Locale is a config value. Nothing hardcodes `en-US`, even though it is the only locale shipped.

## Generated files: never edit by hand

- `packages/skill-lambda/generated/tool-manifest.json`
- `skill-package/interactionModels/custom/*.json`

They carry a `_generated` marker and a `.gitattributes` entry. Regenerate with `npm run generate`. Developer additions to utterances go to `skill-package/overrides/<locale>.utterances.json`, which survives regeneration. Handlers are never generated; generated artifacts are data only.

## Hard constraints (do not "fix" these)

- MCP spec 2025-11-25 or later over Streamable HTTP. The client declares `capabilities.elicitation` at `initialize`. Elicitation arrives on the open `tools/call` stream and is parked in the container between Alexa turns. The generator and the agent refuse servers that negotiate an older version.
- The agent call gets 6500 ms inside Alexa's 8 s limit. Every design choice in the turn path respects that number, which comes from `turn.budgetMs`.
- Node 22, TypeScript everywhere, npm workspaces. The container image is linux/arm64; an x86 image fails silently on AgentCore.
- us-east-1, one CDK stack, stable `aws-cdk-lib/aws-bedrockagentcore` constructs, `lifecycleConfiguration` always set explicitly.
- No DynamoDB in v1. State lives in Alexa session attributes, AgentCore Memory, and the microVM.
- `packages/core` has no AWS dependencies. Frontends contain no MCP or model logic. The agent knows nothing about Alexa.
- Nothing runs always-on. Every default that costs money is documented where the cost occurs.
- `TurnOutput.visual` stays `null`. Keep `_meta.ui.resourceUri` in the tool-result type so widgets can be added later.
- Raw Alexa user and session IDs are hashed with `core.hashId()` before they reach AWS or any log.

## Code style (from the owner)

- Clean and understandable. Short comments where they help; no narration of the obvious.
- The sophisticated work (MCP session, elicitation parking, memory, prompt assembly, answer mapping) sits in `packages/agent`. Skill handlers stay thin: build `TurnInput`, call `bridge.turn()`, render `TurnOutput`.
- No black boxes. `packages/agent/src/turn.ts` reads top to bottom as the story of one turn and delegates to well-named modules. Someone reading `skill-lambda` understands the flow without opening `agent`; someone reading `turn.ts` understands elicitation without reading the MCP client wrapper.
- One file per concern, small modules, explicit types at boundaries, zod at every input edge (config, invocation payloads, MCP results, manifest, slot values).
- Errors become short spoken messages at the edge and structured logs inside. Never speak raw error text or JSON.
- Prefer deterministic code over a model call whenever the mapping is knowable (answer mapping, slot mapping). The model is for judgment, not parsing.
- Prompts are markdown files in `packages/agent/prompts` with `{{placeholders}}`. No prompt strings in TypeScript.
- Docs are plain, concise, and decision-oriented.

## Testing

- Unit tests next to the code as `*.test.ts` with vitest. Required coverage: generator slot mapping and manifest, the answer-to-schema mapper, the turn state machine (question, pending, poll, cancel, stale answer).
- Integration: the in-process harness against the sample server with a scripted model, including one elicitation round trip. Must pass without AWS credentials. A credential-gated `test:live` variant uses the real model.
- CI is `npm test` plus `cdk synth`. Keep it that way.

## Verify before you rely on it

The brief names SDK surfaces from memory. These were checked against the installed versions on 2026-09-03 (plan section 16); re-check after any upgrade and record the result in the plan's decision log:

- Strands TS: `McpClient` (not used for calls, see D21), `ElicitationCallback`, `BedrockModel` (`additionalRequestFields`), the memory store or conversation manager interface, the reasoning-effort parameter for Nova 2 Lite (`reasoningConfig.maxReasoningEffort`).
- MCP SDK: `StreamableHTTPClientTransport`, `ElicitRequestSchema`, how to read the negotiated protocol version after `initialize`, the 60 s default request timeout on the server side.
- CDK: `Runtime.lifecycleConfiguration` property names, `DockerImageAsset` as the runtime image, `GatewayTarget` NoAuth.
- AgentCore: `runtimeSessionId` constraints, `/ping` `HealthyBusy` semantics, whether the microVM keeps running between invocations.

Anything in brief section 12 is an assumption until a spike under `spikes/` has confirmed it. Items 1, 8 (baseline), and 9 (synth) are confirmed; 2 to 7 and 10 wait for a deploy. Do not build on the open ones before then.

Two things learned the hard way that the code now enforces:

- A tool result sent to Nova must carry one content block, `json` or `text`, never both (D28).
- `tools/call` must use an explicit timeout above the SDK's 60 s default, or a spoken answer arrives too late (D21, D26).

## Working habits here

- Before changing the turn flow, read `packages/agent/src/turn.ts` and the state machine table in the plan (section 6.2) or `docs/architecture.md`.
- Prettier runs on save in CI's `npm run lint`; when editing files programmatically, run `npm run format` first so exact-match edits land on formatted text.
- A new dependency needs a one-line reason in the commit message. Keep the count low; contributors should not need to learn a framework.
- Do not widen scope from the brief's section 11 (widgets, web frontend, account linking, other locales, 2026-07-28 elicitation, progressive responses). Leave hooks, do not build them.
- When a task finishes, tick it in the plan. When a decision is made that the brief did not make, add a row to the plan's decision table with a "revisit if" condition.
- Commit messages describe why, not what. Never commit `bridge.config.ts` changes that contain a real customer URL or a skill ID belonging to someone else.
