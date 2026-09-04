# alexa-skill-mcp-bridge

Test your MCP server as if it were an Alexa+ add-on, before you have access to Amazon's Alexa+ add-on tooling. In your terminal, in the Alexa developer console's simulator, or on a physical Alexa+ device.

You put your MCP server URL into one config file. A generator turns the server's tools into an Alexa interaction model. One CDK stack deploys an agent on Amazon Bedrock AgentCore Runtime (Strands Agents, Amazon Nova 2 Lite) that does what the Alexa+ orchestrator would do: picks the tool, fills arguments, handles elicitation, turns tool results into short spoken answers, and keeps conversation context. An Alexa skill connects that agent to your Alexa+ device.

**This bridge reproduces the mechanics of an Alexa+ MCP client, not Alexa's own model judgment.** Tool choice, argument filling, and phrasing come from Nova 2 Lite with the prompts in this repo; Alexa+ will pick and phrase differently. What you can verify here: that your server speaks MCP 2025-11-25 over Streamable HTTP, that its tool descriptions lead a model to the right call, that elicitation works with a spoken answer that arrives a minute later, and how your results sound.

**Tear down:** `npm run destroy` removes everything the cloud track created. See [docs/cost.md](docs/cost.md).

## Pick a track

| Track                                                                | What you get                                                                                                           | Needs AWS?                                                            | Needs a device?                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [A. Local](#track-a-local-no-deployment)                             | Chat with an MCP server through the real agent in your terminal. The bundled sample server works; your own is optional | Credentials and Bedrock model access only (the model runs in Bedrock) | No                                                                                        |
| [B. Cloud](#track-b-deploy-to-the-cloud)                             | The agent runs on AgentCore Runtime; you chat with it from your terminal                                               | Yes, one CDK stack                                                    | No                                                                                        |
| [C. Skill](#track-c-the-alexa-skill-in-the-simulator-or-on-a-device) | The Alexa skill end to end, in the browser simulator or on a device                                                    | Yes                                                                   | No: the developer console's simulator runs the skill in the browser. A device is optional |

Each track builds on the previous one. `npm run doctor -- --track local|cloud|skill` checks every prerequisite of a track and prints the exact command to fix what is missing. Run it whenever something fails.

## Prerequisites for every track

**Node 22.18 or later.** The repo ships an `.nvmrc`; npm refuses to install on older versions and every script checks before it runs.

```bash
# with nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash   # skip if you have nvm
nvm install 22 && nvm use
node --version   # v22.x
```

Without nvm: `brew install node@22` on macOS, or the installer from https://nodejs.org/en/download.

**The repo.**

```bash
git clone https://github.com/<you>/alexa-skill-mcp-bridge.git
cd alexa-skill-mcp-bridge
npm install
```

**AWS credentials with Bedrock model access.** Even the local track calls the model in Bedrock; nothing else in AWS is touched until track B.

```bash
brew install awscli            # or https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
aws configure                  # access key, secret, region us-east-1
aws sts get-caller-identity    # prints your account: credentials work
```

Then enable **Amazon Nova 2 Lite** under Model access in the [Bedrock console for us-east-1](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess). `npm run check-model-access` confirms it with one tiny model call.

**An MCP server.** Yours, or the bundled sample (two tools, one of them elicits). Requirements for yours are [below](#requirements-your-server-must-meet).

## Track A: local, no deployment

You do not need an MCP server of your own to start. The bundled sample has two tools, one of which asks the user a question back, so the whole flow including elicitation is exercised.

Terminal 1, if you use the sample server:

```bash
npm run sample:start           # http://localhost:3939/mcp
```

Terminal 2:

```bash
npm run doctor                 # checks Node, dependencies, config, the MCP server, AWS, model access
npm run chat                   # talks to the server through the real agent, in-process
```

Try: "find hotels in Berlin from the fifth to the seventh of October" (the tool asks how many guests; answer "two"), then "what is the weather in Hamburg", then "stop".

To use your own server instead: set `mcp.url` in `bridge.config.ts` (and `mcp.auth` if it needs a token, see [docs/config.md](docs/config.md)), then `npm run doctor` and `npm run chat` again. `npm run chat -- --debug` shows tool calls and timings; `-- --budget 3000` simulates a tighter Alexa deadline.

If the agent picks the wrong tool or fills arguments badly, that is what your tool descriptions look like to a model: fix them on the server and try again.

## Track B: deploy to the cloud

Additional prerequisites:

- **Docker Desktop or Finch**, running, to build the arm64 agent image. `brew install --cask docker` then start Docker Desktop, or `brew install finch && finch vm start` and export `CONTAINER_CLI=finch`.
- **CDK bootstrapped** in us-east-1, once per account: `npx cdk bootstrap aws://<account-id>/us-east-1`. The deploying principal needs `iam:CreateServiceLinkedRole` (AgentCore creates its service-linked role on first use).
- **A public URL for your MCP server.** The agent runs in AWS and cannot reach `localhost`. For a server on your laptop, a cloudflared quick tunnel works:

  ```bash
  brew install cloudflared
  cloudflared tunnel --url http://localhost:3939     # prints https://<random>.trycloudflare.com
  ```

  Put `https://<random>.trycloudflare.com/mcp` into `mcp.url`. Quick tunnels change their URL every start; a named tunnel or a real host is better for anything longer than a session.

Then:

```bash
npm run generate                       # manifest and interaction model from your server
npm run doctor -- --track cloud        # Docker, bootstrap, public URL, plus everything from track A
npm run deploy                         # cdk deploy; prints outputs and what starts costing money
npm run chat -- --remote               # the same chat, through the deployed runtime
```

The first `--remote` turn provisions the runtime and may take a while; the ones after it are fast. The stack costs a few cents a month idle; see [docs/cost.md](docs/cost.md).

## Track C: the Alexa skill, in the simulator or on a device

Additional prerequisites:

- **An Amazon developer account** at https://developer.amazon.com. A physical Alexa+ device (or Alexa+ screen device) is optional: the developer console's Test simulator runs the deployed skill in the browser. If you do use a device, sign it in to the same Amazon account.
- **The ASK CLI**, logged in:

  ```bash
  npm install -g ask-cli
  ask configure                          # opens the browser; pick "No" for the AWS profile question
  ask smapi get-vendor-list              # prints your vendor: logged in
  ```

Then, from the repo root:

1. Take the `LambdaArn` printed by `npm run deploy` and put it into `skill-package/skill.json` at `apis.custom.endpoint.uri`.
2. `npm run doctor -- --track skill`
3. `ask deploy` creates the skill with the generated interaction model and prints the skill id (`amzn1.ask.skill.…`).
4. Put that id into `bridge.config.ts` as `skill.id` and run `npm run deploy` again. Until then the Lambda accepts requests from any skill.
5. In the [Alexa developer console](https://developer.amazon.com/alexa/console/ask), open the skill, go to Test, and set testing to Development.
6. Talk to it, either way:
   - **In the browser**: type or hold the microphone in the Test simulator: "open my bridge" (or whatever `skill.invocationName` says).
   - **On a device**: "Alexa, open my bridge".

   The first launch after a while may say it is still starting up; open it again.

Say a request the interaction model knows ("search hotels in Berlin") or use free text ("ask my bridge to find hotels in Berlin"). When the tool asks a question, answer with a number, a date, yes or no, or "the answer is …" for free text.

When you are done: `npm run destroy`. The skill stays in your developer account at no cost; `ask smapi delete-skill --skill-id <id>` removes it.

## When something fails

- `npm run doctor -- --track <track>` first. It names the missing piece and the command that fixes it.
- Every script refuses to run on the wrong Node version and says how to switch.
- The sample server tells you when its port is taken and which `PORT=` to use instead.
- `npm run chat` explains why it could not reach the MCP server instead of failing on the first turn.
- [docs/troubleshooting.md](docs/troubleshooting.md) covers cold starts, "still working" loops, dropped elicitation streams, model access, and the Alexa free-text limitation.

## Commands

| Command                                         | What it does                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run doctor -- --track local\|cloud\|skill` | Prerequisite check with fixes.                                                                                      |
| `npm run sample:start`                          | Sample MCP server on port 3939 (`PORT=…` to change; then set `mcp.url`).                                            |
| `npm run chat`                                  | REPL through the in-process agent. `-- --debug`, `-- --remote`, `-- --budget <ms>`.                                 |
| `npm run generate`                              | Regenerate the manifest and interaction model. `-- --no-model` for deterministic utterances without a Bedrock call. |
| `npm run check-model-access`                    | One test call per configured model.                                                                                 |
| `npm run agent:dev`                             | Build and run the agent container locally on 8080.                                                                  |
| `npm run synth`                                 | `cdk synth`, no AWS calls.                                                                                          |
| `npm run deploy` / `npm run destroy`            | The stack.                                                                                                          |
| `npm test`, `npm run lint`, `npm run build`     | Tests need no AWS credentials; `npm run test:live` runs the round trip with the real model.                         |

## What happens on a turn

```
Alexa+ device ── voice ──► Alexa NLU ── intent + slots ──► skill Lambda (thin)
                                                             │ InvokeAgentRuntime, 6.5 s budget
                                                             ▼
                                              AgentCore Runtime: one microVM per user
                                                Strands agent + Nova 2 Lite
                                                MCP client over Streamable HTTP ──► your server
                                                AgentCore Memory (history, preferences)
                                                             │ {speech, question?, endSession}
                                                             ▼
                                                     Lambda renders SSML ──► the device speaks
```

Elicitation: when your tool asks the user a question, the agent parks the open `tools/call` stream inside the microVM, the skill speaks the question, and the answer on the next turn resumes the same tool call. Multi-field forms become one spoken question per field. Details in [docs/architecture.md](docs/architecture.md).

## Requirements your server must meet

- MCP protocol **2025-11-25 or later** over **Streamable HTTP**. The bridge declares the `elicitation` capability at `initialize` and refuses older servers.
- Elicitation in form mode with flat primitive properties (string, number, integer, boolean, enum). URL-mode elicitation is declined with a spoken explanation.
- If a tool elicits, the server's `elicitInput` timeout must exceed the MCP SDK's 60 s default, and it should send a `ping` every 15 s or so to keep tunnels from cutting the stream. The sample server shows both.

## Docs

- [docs/architecture.md](docs/architecture.md): the turn story, elicitation parking, the state machine, and what was verified against live AWS.
- [docs/config.md](docs/config.md): every field, default, and effect.
- [docs/cost.md](docs/cost.md): a worked example per turn and what costs money when.
- [docs/troubleshooting.md](docs/troubleshooting.md).
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md): layout, style, and the rules for generated files.

## Out of scope for v1

Widgets and visual output (`visual` is always null; `_meta.ui.resourceUri` is preserved for later), a web frontend (the CLI harness and the `Turn` contract are its foundation), OAuth authorization-code account linking, other locales, MCP 2026-07-28 stateless elicitation, Alexa progressive responses.

License: Apache-2.0. Owner: Kay Lerch.
