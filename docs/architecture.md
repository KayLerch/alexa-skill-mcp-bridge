# Architecture

The bridge lets a developer test an MCP server on a physical Alexa+ device as if it were an Alexa+ add-on. It reproduces the mechanics of an Alexa+ MCP client (initialize, tools/call, structured results, elicitation) with its own model judgment (Nova 2 Lite with the prompts in `packages/agent/prompts`).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="img/bridge.dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="img/bridge.light.svg">
    <img src="https://raw.githubusercontent.com/KayLerch/alexa-skill-mcp-bridge/main/docs/img/bridge.auto.svg" alt="The bridge at a glance, left to right: an Alexa+ device, the Alexa Skill, a thin Alexa Skill Lambda and AgentCore Runtime inside AWS us-east-1, and your MCP server outside it. The runtime holds a Strands agent on Nova 2 Lite, an MCP client over Streamable HTTP, and AgentCore Memory. Numbered arrows 1 to 4 carry the request rightwards to your server, and arrows 5 to 8 carry the answer back leftwards to the device. A numbered legend below the diagram explains all eight steps.">
  </picture>
</p>

Where each part of that lives, and what it is called in the code:

- The Alexa Skill Lambda is `packages/skill-lambda`. It calls `InvokeAgentRuntime` with the runtime session id set to
  `hash(userId)` and an `AgentInvocation` payload, and renders the returned `TurnOutput`
  (`status`, `speech`, `question?`, `endSession`, `visual: null`) as SSML.
- The agent is `packages/agent`: `BridgeSession` holds the Strands Agent on Nova 2 Lite, `BridgeMcpClient` speaks
  Streamable HTTP to the MCP server, `QuestionQueue` holds parked elicitations and `ask_user` questions, and
  AgentCore Memory keeps exchanges and preferences.

## The contract

`packages/core` owns every type that crosses a boundary. A frontend sends a `TurnInput` (`warmup`, `turn`, `answer`, `poll`, `cancel`) wrapped in an `AgentInvocation` (hashed actor and session ids, locale, budget) and gets a `TurnOutput` back. The Alexa Skill is one frontend; the CLI harness is another; a web frontend would be a third without touching the agent.

Identity: raw Alexa ids are hashed with SHA-256 in the Lambda. The hashed user id is the AgentCore runtime session id (64 hex characters, no dots) and the Memory actor id; the hashed Alexa session id is the Memory session id. Logs everywhere carry hashed ids only.

## One turn, top to bottom

`packages/agent/src/turn.ts` is the story; read it first. The state table:

| Input    | In state                       | Behavior                                                                                                      |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `warmup` | `cold`                         | Return `done` at once; MCP `initialize`, `tools/list`, memory hydration run in the background                 |
| `turn`   | `warming`                      | Wait for warm-up, bounded by the budget; `pending` if it does not finish                                      |
| `turn`   | `ready`                        | Start a `TurnRun`; `waitForOutcome(deadline)` returns finished, question, or deadline                         |
| `turn`   | `awaiting-answer`              | The user changed topic: cancel the question, let the tool call unwind (2 s cap), discard, run the new turn    |
| `turn`   | `overrun`                      | `pending` without starting another run; the Lambda polls first                                                |
| `answer` | `awaiting-answer`, matching id | Map the answer; more properties left: ask the next one; else resolve the elicitation and wait on the same run |
| `answer` | stale or unknown id            | Treated as a `turn` with the answer as text; what the user said is never dropped                              |
| `poll`   | `overrun`                      | The result if ready, else `pending`                                                                           |
| `poll`   | other                          | `done` with empty speech                                                                                      |
| `cancel` | any                            | Cancel pending questions, abort the run, `done`                                                               |

`TurnRun.waitForOutcome(deadline)` is the one primitive: whichever comes first of the agent loop finishing, a question becoming current, or the deadline. It serves `turn`, `answer`, and `poll` alike.

The deadline is `budgetMs - 500 ms` so the agent answers `pending` cleanly before the Lambda's abort at `budgetMs`. A run that passes its deadline keeps working; `/ping` reports `HealthyBusy` only then.

## Voice rules

Two paths produce speech and both obey `config.speech`. The model's answers are governed by
`packages/agent/prompts/voice.md`, interpolated with the same numbers. The text the model never
writes — elicitation questions, choice lists, spoken errors — is rendered deterministically in
`packages/agent/src/elicitation/question.ts`, which caps how many options are read aloud, stays
quiet about sets a listener already knows (months, weekdays), and runs the server's own message
through the same markdown and URL cleanup as model output.

## Elicitation parking

MCP 2025-11-25 delivers elicitation as a server-to-client request on the still-open `tools/call` stream. The Alexa turn is over long before the user answers, so the promise waits in the microVM:

1. The agent calls a tool; the server sends `elicitation/create`. The MCP client's request handler hands the params to `QuestionQueue.elicit()`, which plans one spoken question per property (required first) and returns a promise. The tool call is now parked.
2. `waitForOutcome` sees the question and the turn returns `status: 'question'`. The Lambda speaks it and stores `{id, expects, source, message}` in session attributes; the session stays open with a reprompt.
3. The user answers. Alexa routes yes/no, dates, numbers, or a carrier-phrase free text to the answer intents, which only fire while a question is pending. The Lambda sends `{type: 'answer', questionId, answer}`.
4. The agent maps the answer deterministically (yes/no, `AMAZON.DATE`, `AMAZON.NUMBER`, enum with entity resolution, spoken number words). Free text against a typed property goes through one structured-output model call, then the same deterministic validation. An unusable answer re-asks.
5. When every property has a value the elicitation resolves with `accept`, the tool continues, and the agent phrases the result. "No" to a non-yes/no question declines; stop, session end, a new topic, or the answer timeout cancel.
6. `ask_user`, the agent's own tool for a missing argument, goes through the same queue, so the frontend sees one kind of question.

URL-mode elicitation is declined with a spoken explanation.

Hazards on the path (see [troubleshooting.md](troubleshooting.md)): the MCP SDK's 60 s default request timeout on both sides (the agent's `callTool` uses 10 minutes; the server's `elicitInput` must be raised too), and idle timeouts in tunnels and proxies (the example servers pings every 15 s).

## Memory

`memory.shortTerm`: every completed exchange becomes one AgentCore Memory event under `(actorId, sessionId)`. On warm-up the agent lists the actor's most recent sessions and rehydrates the last `hydrateLastEvents` exchanges into the Strands agent's history. `memory.longTerm`: the stack adds user-preference and summary strategies with namespaces `/users/{actorId}/preferences` and `/users/{actorId}/sessions/{sessionId}`; the agent retrieves preferences once at warm-up into a "Known about this user" block of the system prompt. Memory failures log and never break a turn.

## Gateway toggle

`features.gateway` adds an AgentCore Gateway with an MCP server target in front of `mcp.url`, IAM inbound auth, and response streaming enabled through a CloudFormation override (the CDK L2 has no switch yet). The agent then connects to the Gateway URL with a SigV4-signing fetch. Tool names arrive prefixed by the target name; the manifest's intent hints still name the plain tool, which the agent treats as a hint. Whether the Gateway relays elicitation on the stream, and whether it supports sessions on this CloudFormation schema (no sessions configuration exists in aws-cdk-lib 2.268), has not been verified against a deployment.

## Decisions

[decisions.md](decisions.md) lists every decision (D1 to D37) with its rationale and the condition that would reverse it. The ones that shape the code most:

- Raw MCP SDK `Client` instead of Strands' `McpClient` (D21): Strands drops `structuredContent` and pins tool calls to a 60 s timeout.
- One content block per tool result (D28): Nova collapses its context on a result that mixes `json` and `text` (545 input tokens instead of 1712, empty answer).
- Reasoning off by default (D20): 4.2 s per turn versus 5.7 s at `low`.
- `endSession` is true unless the answer ends with a question (D25).

## Verified against live behavior

Recorded on 2026-09-03 with `@strands-agents/sdk` 1.16.0, `@modelcontextprotocol/sdk` 1.30.0, `aws-cdk-lib` 2.268.0. The spikes under [`spikes/`](../spikes/) are re-runnable, and the dated detail behind this summary is the verification log in [decisions.md](decisions.md).

| Item                                                        | Outcome                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Strands elicitation callback settled later               | Works: the callback (and the raw request handler) receives the request and accepts a promise settled 20 s or 65 s later; the tool result arrives. Protocol 2025-11-25 negotiated, `capabilities.elicitation.form` visible to the server. Strands' own `callTool` fails at 60 s (SDK default timeout), hence D21.                              |
| 2. Parked promise survives between invocations on AgentCore | **Not yet run.** `spikes/probe-runtime` (container, stack, driver) is ready; it deploys a runtime.                                                                                                                                                                                                                                            |
| 3. Session id reuse after reclaim                           | Not yet run (same spike, sequence 6).                                                                                                                                                                                                                                                                                                         |
| 4. Abandoned first invocation                               | Not yet run (sequence 5).                                                                                                                                                                                                                                                                                                                     |
| 5. Cold-start time                                          | Not yet run (sequence 1). The image is a two-stage arm64 build with production deps only.                                                                                                                                                                                                                                                     |
| 6. 64-char hex session id                                   | Not yet run (sequence 7); the SDK documents 33+ characters and no dots.                                                                                                                                                                                                                                                                       |
| 7. Streamable HTTP idle through a tunnel                    | Not yet run; `spikes/tunnel-idle` needs `cloudflared`.                                                                                                                                                                                                                                                                                        |
| 8. Nova 2 Lite tool-use latency                             | Baseline, one run each: 5.7 s at `low`, 4.2 s at `off` (2 model calls). Through the harness with the real model: hotel round trip 2.5 s, weather turn 1.4 s. The 20-run p50/p95 has not been run.                                                                                                                                             |
| 9. CDK constructs                                           | Synth confirmed: `Runtime.lifecycleConfiguration` renders idle and max lifetime; `AgentRuntimeArtifact.fromAsset` with `Platform.LINUX_ARM64`; Memory strategies; Gateway `NoAuthAuthorizer` and `IamAuthorizer`; `addMcpServerTarget` (needs a credential provider; `fromIamRole()` works); no Gateway sessions configuration in the schema. |
| 10. ASK trigger permission and deploy order                 | Not yet run; `spikes/ask-deploy-order` is ready. The two-deploy order stands and `npm run deploy` prints the next step.                                                                                                                                                                                                                       |
| Nova reasoning parameter                                    | `additionalModelRequestFields.reasoningConfig = {type: 'enabled', maxReasoningEffort}` accepted.                                                                                                                                                                                                                                              |
| Tool result shape                                           | `json` only or `text` only: fine. Both: empty answer (D28).                                                                                                                                                                                                                                                                                   |
