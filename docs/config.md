# Configuration

Everything the bridge needs from you lives in `bridge.config.ts` at the repo root. Every consumer (generator, skill Lambda, agent container, CDK app) validates it with the same zod schema at load time and fails early with the field path and the fix. Only `mcp.url` is required.

After changing anything under `mcp.*`, `skill.invocationName`, or `skill.locales`, run `npm run generate`. After changing anything else that reaches AWS, run `npm run deploy`.

## Secrets

Config holds secret **names**, never values. Create the secret once, then reference it:

```bash
aws secretsmanager create-secret --region us-east-1 --name alexa-mcp-bridge/mcp-token --secret-string 'the-token'
```

```ts
mcp: { url: 'https://example.com/mcp', auth: { type: 'bearer', secretName: 'alexa-mcp-bridge/mcp-token' } }
```

The CDK stack grants the runtime read access to that secret; the agent fetches the value at startup. Locally, `MCP_SECRET_VALUE=the-token npm run chat` skips Secrets Manager.

## Fields

### mcp

| Field             | Default      | Effect                                                                                                                                      |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | required     | The MCP server's Streamable HTTP endpoint. Must be reachable from AWS for device tests.                                                     |
| `auth.type`       | `none`       | `none`, `bearer` (Authorization header), `apiKey` (custom header), or `oauthClientCredentials` (the MCP SDK's client-credentials provider). |
| `auth.secretName` | unset        | Secrets Manager secret holding the token, the key, or `{"clientId": "...", "clientSecret": "..."}`. Required for every type but `none`.     |
| `auth.headerName` | `x-api-key`  | Header for `apiKey`.                                                                                                                        |
| `auth.scopes`     | unset        | OAuth scopes for `oauthClientCredentials`.                                                                                                  |
| `protocolVersion` | `2025-11-25` | Minimum MCP protocol version. The generator and the agent refuse servers that negotiate anything older. Cannot be set below 2025-11-25.     |

### skill

| Field                 | Default                                                      | Effect                                                                                                                   |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `invocationName`      | `my bridge`                                                  | What the user says after "Alexa, open". Lowercase words.                                                                 |
| `id`                  | unset                                                        | Your skill id after `ask deploy`. When set, the Lambda permission and the ASK SDK skill-id check only accept that skill. |
| `locales`             | `['en-US']`                                                  | Locales to generate models for. Only en-US has been tested; nothing hardcodes it.                                        |
| `greeting`            | derived                                                      | Spoken on launch. Default: the server name plus two example phrases from the manifest.                                   |
| `coldStartMessage`    | "I'm still starting up. Give me a moment and open me again." | Spoken when a launch hits a cold runtime; the session ends, the runtime keeps warming up.                                |
| `stillWorkingMessage` | "I'm still working on that. Ask me again in a moment."       | Spoken when a turn runs past the budget; the session stays open and the next request fetches the result.                 |

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

### turn, elicitation, memory

| Field                              | Default | Effect                                                                                                        |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `turn.budgetMs`                    | `6500`  | The agent call's share of Alexa's 8 s. The agent answers `pending` 500 ms before it; the Lambda aborts at it. |
| `elicitation.answerTimeoutSeconds` | `120`   | A question waiting for a spoken answer is cancelled after this long.                                          |
| `memory.shortTerm`                 | `true`  | Store every exchange in AgentCore Memory and rehydrate on cold start.                                         |
| `memory.longTerm`                  | `true`  | User-preference and summary extraction. Costs one model call per session (see [cost.md](cost.md)).            |
| `memory.hydrateLastEvents`         | `20`    | Exchanges rehydrated into the agent's history on cold start.                                                  |

### features

| Field     | Default | Effect                                                                                                                                                |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway` | `false` | Route MCP traffic through an AgentCore Gateway. Adds a hop and per-call billing; the client signs with SigV4. See [architecture.md](architecture.md). |
| `debug`   | `false` | Tool calls and timings in every response and in the logs, including tool arguments.                                                                   |

### aws

| Field              | Default     | Effect                                                                                     |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------ |
| `region`           | `us-east-1` | Only us-east-1 has been verified.                                                          |
| `budgetUsd`        | `5`         | AWS Budgets monthly cost budget. `npm run deploy` refuses to run without a positive value. |
| `budgetEmail`      | unset       | Where the budget alarm emails at 80 percent. Unset: the deploy prints a warning.           |
| `logRetentionDays` | `7`         | Retention for every log group the stack creates.                                           |

## How config reaches each component

- Generator, CLI, CDK app, scripts: import `bridge.config.ts` directly (Node 22 strips the types; the file must use erasable syntax only).
- Skill Lambda and agent container: one `BRIDGE_CONFIG` environment variable, set by the CDK stack at synth time, re-validated at startup.
