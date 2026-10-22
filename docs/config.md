# Configuration

Everything the bridge needs from you lives in two files: `bridge.config.ts` at the repo root, which holds the settings of the bridge itself and is meant to stay exactly as it ships, and a git-ignored `.env`, which holds the few values that are yours. Every consumer (generator, Alexa Skill Lambda, agent container, CDK app) validates the merged result with the same zod schema at load time and fails early with the field path and the fix. Only `mcp.url` is required, and it has a working default.

After changing anything under `mcp.*`, `skill.invocationName`, `skill.locales`, `answers.choices`, `answers.intents` or `features.toolIntents`, run `npm run generate`. After changing anything else that reaches AWS, run `npm run deploy`.

## .env: what is yours

This repo is public and every clone edits the same tracked config file, which is how endpoints, Alexa Skill ids and account numbers end up in commits. So the fields that identify you override `bridge.config.ts` from `.env` instead:

```bash
cp .env.example .env      # .env is git-ignored; .env.example is not
```

| Variable                 | Sets                  | Why it is here                                                                                                    |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `BRIDGE_MCP_URL`         | `mcp.url`             | Your endpoint, and for device tests a tunnel URL that changes often                                               |
| `BRIDGE_MCP_AUTH_TYPE`   | `mcp.auth.type`       | `none`, `bearer`, `apiKey`, `oauthClientCredentials`, `alexaAccountLinking`                                       |
| `BRIDGE_MCP_SECRET_NAME` | `mcp.auth.secretName` | The Secrets Manager secret **name**                                                                               |
| `BRIDGE_SKILL_ID`        | `skill.id`            | Written by `npm run skill:deploy`; identifies your Alexa Skill                                                    |
| `BRIDGE_AWS_REGION`      | `aws.region`          | Only us-east-1 has been verified                                                                                  |
| `BRIDGE_PROFILE_DIR`     | (none; see below)     | A folder outside the repo with your own `.env`, `bridge.config.json` overlay, overrides and prompt addendum (D56) |

A real environment variable wins over the file, so one-off runs and CI still work: `BRIDGE_MCP_URL=https://staging.example.com/mcp npm run chat`. Everything else stays in `bridge.config.ts`, where it is typed and commented.

Two more keys live in `.env` without overriding a config field: `npm run deploy` writes the Lambda ARN as `BRIDGE_LAMBDA_ARN`, and `npm run skill:deploy` reads it, writes it into `skill-package/skill.json`, runs `ask deploy`, and stores the resulting Alexa Skill id as `BRIDGE_SKILL_ID`. Both identify your account, which is why they never go into a tracked file.

`.env` reaches the generator, the CLI, the CDK app and the scripts, because they all load `bridge.config.ts` through `loadConfigFile()`. The Lambda and the agent container never read it: they get the merged config as `BRIDGE_CONFIG`, resolved at synth time.

### A profile folder

`BRIDGE_PROFILE_DIR` points to a folder you keep in your own repository, so you never fork the bridge. Set it in the shell or in the repo's `.env` (a relative path resolves against the repo root; a folder that does not exist is a config error, files missing inside it are fine):

| In the folder                                       | Read after                 | Effect                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env`                                              | the repo's `.env`          | Same variables as above; it wins over the repo's `.env`, a real environment variable wins over both. It cannot set `BRIDGE_PROFILE_DIR` itself.                                                                                                                                                                                                        |
| `overrides/<locale>.utterances.json`                | `skill-package/overrides/` | Same format ([customizing](customizing.md)); its samples come first, an alias intent of the same name replaces the repo's.                                                                                                                                                                                                                             |
| `bridge.config.json`                                | `bridge.config.ts`         | A partial config, deep-merged over `bridge.config.ts` (objects merge, arrays replace) and validated by the same schema; an error names the field path and the file. Environment overrides still win over it, so a one-off `BRIDGE_MCP_URL=… npm run chat` works. Secrets stay by name only.                                                            |
| `prompt-addendum.md`                                | (nothing)                  | Becomes `agent.promptAddendum`, appended to the system prompt under "Server-specific guidance".                                                                                                                                                                                                                                                        |
| `skill-package/skill.json`, `skill-package/assets/` | `skill-package/`           | Your Alexa Skill listing, at `npm run skill:deploy` only (D62): `skill.json` is deep-merged over the repo's (objects merge, arrays replace; the endpoint stays the deployed Lambda), and `assets/` is copied in, so an icon given as `file://assets/images/en-US_largeIconUri.png` ships with `ask deploy`. Both are taken off again after the deploy. |

The deployed agent never sees your folder. `loadConfigFile()` reads the addendum on your machine and puts it into the config, which `npm run deploy` hands the container as `BRIDGE_PROMPT_ADDENDUM`, next to `BRIDGE_CONFIG` (AgentCore caps each runtime variable at 2048 characters, and `npm run deploy` stops with the variable's name and size when one is longer); so the addendum reaches AWS when you deploy, and a changed addendum needs a redeploy. Only variables in `ENV_OVERRIDES` (the table above) take effect from a profile `.env`; every other field goes in the profile's `bridge.config.json`, for example:

```json
{
  "mcp": { "auth": { "type": "alexaAccountLinking" } },
  "skill": { "invocationName": "remembee quiz" },
  "memory": { "shortTerm": false, "longTerm": false },
  "features": { "debug": false },
  "speech": { "resultField": "say" },
  "tools": { "hiddenArguments": ["session_id"] },
  "visual": { "enabled": true }
}
```

A key the config does not have (a typo such as `memory.shortterm`) is a config error naming the file, never a silently kept default. The deployed Alexa Skill Lambda gets the config without `agent.promptAddendum` (Lambda's environment is capped at 4 KB); only the agent runtime carries it.

Precedence, lowest first: `bridge.config.ts`, the profile's `bridge.config.json`, then environment overrides (repo `.env`, profile `.env`, real variables). The environment goes last on purpose: it is the documented way to change one value for one run. The merged result reaches the generator, the CLI, the CDK app (`visual.enabled` sets the Chromium build arg) and, through `BRIDGE_CONFIG`, the Lambda and the agent.

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

The CDK stack grants the runtime read access to that secret; the agent fetches the value at startup. For local runs, `MCP_SECRET_VALUE` in `.env` (or in front of the command) skips Secrets Manager: `MCP_SECRET_VALUE=the-token npm run chat`. With `alexaAccountLinking` there is no secret: `MCP_SECRET_VALUE` then stands in for the linked token in `npm run chat` and `npm run generate` (a token of your own account), and without it both go out unauthenticated. Never put a token in `mcp.url` itself; `npm run check:leaks` looks for that.

## Fields

### mcp

| Field             | Default     | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`             | required    | The MCP server's Streamable HTTP endpoint. Must be reachable from AWS for device tests.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `auth.type`       | `none`      | `none`, `bearer` (Authorization header), `apiKey` (custom header), `oauthClientCredentials` (the MCP SDK's client-credentials provider), or `alexaAccountLinking` (each user's own token from Alexa account linking, sent as a bearer token on every request; a user who has not linked hears how to and gets the link card; not with `features.gateway`; memory is keyed by the Alexa user, so turn it off when the server's data belongs to the linked account; see the README's "Per-user sign-in", D48). |
| `auth.secretName` | unset       | Secrets Manager secret holding the token, the key, or `{"clientId": "...", "clientSecret": "..."}`. Required for every type but `none` and `alexaAccountLinking`.                                                                                                                                                                                                                                                                                                                                            |
| `auth.headerName` | `x-api-key` | Header for `apiKey`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `auth.scopes`     | unset       | OAuth scopes for `oauthClientCredentials`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

There is no protocol-version field. The bridge speaks whatever the MCP SDK negotiates at
`initialize`. A server below **2025-11-25** still works here, but `npm run generate`, `npm run doctor`,
and the agent log a warning that it would not be supported as an Alexa+ add-on.

### skill

| Field                  | Default                                                      | Effect                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invocationName`       | `bridge demo`                                                | What the user says after "Alexa, open". Lowercase words. It goes into the interaction model only; the Alexa Skill's listed name is `publishingInformation` in `skill-package/skill.json`, which a profile overrides with its own `skill-package/skill.json` (D62).                                                                                                                |
| `id`                   | unset                                                        | Your Alexa Skill id, written into `.env` by `npm run skill:deploy`. When set, the Lambda permission and the ASK SDK skill-id check only accept that Alexa Skill; until then any Alexa Skill that knows the function ARN can invoke it.                                                                                                                                            |
| `locales`              | `['en-US']`                                                  | Locales to generate models for. Only en-US has been tested; nothing hardcodes it.                                                                                                                                                                                                                                                                                                 |
| `greeting`             | derived                                                      | Spoken on launch. Default: the server name plus two example phrases (`examplePhrases`, else the manifest's). With `launch` set, spoken only when the launch tool has nothing to say.                                                                                                                                                                                              |
| `coldStartMessage`     | "I'm still starting up. Give me a moment and open me again." | Spoken when a launch hits a cold runtime; the session ends, the runtime keeps warming up.                                                                                                                                                                                                                                                                                         |
| `stillWorkingMessage`  | `Still working on it. Say "continue" in a moment.`           | Spoken when a turn runs past the budget; the session stays open. Whatever the user says next ("continue", the same answer again, anything but stop, cancel or help) fetches that result and hears it alone; still not ready: this line again (D72).                                                                                                                               |
| `stillWorkingReprompt` | `Say "continue" to hear it.`                                 | The reprompt after `stillWorkingMessage` (D72).                                                                                                                                                                                                                                                                                                                                   |
| `launch`               | unset                                                        | `{ tool, arguments? }`: a tool the agent calls on launch without the model (D57). Its `speech.resultField` is spoken, its widget shown on a screen, and the session stays open unless its `speech.endSessionField` is `true`. A failed call, an error result, a result without the field, or a runtime not ready in time: the greeting instead. `npm run chat` opens with it too. |
| `help`                 | derived                                                      | Spoken for "help" (D61). Default: the server's tools and the example phrases. While a question is pending, "Right now I am waiting for an answer: …" follows.                                                                                                                                                                                                                     |
| `examplePhrases`       | derived                                                      | Example phrases for the greeting and the generated help (D61). Default: two from the manifest, which `npm run generate` fills from the first sample utterance whose slots all have a value a listener would say, never a placeholder.                                                                                                                                             |
| `fallbackWhileOpen`    | "Sorry, I didn't catch that."                                | Said, followed by the last question again, when Alexa sends `AMAZON.FallbackIntent` while the session is open for an answer (D60). Never the generic "What would you like to do?". A server hint from `speech.fallbackField` replaces both (D70).                                                                                                                                 |
| `fallbackSensitivity`  | unset                                                        | `LOW`, `MEDIUM` or `HIGH`: the interaction model's `fallbackIntentSensitivity` (D60). Unset: Alexa's default. Higher sends more unclear speech to the re-ask above instead of the nearest intent. Needs `npm run generate` and `npm run skill:deploy`.                                                                                                                            |

### agent

| Field             | Default                      | Effect                                                                                                                                                                                          |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelId`         | `us.amazon.nova-2-lite-v1:0` | Bedrock model or inference profile. Enable model access first (`npm run check-model-access`).                                                                                                   |
| `reasoningEffort` | `off`                        | Nova 2 reasoning: `off` sends no reasoning config and is what the turn budget assumes (about 1.5 s faster per turn than `low`); `low`, `medium`, `high` enable it. Ignored for non-Nova models. |
| `fallbackModelId` | unset                        | A documented alternative such as `us.anthropic.claude-haiku-4-5-20251001-v1:0`. The stack grants access to it; switch by setting it as `modelId`.                                               |
| `maxTokens`       | `400`                        | Cap on output tokens per model call. Spoken answers are short.                                                                                                                                  |
| `promptAddendum`  | unset                        | Extra guidance for your MCP server, appended to the system prompt (at most 2000 UTF-8 bytes). Normally filled from the profile's `prompt-addendum.md` (D56).                                    |

### runtime

| Field                | Default | Effect                                                                                                                      |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `idleTimeoutMinutes` | `20`    | AgentCore reclaims the microVM (and any parked question) after this idle period. Memory is billed while the session exists. |
| `maxLifetimeHours`   | `8`     | Hard cap on a session's life.                                                                                               |

### speech

Voice rules that the agent's prompt and the question renderer both obey, so the two cannot drift.

| Field                     | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speech.maxSentences`     | `3`     | How long a spoken answer may run. Interpolated into `prompts/voice.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `speech.maxChoicesSpoken` | `3`     | How many options a question reads aloud. Past this it names a few as examples; the answer still accepts anything the tool's schema allows. Sets a listener knows (months, weekdays) are never read out.                                                                                                                                                                                                                                                                                                                                                           |
| `speech.resultField`      | unset   | A string field of a tool result's `structuredContent` (for example `say`) spoken word for word instead of the model's rephrasing, for servers that write their own spoken line. Only the run's last successful result counts; a missing, empty or non-string value falls back to the model's text. The reprompt is the last question in it: the last sentence that ends with "?", with the sentences right before it that end with "?" too (a question and its spoken options). (D51)                                                                             |
| `speech.endSessionField`  | unset   | A boolean field of a tool result's `structuredContent` (for example `end_session`) that ends the session when `true` (D58). Set: a finished turn ends the session only when the run's last successful result says so; otherwise the session stays open and the reprompt is the last question in the speech, else "What would you like to do?". The model's own words, an error included, never end it. Unset: the session ends when the spoken answer does not end with "?".                                                                                      |
| `speech.fallbackField`    | unset   | A string field of a tool result's `structuredContent` (for example `hint`) that the Alexa Skill speaks, exactly, when Alexa misses the user's reply while the session is open for one (`AMAZON.FallbackIntent`), with the last question as reprompt (D70): a server-written hint such as 'Say A, B or C, or "skip".'. Only the run's last successful result counts, and the hint stays with the output it came with until the next one; "repeat" still replays that output. Unset, or a result without it: `skill.fallbackWhileOpen` and the last question (D60). |

The split matters: what the model writes is governed by `prompts/voice.md`, and what the bridge
renders itself — questions, choice lists, errors — is governed by code in
`packages/agent/src/elicitation/question.ts`. Both read these numbers.

A server's own text is spoken nearly as written, so an elicitation `message` should be a sentence
someone can hear. Markdown, links and emoji in it are stripped on the way through, but a paragraph
is still a paragraph.

### intents

| Field              | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intents.builtIns` | `{}`    | Alexa built-in intents mapped to `{ tool, arguments? }`, a direct tool call without the model, or to `{ text }`, a turn the agent hears as if the user had said it (D59). Mappable: `AMAZON.NextIntent`, `PreviousIntent`, `StartOverIntent`, `MoreIntent`, and `StopIntent`, `CancelIntent`, `NavigateHomeIntent`, which take a tool only: it runs within `turn.budgetMs`, its `speech.resultField` is the farewell when the result ends the session on its own (`speech.endSessionField` true, or no closing question without it), and an error, an empty field, a timeout or a line that asks a question leaves the plain "Goodbye.". A mapped tool call is spoken like the launch tool; one with nothing to say gives "Sorry, that didn't work." and the last question. An unmapped `Next`, `Previous`, `StartOver` or `More` reaches the agent as the word itself. |

`AMAZON.RepeatIntent` needs no mapping: "repeat" replays what the user heard last, from the session attributes, without calling the agent; after "still working" it fetches the outstanding result instead (D72). The generated model always has `RepeatIntent` and `NextIntent`, and adds any other built-in you map.

### tools

| Field                   | Default | Effect                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools.hiddenArguments` | `[]`    | Argument names the agent fills itself (D50). They get no Alexa slot and appear in no sample utterance, so the one spoken slot goes to the next free-text argument. A missing one is taken from the latest tool result with that key in `structuredContent`; a value the model passes wins. |

### turn, elicitation, memory

| Field                              | Default | Effect                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn.budgetMs`                    | `6500`  | The agent call's share of Alexa's 8 s. The agent answers `pending` 500 ms before it; the Lambda aborts at it.                                                                                                                                            |
| `turn.progressiveAfterMs`          | `3000`  | After this long without an answer the Alexa Skill says "One moment." through Alexa's Progressive Response (D52), once per request. Above a normal turn (1.5 to 3 s), so only a slow one hears it (D71); must be below `turn.budgetMs`. `0` turns it off. |
| `elicitation.answerTimeoutSeconds` | `120`   | A question waiting for a spoken answer is cancelled after this long.                                                                                                                                                                                     |
| `memory.shortTerm`                 | `true`  | Store every exchange in AgentCore Memory and rehydrate on cold start.                                                                                                                                                                                    |
| `memory.longTerm`                  | `true`  | User-preference and summary extraction. Costs one model call per session (see [cost.md](cost.md)).                                                                                                                                                       |
| `memory.hydrateLastEvents`         | `20`    | Exchanges rehydrated into the agent's history on cold start.                                                                                                                                                                                             |

### features

| Field         | Default | Effect                                                                                                                                                                                                                                                                                    |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway`     | `false` | Route MCP traffic through an AgentCore Gateway. Adds a hop and per-call billing; the client signs with SigV4. Not with `mcp.auth.type` `alexaAccountLinking`: the Gateway cannot pass the user's token on. See [architecture.md](architecture.md).                                        |
| `debug`       | `false` | Tool calls and timings in every response and in the logs, including tool arguments.                                                                                                                                                                                                       |
| `toolIntents` | `true`  | One Alexa intent per MCP tool, with typed slots and entity resolution. Off: a single catch-all intent hands the whole spoken phrase to the agent, and the interaction model stops depending on your tool schemas, so a tool change needs `npm run deploy` but no `ask deploy`. See below. |
| `catchAll`    | `true`  | A bare-phrase intent beside the tool intents, so a request they do not recognise still reaches the agent as text instead of dying in Alexa's fallback, which carries none. Details in [customizing.md](customizing.md).                                                                   |

### skill (continued)

`toolIntents` defaults to on and should stay on: Alexa resolves your slots, so "the fifth of
October" arrives as a date and an enum value arrives as its id. Turning it off replaces the
per-tool intents with a single catch-all intent that hands the whole spoken phrase to the agent,
which decouples the interaction model from your tool schemas at the cost of that resolution. It is
there for experiments; [decisions.md](decisions.md) D38 has the measurements.

### visual

| Field                  | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `visual.enabled`       | `false` | Render the MCP server's own widget (the MCP Apps `ui://` resource a tool result names in `_meta.ui.resourceUri`, or the tool declares) to a JPEG for a device with a screen (D54). The agent starts a headless Chromium at warm-up and renders after a finished turn that called such a tool, when a second of the turn is left. Off: no browser starts and every turn has `visual: null`. The browser is built into the agent image only when this is on, so changing it needs `npm run deploy`. Costs image size and memory, see [cost.md](cost.md). |
| `visual.idleTimeoutMs` | `60000` | How long the screen should stay up without activity, in milliseconds, at least `10000`: the APL document's `settings.idleTimeout` (D68). A recommendation the device may bound. Read by the Alexa Skill Lambda, so a change needs `npm run deploy`.                                                                                                                                                                                                                                                                                                    |

What a widget gets is what an Alexa+ device would give it, and no more: a sandboxed iframe of
768×480 with no network (Chromium's only proxy is a dead port, loopback included, WebRTC may not
send UDP outside it, and request interception aborts every request but `data:` and `about:`),
`ui/initialize` answered with the device's theme and
`displayMode: fullscreen`, then the tool's input and result. It should send
`ui/notifications/size-changed` once it has drawn; the shot is taken then, or after 800 ms
with a warning in the log. The image is at most 1280 px wide and 90 KB; a widget that throws
gives no image, and the turn keeps its speech either way. A widget that hangs or runs its page
out of memory (the renderer heap is capped at 256 MB) costs that one image: the browser restarts
for the next render.

With the screen on, the stack builds the agent image with `WITH_SCREEN=1` (Alpine's `chromium`
and `font-noto`, about 330 MB more to pull); with it off the image has no browser. Turn it on and
run `npm run deploy`; if the deployed image has no browser, the agent logs one warning
("visual.enabled is on but the image has no browser") and answers without a visual.

To see the screen without a device, run `npm run chat -- --display 1280x800` (optionally
`:light`): every turn carries that display, and each rendered screen is saved as a JPEG whose
path is printed with its render time. In-process this turns the screen on for the chat and
needs a Chromium at `CHROMIUM_PATH`; with `--remote` the deployed config decides.

The browser binary comes from `CHROMIUM_PATH` (default `/usr/bin/chromium-browser`, which the
agent image installs). It is an environment variable of the container, not a config field;
set it only to run the renderer outside the image, for example in the agent's tests.

### answers

| Field             | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answers.choices` | `{}`    | Extra one-word answers for questions the server asks in its own speech (D67): a canonical value and the spoken synonyms that resolve to it. Each becomes a value of the answer-choice slot type, with the canonical value as its name and id, so "bee" reaches the server as "b". Keys and synonyms are lowercase words (letters, apostrophes, spaces, hyphens; no digits), and a synonym belongs to one choice. Read by `npm run generate` only; the deployed config leaves it out.                |
| `answers.intents` | unset   | Which of the bridge's own answer intents ship (D69): any of `date`, `number`, `freeText`, `choice`; unset ships all four. With `features.toolIntents: false`, `["choice"]` gives the slimmest model: the catch-all carries every other request and answer word for word, where a date or number intent would rewrite "on friday" as an ISO date. With tool intents off, the catch-all is also trained on every generated and override phrase, short ones included. Read by `npm run generate` only. |

```json
"answers": {
  "choices": {
    "a": ["ay", "option a", "letter a", "the first one"],
    "b": ["bee", "be", "option b", "letter b", "the second one"],
    "c": ["see", "sea", "option c", "letter c", "the third one"]
  }
}
```

The server must accept the canonical values (`a`, `b`, `c`) as answers. [customizing.md](customizing.md#answers-while-a-question-is-open) has the rest.

### aws

| Field              | Default     | Effect                                           |
| ------------------ | ----------- | ------------------------------------------------ |
| `region`           | `us-east-1` | Only us-east-1 has been verified.                |
| `logRetentionDays` | `7`         | Retention for every log group the stack creates. |

The stack creates no cost alarm: nothing in it runs always-on, and an alarm that notifies would need your email address in a tracked file. `npm run deploy` prints what accrues; [cost.md](cost.md) has the numbers and `npm run destroy` ends them.

## How config reaches each component

- Generator, CLI, CDK app, scripts: import `bridge.config.ts` directly (Node 22 strips the types; the file must use erasable syntax only), with `.env` applied on top before validation.
- Alexa Skill Lambda and agent container: one `BRIDGE_CONFIG` environment variable holding the merged config, set by the CDK stack at synth time, re-validated at startup.
