# alexa-skill-mcp-bridge

Test your MCP server on a physical Echo as if it were an Alexa+ add-on, before you have access to Amazon's Alexa+ add-on tooling.

Put your MCP server URL into one config file, run a generator that turns the server's tools into an Alexa interaction model, deploy one CDK stack, deploy the Alexa skill with the ASK CLI, and talk to your MCP server through an Echo. An agent on Amazon Bedrock AgentCore Runtime (Strands Agents, Amazon Nova 2 Lite) does what the Alexa+ orchestrator would do: picks the tool, fills arguments, handles elicitation, turns tool results into short spoken answers, and keeps conversation context.

**This bridge reproduces the mechanics of an Alexa+ MCP client, not Alexa's own model judgment.** Tool choice, argument filling, and phrasing come from Nova 2 Lite with the prompts in this repo. Alexa+ will pick and phrase differently. What you can verify here: that your server speaks MCP 2025-11-25 over Streamable HTTP, that its tool descriptions lead a model to the right call, that elicitation works with a spoken answer that arrives a minute later, and how your results sound.

**Tear down:** `npm run destroy` removes everything the stack created. Details in [docs/cost.md](docs/cost.md).

## Quick start

1. Prerequisites: Node 22.18 or later, AWS CLI with credentials, CDK bootstrapped in us-east-1 (`npx cdk bootstrap`), Docker or Finch, ASK CLI logged in (`ask configure`), and [Bedrock model access](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess) enabled for Amazon Nova 2 Lite.
2. `git clone … && cd alexa-skill-mcp-bridge && npm install`
3. Edit `bridge.config.ts`: set `mcp.url` to your server's Streamable HTTP endpoint (and `mcp.auth` with a Secrets Manager secret name if it needs a token). The default points at the bundled sample server: `npm run sample:start` in another terminal if you want to try that first.
4. `npm run generate` writes the tool manifest and the interaction model. Review `skill-package/interactionModels/custom/en-US.json`; add your own phrasings to `skill-package/overrides/en-US.utterances.json` if you like.
5. `npm run chat` talks to your server through the real agent code, in-process. If the agent picks the wrong tool, fix the tool description on your server. `--debug` shows tool calls and timings.
6. `npm run deploy` creates the stack and prints the Lambda ARN and a cost note. From here on, turns cost fractions of a cent and an idle session costs about nothing.
7. Put the Lambda ARN into `skill-package/skill.json` (`apis.custom.endpoint.uri`), then `ask deploy` from the repo root. Note the skill id it prints.
8. Put the skill id into `bridge.config.ts` (`skill.id`) and run `npm run deploy` again. Until then the Lambda accepts requests from any skill.
9. In the [Alexa developer console](https://developer.amazon.com/alexa/console/ask), enable testing for the skill in Development, then on an Echo on the same Amazon account: "Alexa, open my bridge". The first launch after a while may say it is still starting up; open it again.
10. When you are done: `npm run destroy`. The skill stays in your developer account at no cost (`ask smapi delete-skill --skill-id <id>` removes it).

Your MCP server must be reachable from AWS. For a server on your laptop, a cloudflared quick tunnel works: see [examples/sample-mcp-server/README.md](examples/sample-mcp-server/README.md).

## What it does on a turn

```
Echo ── voice ──► Alexa NLU ── intent + slots ──► skill Lambda (thin)
                                                      │ InvokeAgentRuntime, 6.5 s budget
                                                      ▼
                                       AgentCore Runtime: one microVM per user
                                         Strands agent + Nova 2 Lite
                                         MCP client over Streamable HTTP ──► your server
                                         AgentCore Memory (history, preferences)
                                                      │ {speech, question?, endSession}
                                                      ▼
                                              Lambda renders SSML ──► Echo speaks
```

Elicitation: when your tool asks the user a question, the agent parks the open `tools/call` stream inside the microVM, the skill speaks the question, and the answer on the next turn resumes the same tool call. Multi-field forms become one spoken question per field.

## Commands

| Command                                     | What it does                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run sample:start`                      | Sample MCP server on port 3000 (`PORT=…` to change).                                                                                                                       |
| `npm run chat`                              | REPL through the in-process agent. `-- --debug` for tool calls and timings, `-- --remote` through the deployed runtime, `-- --budget 3000` to simulate a tighter deadline. |
| `npm run generate`                          | Regenerate the manifest and interaction model. `-- --no-model` for deterministic template utterances without a Bedrock call.                                               |
| `npm run agent:dev`                         | Build and run the agent container locally on 8080.                                                                                                                         |
| `npm run synth`                             | `cdk synth`, no AWS calls.                                                                                                                                                 |
| `npm run deploy` / `npm run destroy`        | The stack.                                                                                                                                                                 |
| `npm test`, `npm run lint`, `npm run build` | The usual. Tests need no AWS credentials; `npm run test:live` runs the round trip with the real model.                                                                     |

## Docs

- [docs/architecture.md](docs/architecture.md): the turn story, elicitation parking, the state machine, and what was verified against live AWS.
- [docs/config.md](docs/config.md): every field, default, and effect.
- [docs/cost.md](docs/cost.md): a worked example per turn and what costs money when.
- [docs/troubleshooting.md](docs/troubleshooting.md): cold starts, "still working" loops, dropped elicitation streams, model access.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md): layout, style, and the rules for generated files.

## Requirements your server must meet

- MCP protocol **2025-11-25 or later** over **Streamable HTTP**. The bridge declares the `elicitation` capability at `initialize` and refuses older servers.
- Elicitation in form mode with flat primitive properties (string, number, integer, boolean, enum). URL-mode elicitation is declined with a spoken explanation.
- If a tool elicits, the server's `elicitInput` timeout must be longer than the MCP SDK's 60 s default, and it should send a `ping` every 15 s or so to keep tunnels from cutting the stream. The sample server shows both.

## Out of scope for v1

Widgets and visual output (`visual` is always null; `_meta.ui.resourceUri` is preserved for later), a web frontend (the CLI harness and the `Turn` contract are its foundation), OAuth authorization-code account linking, other locales, MCP 2026-07-28 stateless elicitation, Alexa progressive responses.

License: Apache-2.0. Owner: Kay Lerch.
