# Configuration

Everything the bridge needs from you lives in two files: `bridge.config.ts` at the repo root, which holds the settings of the bridge itself and is meant to stay exactly as it ships, and a git-ignored `.env`, which holds the few values that are yours. Every consumer (generator, Alexa Skill Lambda, agent container, CDK app) validates the merged result with the same zod schema at load time and fails early with the field path and the fix. Only `mcp.url` is required, and it has a working default.

After changing anything under `mcp.*`, `skill.invocationName`, or `skill.locales`, run `npm run generate`. After changing anything else that reaches AWS, run `npm run deploy`.

## .env: what is yours

This repo is public and every clone edits the same tracked config file, which is how endpoints, Alexa Skill ids and account numbers end up in commits. So the fields that identify you override `bridge.config.ts` from `.env` instead:

```bash
cp .env.example .env      # .env is git-ignored; .env.example is not
```

| Variable                 | Sets                  | Why it is here                                                      |
| ------------------------ | --------------------- | ------------------------------------------------------------------- |
| `BRIDGE_MCP_URL`         | `mcp.url`             | Your endpoint, and for device tests a tunnel URL that changes often |
| `BRIDGE_MCP_AUTH_TYPE`   | `mcp.auth.type`       | `none`, `bearer`, `apiKey`, `oauthClientCredentials`                |
| `BRIDGE_MCP_SECRET_NAME` | `mcp.auth.secretName` | The Secrets Manager secret **name**                                 |
| `BRIDGE_SKILL_ID`        | `skill.id`            | Written by `npm run skill:deploy`; identifies your Alexa Skill      |
| `BRIDGE_AWS_REGION`      | `aws.region`          | Only us-east-1 has been verified                                    |

A real environment variable wins over the file, so one-off runs and CI still work: `BRIDGE_MCP_URL=https://staging.example.com/mcp npm run chat`. Everything else stays in `bridge.config.ts`, where it is typed and commented.

Two more keys live in `.env` without overriding a config field: `npm run deploy` writes the Lambda ARN as `BRIDGE_LAMBDA_ARN`, and `npm run skill:deploy` reads it, writes it into `skill-package/skill.json`, runs `ask deploy`, and stores the resulting Alexa Skill id as `BRIDGE_SKILL_ID`. Both identify your account, which is why they never go into a tracked file.

`.env` reaches the generator, the CLI, the CDK app and the scripts, because they all load `bridge.config.ts` through `loadConfigFile()`. The Lambda and the agent container never read it: they get the merged config as `BRIDGE_CONFIG`, resolved at synth time.

## Secrets

Neither file holds a secret value. Config holds secret **names**; create the secret once, then reference it:

```bash
aws secretsmanager create-secret --region us-east-1 --name alexa-mcp-bridge/mcp-token --secret-string 'the-token'
```

```bash
# .env
BRIDGE_MCP_URL=https://example.com/mcp
BRIDGE_MCP_AUTH_TYPE=bearer
BRIDGE_MCP_SECRET_NAME=alexa-mcp-bridge/mcp-token
```

The CDK stack grants the runtime read access to that secret; the agent fetches the value at startup. For local runs, `MCP_SECRET_VALUE` in `.env` (or in front of the command) skips Secrets Manager: `MCP_SECRET_VALUE=the-token npm run chat`. Never put a token in `mcp.url` itself; `npm run check:leaks` looks for that.

## Fields

### mcp

| Field             | Default     | Effect                                                                                                                                      |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | required    | The MCP server's Streamable HTTP endpoint. Must be reachable from AWS for device tests.                                                     |
| `auth.type`       | `none`      | `none`, `bearer` (Authorization header), `apiKey` (custom header), or `oauthClientCredentials` (the MCP SDK's client-credentials provider). |
| `auth.secretName` | unset       | Secrets Manager secret holding the token, the key, or `{"clientId": "...", "clientSecret": "..."}`. Required for every type but `none`.     |
| `auth.headerName` | `x-api-key` | Header for `apiKey`.                                                                                                                        |
| `auth.scopes`     | unset       | OAuth scopes for `oauthClientCredentials`.                                                                                                  |

There is no protocol-version field. The bridge speaks whatever the MCP SDK negotiates at
`initialize`. A server below **2025-11-25** still works here, but `npm run generate`, `npm run doctor`,
and the agent log a warning that it would not be supported as an Alexa+ add-on.

### skill

| Field                 | Default                                                      | Effect                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invocationName`      | `bridge demo`                                                | What the user says after "Alexa, open". Lowercase words. Also the Alexa Skill's name in `skill-package/skill.json`.                                                                                                                    |
| `id`                  | unset                                                        | Your Alexa Skill id, written into `.env` by `npm run skill:deploy`. When set, the Lambda permission and the ASK SDK skill-id check only accept that Alexa Skill; until then any Alexa Skill that knows the function ARN can invoke it. |
| `locales`             | `['en-US']`                                                  | Locales to generate models for. Only en-US has been tested; nothing hardcodes it.                                                                                                                                                      |
| `greeting`            | derived                                                      | Spoken on launch. Default: the server name plus two example phrases from the manifest.                                                                                                                                                 |
| `coldStartMessage`    | "I'm still starting up. Give me a moment and open me again." | Spoken when a launch hits a cold runtime; the session ends, the runtime keeps warming up.                                                                                                                                              |
| `stillWorkingMessage` | "I'm still working on that. Ask me again in a moment."       | Spoken when a turn runs past the budget; the session stays open and the next request fetches the result.                                                                                                                               |

### agent

| Field             | Default                      | Effect                                                                                                                                                                                          |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelId`         | `us.amazon.nova-2-lite-v1:0` | Bedrock model or inference profile. Enable model access first (`npm run check-model-access`).                                                                                                   |
| `reasoningEffort` | `off`                        | Nova 2 reasoning: `off` sends no reasoning config and is what the turn budget assumes (about 1.5 s faster per turn than `low`); `low`, `medium`, `high` enable it. Ignored for non-Nova models. |
| `fallbackModelId` | unset                        | A documented alternative such as `us.anthropic.claude-haiku-4-5-20251001-v1:0`. The stack grants access to it; switch by setting it as `modelId`.                                               |
| `maxTokens`       | `400`                        | Cap on output tokens per model call. Spoken answers are short.                                                                                                                                  |

### runtime

| Field                | Default | Effect                                                                                                                      |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `idleTimeoutMinutes` | `20`    | AgentCore reclaims the microVM (and any parked question) after this idle period. Memory is billed while the session exists. |
| `maxLifetimeHours`   | `8`     | Hard cap on a session's life.                                                                                               |

### speech

Voice rules that the agent's prompt and the question renderer both obey, so the two cannot drift.

| Field                     | Default | Effect                                                                                                                                                                                                  |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech.maxSentences`     | `3`     | How long a spoken answer may run. Interpolated into `prompts/voice.md`.                                                                                                                                 |
| `speech.maxChoicesSpoken` | `3`     | How many options a question reads aloud. Past this it names a few as examples; the answer still accepts anything the tool's schema allows. Sets a listener knows (months, weekdays) are never read out. |

The split matters: what the model writes is governed by `prompts/voice.md`, and what the bridge
renders itself — questions, choice lists, errors — is governed by code in
`packages/agent/src/elicitation/question.ts`. Both read these numbers.

A server's own text is spoken nearly as written, so an elicitation `message` should be a sentence
someone can hear. Markdown, links and emoji in it are stripped on the way through, but a paragraph
is still a paragraph.

### turn, elicitation, memory

| Field                              | Default | Effect                                                                                                        |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `turn.budgetMs`                    | `6500`  | The agent call's share of Alexa's 8 s. The agent answers `pending` 500 ms before it; the Lambda aborts at it. |
| `elicitation.answerTimeoutSeconds` | `120`   | A question waiting for a spoken answer is cancelled after this long.                                          |
| `memory.shortTerm`                 | `true`  | Store every exchange in AgentCore Memory and rehydrate on cold start.                                         |
| `memory.longTerm`                  | `true`  | User-preference and summary extraction. Costs one model call per session (see [cost.md](cost.md)).            |
| `memory.hydrateLastEvents`         | `20`    | Exchanges rehydrated into the agent's history on cold start.                                                  |

### features

| Field         | Default | Effect                                                                                                                                                                                                                                                                                    |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway`     | `false` | Route MCP traffic through an AgentCore Gateway. Adds a hop and per-call billing; the client signs with SigV4. See [architecture.md](architecture.md).                                                                                                                                     |
| `debug`       | `false` | Tool calls and timings in every response and in the logs, including tool arguments.                                                                                                                                                                                                       |
| `toolIntents` | `true`  | One Alexa intent per MCP tool, with typed slots and entity resolution. Off: a single catch-all intent hands the whole spoken phrase to the agent, and the interaction model stops depending on your tool schemas, so a tool change needs `npm run deploy` but no `ask deploy`. See below. |
| `catchAll`    | `true`  | A bare-phrase intent beside the tool intents, so a request they do not recognise still reaches the agent as text instead of dying in Alexa's fallback, which carries none. Details in [customizing.md](customizing.md).                                                                   |

### skill (continued)

`toolIntents` defaults to on and should stay on: Alexa resolves your slots, so "the fifth of
October" arrives as a date and an enum value arrives as its id. Turning it off replaces the
per-tool intents with a single catch-all intent that hands the whole spoken phrase to the agent,
which decouples the interaction model from your tool schemas at the cost of that resolution. It is
there for experiments; [decisions.md](decisions.md) D38 has the measurements.

### aws

| Field              | Default     | Effect                                           |
| ------------------ | ----------- | ------------------------------------------------ |
| `region`           | `us-east-1` | Only us-east-1 has been verified.                |
| `logRetentionDays` | `7`         | Retention for every log group the stack creates. |

The stack creates no cost alarm: nothing in it runs always-on, and an alarm that notifies would need your email address in a tracked file. `npm run deploy` prints what accrues; [cost.md](cost.md) has the numbers and `npm run destroy` ends them.

## How config reaches each component

- Generator, CLI, CDK app, scripts: import `bridge.config.ts` directly (Node 22 strips the types; the file must use erasable syntax only), with `.env` applied on top before validation.
- Alexa Skill Lambda and agent container: one `BRIDGE_CONFIG` environment variable holding the merged config, set by the CDK stack at synth time, re-validated at startup.
