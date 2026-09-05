# AGENTS.md

Guidance for any coding agent working in `alexa-skill-mcp-bridge`: Claude Code, Cursor, Copilot, Codex,
Aider, whichever you use. Humans read the README; you read this. `CLAUDE.md` is a symlink to this file so
tools that look for their own filename find it; keep one copy and add a pointer rather than a fork.

## What this is

A bridge that lets a developer test an MCP server on a physical Alexa+ device as if it were an Alexa+ add-on. An Alexa Skill (thin Lambda) forwards each turn to an agent on Amazon Bedrock AgentCore Runtime. The agent (Strands Agents, Nova 2 Lite) is the MCP client: it picks tools, fills arguments, handles elicitation, and turns results into short spoken answers. It reproduces the mechanics of Alexa+, not Alexa's own model judgment.

## Read first

1. [README.md](README.md): what the bridge is, the three tracks, and the security section listing what must never reach a commit.
2. [docs/architecture.md](docs/architecture.md): the turn story, elicitation parking, the state machine table, and what has been verified against live AWS.
3. [docs/decisions.md](docs/decisions.md): every decision D1 to D37 with its rationale and the condition that would reverse it, plus the dated verification log. Read the relevant row before changing something that looks arbitrary; it usually is not.

The code is the source of truth. Where a document disagrees with the code, the code wins and the document is the bug. [docs/history/](docs/history/) holds the original brief and execution plan, frozen and unmaintained: provenance, never instruction.

## Repo state

Complete and green as of 2026-09-05: every package below exists, and `npm run build`, `npm test`, `npm run lint`, `npm run synth`, and `npm run check:leaks -- --all` pass. Not done, none of it blocking local work: the deploy-dependent spikes (S2, S3, S6), a device test, and the 20-run latency measurement. The verification log in [docs/decisions.md](docs/decisions.md) says what is confirmed and what is still an assumption.

## Layout

```
bridge.config.ts             THE config file. Typed, commented, zod-validated. Ships committable; `.env` overrides
                             the developer-specific fields (D36). Secrets by name only.
packages/core                Turn contract, config schema and loaders, hashId, manifest schema, logger. No AWS SDK deps.
packages/agent               AgentCore Runtime container. MCP client, elicitation parking, agent loop, prompts, memory.
packages/skill-lambda        ASK SDK handlers. Reads generated/tool-manifest.json. No MCP or model logic.
packages/generator           MCP scan → tool manifest + interaction model + utterances.
packages/cli                 npm run chat: in-process REPL, or --remote against the deployed runtime.
infra                        CDK app, one stack: Lambda, agent image, AgentCore Runtime, Memory, optional Gateway.
skill-package                ASK CLI project. skill.json, generated interaction model, overrides/.
examples/mcp-server-harness  Shared Streamable HTTP plumbing and the console wire log for the examples.
examples/national-parks-mcp-server  THE default example: find_park and plan_park_visit over a committed
                             nps.gov extract (14 parks). Elicits only when a request is underdetermined.
examples/hotels-weather-mcp-server   The other example: search_hotels (elicits guests) and get_weather.
spikes                       Day-one verification probes. Outside the npm workspaces. Re-runnable.
docs                         architecture, config, cost, decisions, onboarding, troubleshooting, history/ (frozen brief and plan).
.claude/commands             Thin entry points (/onboard). One line each; the procedure lives in docs/.
scripts                      deploy, skill-deploy, destroy, doctor, check-leaks, check-model-access, agent-dev. Run by Node 22 directly.
ask-resources.json           ASK CLI project file at the root; `ask deploy` runs from here and reads skill-package/.
```

## Commands

| Command | What it does |
|---|---|
| `npm install` | Workspace install. npm only, never pnpm or yarn. |
| `npm run doctor -- --track local\|cloud\|skill` | Prerequisite check per track. Prints the exact fix for whatever is missing; the state oracle the onboarding procedure leans on. |
| `npm run build` | `tsc -b` across packages. |
| `npm test` | vitest, no AWS credentials needed. |
| `npm run lint` | ESLint and Prettier check. |
| `npm run sample:start` | An example MCP server on port 3939. `EXAMPLE=<name>` picks one (default `national-parks`), `-- --list` lists them, `PORT=` moves it. Adding an example is a directory under `examples/` with a `src/server.ts`; the runner discovers it. |
| `npm run chat` | In-process agent REPL against `mcp.url`. Fastest dev loop. `--debug` shows tool calls and timings; `--record` appends turns to `skill-package/training/<locale>.chat.jsonl` for the generator (D46). |
| `npm run chat -- --remote` | Same REPL through the deployed runtime. |
| `npm run generate` | Rebuild manifest and interaction model from the MCP server. Run after any config change that touches `mcp.*`, `skill.invocationName`, or `skill.locales`. |
| `npm run agent:dev` | Build and run the container locally on 8080. |
| `npm run synth` | `cdk synth`. Safe, no AWS calls. |
| `npm run deploy` | Pre-flight, `cdk deploy`, prints outputs and the cost note. Creates billable resources. |
| `npm run skill:deploy` | Lambda ARN from `.env` into `skill.json`, `ask deploy` from the root, Alexa Skill id back into `.env`. Creates or updates the Alexa Skill. |
| `npm run destroy` | `cdk destroy` plus ECR cleanup. Puts the placeholder ARN back into `skill.json` and drops `BRIDGE_LAMBDA_ARN` from `.env`. |
| `npm run check:leaks` | Staged files (or `-- --all`: tracked plus untracked, what `git add -A` would commit) scanned for account ids, Alexa Skill ids, endpoints, tokens. The pre-commit hook in `.githooks` runs it. |

## Do not run without being asked

`npm run deploy`, `cdk deploy`, `cdk destroy`, `npm run destroy`, `npm run skill:deploy`, `ask deploy`, `ask smapi *`, anything that creates, changes, or deletes AWS or Alexa resources, and anything that calls Bedrock in a loop. Local work (`chat`, `test`, `synth`, the sample server, a single model call to check latency) is always fine. When a spike needs a deploy, say what it will create and what it costs before running it.

## Config rules

- `bridge.config.ts` plus a git-ignored `.env` are the only developer input. Every consumer (generator, Lambda, agent, CDK) validates the merged result through `packages/core` at load time. Never read config fields from anywhere else.
- `bridge.config.ts` is tracked and must stay committable as it ships. The developer-specific fields come from `.env` through `ENV_OVERRIDES` in `packages/core/src/config.ts` (D36). Adding one there means adding its line to `.env.example` and its row to `docs/config.md`.
- Secrets never live in config or in the repo. Config holds a Secrets Manager secret name; the runtime fetches the value at startup. `MCP_SECRET_VALUE` in `.env` is the local-only escape.
- Every field has a safe default except `mcp.url`, which defaults to the bundled example on port 3939. Adding a field means adding its default, its zod rule, its comment in `bridge.config.ts`, and its entry in `docs/config.md`.
- Locale is a config value. Nothing hardcodes `en-US`, even though it is the only locale shipped.
- Nothing that identifies a developer (endpoint, account id, Alexa Skill id, email) may land in a tracked file. `npm run check:leaks` enforces it; the README's security section is the user-facing version.

## Generated files: never edit by hand

- `packages/skill-lambda/generated/tool-manifest.json`
- `skill-package/interactionModels/custom/*.json`

They carry a `_generated` marker (`by` and `notice` only: no source URL, no timestamp, so they stay deterministic and leak nothing, D37) and a `.gitattributes` entry. Regenerate with `npm run generate`. Everything a developer adds goes beside them and survives regeneration: `skill-package/overrides/<locale>.utterances.json` (extra samples, `catchAll` phrases, `slotSynonyms`, alias `intents`, D46) and `skill-package/training/<locale>.chat.jsonl` (written by `npm run chat -- --record`). `docs/customizing.md` is the developer-facing version. Handlers are never generated; generated artifacts are data only, and an alias intent routes through the manifest with no code.

## Hard constraints (do not "fix" these)

- Streamable HTTP. The client declares `capabilities.elicitation` at `initialize`. Elicitation arrives on the open `tools/call` stream and is parked in the container between Alexa turns. There is no configurable protocol floor: the MCP SDK decides what it can speak, and a server below the Alexa+ floor (`ALEXA_PLUS_PROTOCOL_VERSION`, 2025-11-25) is warned about, never refused (D34).
- The agent call gets 6500 ms inside Alexa's 8 s limit. Every design choice in the turn path respects that number, which comes from `turn.budgetMs`.
- Node 22, TypeScript everywhere, npm workspaces. The container image is linux/arm64; an x86 image fails silently on AgentCore.
- us-east-1, one CDK stack, stable `aws-cdk-lib/aws-bedrockagentcore` constructs, `lifecycleConfiguration` always set explicitly.
- No DynamoDB in v1. State lives in Alexa session attributes, AgentCore Memory, and the microVM.
- `packages/core` has no AWS dependencies. Frontends contain no MCP or model logic. The agent knows nothing about Alexa.
- Nothing runs always-on. Every default that costs money is documented where the cost occurs. There is no budget alarm (D35).
- `TurnOutput.visual` stays `null`. Keep `_meta.ui.resourceUri` in the tool-result type so widgets can be added later.
- Raw Alexa user and session IDs are hashed with `core.hashId()` before they reach AWS or any log.

## Naming (from the owner)

- It is always an **Alexa Skill**, never "skill" on its own, in prose, comments, log lines, spoken text, and docs. "the Alexa Skill Lambda", "your Alexa Skill id", "any Alexa Skill that knows the ARN".
- Identifiers keep their names: `skill.id`, `skill-package/`, `packages/skill-lambda`, `BRIDGE_SKILL_ID`, `--track skill`, `amzn1.ask.skill.…`, `SkillBuilders`, "Alexa Skills Kit". A spoken phrase a user says ("Alexa, open bridge demo skill") is quoted speech, not prose.
- The device is an "Alexa+ device", never an "Echo".
- The Alexa Skill stands in for an Alexa+ add-on and the agent **emulates** the Alexa+ orchestrator. Do not write that it "is" an add-on.

## Code style (from the owner)

- Clean and understandable. Short comments where they help; no narration of the obvious.
- The sophisticated work (MCP session, elicitation parking, memory, prompt assembly, answer mapping) sits in `packages/agent`. Alexa Skill handlers stay thin: build `TurnInput`, call `bridge.turn()`, render `TurnOutput`.
- No black boxes. `packages/agent/src/turn.ts` reads top to bottom as the story of one turn and delegates to well-named modules. Someone reading `skill-lambda` understands the flow without opening `agent`; someone reading `turn.ts` understands elicitation without reading the MCP client wrapper.
- One file per concern, small modules, explicit types at boundaries, zod at every input edge (config, invocation payloads, MCP results, manifest, slot values).
- Errors become short spoken messages at the edge and structured logs inside. Never speak raw error text or JSON.
- Prefer deterministic code over a model call whenever the mapping is knowable (answer mapping, slot mapping). The model is for judgment, not parsing.
- Prompts are markdown files in `packages/agent/prompts` with `{{placeholders}}`. No prompt strings in TypeScript.
- Docs are plain, concise, and decision-oriented.

## Testing

- Unit tests next to the code as `*.test.ts` with vitest. Required coverage: generator slot mapping and manifest, the answer-to-schema mapper, the turn state machine (question, pending, poll, cancel, stale answer).
- Integration: the in-process harness against the hotels-and-weather example with a scripted model, including one elicitation round trip. Must pass without AWS credentials. A credential-gated `test:live` variant uses the real model.
- CI is `npm run check:leaks -- --all`, `npm test`, and `cdk synth`. Keep it that way.

## Verify before you rely on it

These SDK surfaces were named from memory when the project was specified, then checked against the installed versions on 2026-09-03. Re-check after any upgrade and append a row to the verification log in [docs/decisions.md](docs/decisions.md):

- Strands TS: `McpClient` (not used for calls, see D21), `ElicitationCallback`, `BedrockModel` (`additionalRequestFields`), the memory store or conversation manager interface, the reasoning-effort parameter for Nova 2 Lite (`reasoningConfig.maxReasoningEffort`).
- MCP SDK: `StreamableHTTPClientTransport`, `ElicitRequestSchema`, how to read the negotiated protocol version after `initialize`, the 60 s default request timeout on the server side.
- CDK: `Runtime.lifecycleConfiguration` property names, `DockerImageAsset` as the runtime image, `GatewayTarget` NoAuth.
- AgentCore: `runtimeSessionId` constraints, `/ping` `HealthyBusy` semantics, whether the microVM keeps running between invocations.

Ten day-one assumptions were listed before the build; the table in [docs/architecture.md](docs/architecture.md) says which hold. Items 1, 8 (baseline) and 9 (synth) are confirmed; 2 to 7 and 10 wait for a deploy. Do not build on an open one before its spike under `spikes/` has run.

Two things learned the hard way that the code now enforces:

- A tool result sent to Nova must carry one content block, `json` or `text`, never both (D28).
- `tools/call` must use an explicit timeout above the SDK's 60 s default, or a spoken answer arrives too late (D21, D26).

## Docs and code say the same thing

Documentation here is one surface, not a pile of pages: `README.md`, `docs/*.md`, this file (and `CLAUDE.md`, the symlink to it), `CONTRIBUTING.md`, the per-directory READMEs (`examples/hotels-weather-mcp-server`, `skill-package`, `spikes`), the comments in `bridge.config.ts` and `.env.example`, and the strings the CLI and the scripts print. A fact that appears in two of them must read the same in both.

When you change a documented fact, do all three:

1. **Sweep the other pages.** Grep the repo for the old value before you call the change done: a default, a port, a command, a field or env var name, a file path, a count ("D1 to D37"), a sentence the code speaks. Two pages that disagree are worse than one page that says nothing.
2. **Check it against the code.** Every documented default, flag, env var, npm script, printed message and path must exist as written. Read the code; do not trust the sentence that was there before you.
3. **Reconcile out loud.** If the code disagrees with the docs, the code wins and the doc is the bug — unless the code is what is wrong, in which case say so in your reply instead of quietly changing behavior to match a sentence. When it cannot be settled in the same change (it needs a deploy, a device, or the owner's call), flag it in your reply and leave a row in `docs/decisions.md` rather than an unmarked stale line.

It runs the other way too: changing a default, a script name, a config field or a spoken message in code makes those pages part of that change, not a follow-up.

What travels together, from experience:

- A config field: its comment in `bridge.config.ts`, its zod rule in `packages/core/src/config.ts`, its row in `docs/config.md`, and its line in `.env.example` when it is overridable.
- An npm script: `package.json`, the command table in `README.md`, and the command table in this file.
- A spoken or printed message: the code that emits it and every page that quotes it.
- A decision: `docs/decisions.md`, the page that states the resulting behavior, and this file when it becomes a rule for agents.

`docs/onboarding.md` is the one place that sequences the README's steps for an agent to follow. It links to README sections and never restates them: when a step changes, it changes in the README, and onboarding only changes if the *order* or the gates changed.

`docs/history/` is exempt. Those documents are frozen and allowed to be wrong; never update them to match the code.

## Working habits here

- Before changing the turn flow, read `packages/agent/src/turn.ts` and the state machine table in [docs/architecture.md](docs/architecture.md).
- Prettier runs on save in CI's `npm run lint`; when editing files programmatically, run `npm run format` first so exact-match edits land on formatted text.
- A new dependency needs a one-line reason in the commit message. Keep the count low; contributors should not need to learn a framework.
- Do not widen scope from the README's "Out of scope for v1" list (widgets, web frontend, account linking, other locales, 2026-07-28 elicitation, progressive responses). Leave hooks, do not build them.
- When you decide something the docs did not decide, append a row to [docs/decisions.md](docs/decisions.md) with its rationale and a "revisit if" condition. When you measure something against live AWS or a new SDK version, append a row to the verification log in the same file.
- Commit messages describe why, not what. Never commit `bridge.config.ts` changes that contain a real customer URL or an Alexa Skill ID belonging to someone else.
