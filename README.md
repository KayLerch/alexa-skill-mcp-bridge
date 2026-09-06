# Alexa Skill MCP Bridge

<p align="center">
  <a href="https://github.com/KayLerch/alexa-skill-mcp-bridge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/KayLerch/alexa-skill-mcp-bridge/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Node 22.18 or later" src="https://img.shields.io/badge/node-%3E%3D22.18-339933?logo=node.js&logoColor=white">
  <img alt="Runs in us-east-1" src="https://img.shields.io/badge/region-us--east--1-lightgrey">
</p>
<p align="center">
  <a href="https://modelcontextprotocol.io/specification/2025-11-25"><img alt="MCP Streamable HTTP, protocol 2025-11-25" src="https://img.shields.io/badge/MCP-Streamable%20HTTP%20%C2%B7%202025--11--25-111111"></a>
  <a href="https://aws.amazon.com/bedrock/agentcore/"><img alt="Amazon Bedrock AgentCore Runtime" src="https://img.shields.io/badge/Amazon%20Bedrock-AgentCore%20Runtime-FF9900"></a>
  <a href="https://strandsagents.com/"><img alt="Strands Agents with Amazon Nova 2 Lite" src="https://img.shields.io/badge/Strands%20Agents-Nova%202%20Lite-232F3E"></a>
  <a href="https://amazonappdev2026.devpost.com/"><img alt="Amazon Devpost hackathon, Alexa+ track" src="https://img.shields.io/badge/Devpost-Alexa%2B%20track-003E54?logo=devpost&logoColor=white"></a>
</p>

Demo your MCP server on a physical Alexa+ device, through an Alexa Skill that stands in for an Alexa+ add-on.

An add-on is how an MCP server is meant to reach Alexa+, and that tooling is not open to the public yet. Alexa Skills are open to every developer today, so this bridge puts one where the add-on would be. The Alexa Skill wraps your MCP server, and behind it an agent emulates the work the Alexa+ orchestrator does for an add-on: it picks the MCP tool, fills the arguments, handles elicitation, turns the tool result into a short spoken answer, and carries the conversation's context to the next turn. From your server's side there is nothing unusual to see, just an MCP client over Streamable HTTP that declares `elicitation` and calls the tools you advertise.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/bridge.dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/img/bridge.light.svg">
    <img src="https://raw.githubusercontent.com/KayLerch/alexa-skill-mcp-bridge/main/docs/img/bridge.auto.svg" alt="The bridge at a glance, left to right: an Alexa+ device, the Alexa Skill, a thin Alexa Skill Lambda and AgentCore Runtime inside AWS us-east-1, and your MCP server outside it. The runtime holds a Strands agent on Nova 2 Lite, an MCP client over Streamable HTTP, and AgentCore Memory. Numbered arrows 1 to 4 carry the request rightwards to your server, and arrows 5 to 8 carry the answer back leftwards to the device. A numbered legend below the diagram explains all eight steps.">
  </picture>
</p>

This project exists mainly for the Alexa+ track of the [Amazon Devpost hackathon](https://amazonappdev2026.devpost.com/), where a submission is an MCP-server-backed Alexa+ experience and has to be demoed. Until Alexa+ add-on tooling opens up, an Alexa Skill is how you put your server in front of Alexa+ and record it: in your terminal, in the Alexa developer console's simulator, or on a physical Alexa+ device signed in to your Amazon developer account.

You put your MCP server URL into one config file. A generator turns your server's tools into an Alexa Skill interaction model so Alexa's NLU can route to them. One CDK stack deploys the agent that plays the orchestrator's part on Amazon Bedrock AgentCore Runtime (Strands Agents, Amazon Nova 2 Lite), and the Alexa Skill Lambda in front of it stays thin.

**This bridge reproduces the mechanics of an Alexa+ MCP client, not Alexa's own model judgment.** Tool choice, argument filling, and phrasing come from Nova 2 Lite with the prompts in this repo; Alexa+ will pick and phrase differently. What you can verify here: that your MCP server speaks Streamable HTTP at a version Alexa+ accepts, that its tool descriptions lead a model to the right call, that elicitation works with a spoken answer that arrives a minute later, and how your results sound.

**Tear down:** `npm run destroy` removes everything the cloud track created. See [docs/cost.md](docs/cost.md).

## Pick a track

| Track                                                                      | What you get                                                                                                           | Needs AWS?                                                            | Needs a device?                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [A. Local](#track-a-local-no-deployment)                                   | Chat with an MCP server through the real agent in your terminal. The bundled sample server works; your own is optional | Credentials and Bedrock model access only (the model runs in Bedrock) | No                                                                                              |
| [B. Cloud](#track-b-deploy-to-the-cloud)                                   | The agent runs on AgentCore Runtime; you chat with it from your terminal                                               | Yes, one CDK stack                                                    | No                                                                                              |
| [C. Alexa Skill](#track-c-the-alexa-skill-in-the-simulator-or-on-a-device) | The Alexa Skill end to end, in the browser simulator or on a device                                                    | Yes                                                                   | No: the developer console's simulator runs the Alexa Skill in the browser. A device is optional |

Each track builds on the previous one. `npm run doctor -- --track local|cloud|skill` checks every prerequisite of a track and prints the exact command to fix what is missing. Run it whenever something fails.

Prefer to be walked through it? Point your coding agent at [docs/onboarding.md](docs/onboarding.md) (`/onboard` in Claude Code) and it will take you through the steps below, ask before anything that costs money, and verify each step with `npm run doctor` instead of assuming.

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
cp .env.example .env                     # your settings; git-ignored
git config core.hooksPath .githooks      # blocks commits that carry your URL, ARN, or Alexa Skill id
```

`bridge.config.ts` holds the settings of the bridge and is meant to stay as it ships. What is yours goes in `.env`: your MCP URL, your Alexa Skill id, your secret name. See [docs/config.md](docs/config.md) and, before you push a fork anywhere public, [the note at the bottom of this README](#security-privacy-and-what-to-keep-out-of-git).

**AWS credentials with Bedrock model access.** Even the local track calls the model in Bedrock; nothing else in AWS is touched until track B.

```bash
brew install awscli            # or https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
aws configure                  # access key, secret, region us-east-1
aws sts get-caller-identity    # prints your account: credentials work
```

Then enable **Amazon Nova 2 Lite** under Model access in the [Bedrock console for us-east-1](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess). `npm run check-model-access` confirms it with one tiny model call.

**An MCP server.** Yours, or a bundled example. The default one answers questions about fourteen US national parks and asks back when a request is underdetermined, which exercises the whole flow including elicitation. Requirements for yours are [below](#requirements-your-server-must-meet).

## Track A: local, no deployment

You do not need an MCP server of your own to start. The bundled national parks example has two tools whose answers depend on a park, a month and an activity, so it asks back when a request is underdetermined and the whole flow including elicitation is exercised.

Terminal 1, if you use a bundled example:

```bash
npm run sample:start           # national parks, on http://localhost:3939/mcp
npm run sample:start -- --list # the examples that ship with the repo
EXAMPLE=hotels-weather npm run sample:start   # the hotels-and-weather one instead
```

Terminal 2:

```bash
npm run doctor                 # checks Node, dependencies, config, the MCP server, AWS, model access
npm run chat                   # talks to the server through the real agent, in-process
```

Try: "which national park should I visit in June" (it asks what you want to do; answer "stargazing"), then "what is the best park for fishing", then "tell me about Glacier" (it asks which month), then "stop".

Heading for a device later? Run it as `npm run chat -- --record`: everything you say is kept in `skill-package/training/`, and `npm run generate` turns those phrasings into sample utterances for the Alexa Skill, so it understands the way you actually ask. Details in [docs/customizing.md](docs/customizing.md).

To use your own server instead: put its URL in `.env` as `BRIDGE_MCP_URL` (and `BRIDGE_MCP_AUTH_TYPE` plus `BRIDGE_MCP_SECRET_NAME` if it needs a token, see [docs/config.md](docs/config.md)), then `npm run doctor` and `npm run chat` again. `npm run chat -- --debug` shows tool calls and timings; `-- --budget 3000` simulates a tighter Alexa deadline.

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

  Put `https://<random>.trycloudflare.com/mcp` into `.env` as `BRIDGE_MCP_URL`. Quick tunnels change their URL every start; a named tunnel or a real host is better for anything longer than a session.

Then:

```bash
npm run generate                       # manifest and interaction model from your server, plus what you recorded in chat
npm run doctor -- --track cloud        # Docker, bootstrap, public URL, plus everything from track A
npm run deploy                         # cdk deploy; prints outputs and what starts costing money
npm run chat -- --remote               # the same chat, through the deployed runtime
```

The first `--remote` turn provisions the runtime and may take a while; the ones after it are fast. The stack costs a few cents a month idle; see [docs/cost.md](docs/cost.md).

`npm run generate` builds the Alexa interaction model from your tools: one intent per tool with sample utterances for every combination of its arguments, a catch-all for phrasings it did not predict, and everything you said in `npm run chat -- --record`. If Alexa still mishears a request your server should handle, [docs/customizing.md](docs/customizing.md) shows how to add utterances, synonyms and intents without touching a generated file.

## Track C: the Alexa Skill, in the simulator or on a device

Additional prerequisites:

- **An Amazon developer account** at https://developer.amazon.com. A physical Alexa+ device (or Alexa+ screen device) is optional: the developer console's Test simulator runs against the deployed Alexa Skill in the browser. If you do use a physical Alexa device, sign it in to the same Amazon account.
- **The ASK CLI**, logged in:

  ```bash
  npm install -g ask-cli
  ask configure                          # opens the browser; pick "No" for the AWS profile question
  ask smapi get-vendor-list              # prints your vendor: logged in
  ```

Then, from the repo root:

1. `npm run doctor -- --track skill`
2. `npm run skill:deploy` creates the Alexa Skill with the generated interaction model. It takes the Lambda ARN that `npm run deploy` wrote into `.env` (`BRIDGE_LAMBDA_ARN`), puts it into `skill-package/skill.json`, runs `ask deploy` from the repo root, and records the new Alexa Skill id in `.env` as `BRIDGE_SKILL_ID`. The `skill.json` edit stays local: it carries your AWS account id, and the pre-commit hook stops you from committing it. If you would rather not use the script, paste the ARN into `skill.json` at `apis.custom.endpoint.uri` yourself and run `ask deploy` from the repo root.
3. **Optional but recommended:** run `npm run deploy` once more. With `BRIDGE_SKILL_ID` in `.env` it locks the Lambda to your Alexa Skill; until then any Alexa Skill that knows your function ARN can invoke it.
4. In the [Alexa developer console](https://developer.amazon.com/alexa/console/ask), open the Alexa Skill named 'bridge demo', go to Test, and set testing to Development.
5. Talk to it, either way:
   - **In the browser**: type `open bridge demo` in the Test simulator, or hold the microphone and say it.
   - **On a device**: "Alexa, open bridge demo" (if that does not work, try "Alexa, open bridge demo skill", which is how Alexa disambiguates)

   The first launch after a while may say it is still starting up; open it again.

Say a request the interaction model covers ("what is the best park for fishing") or anything else; a phrasing the tool intents do not recognise still reaches the agent through the catch-all. When the tool asks a question, answer with a word from its choices, a number, a date, yes or no, or "the answer is …" for free text. If Alexa keeps mishearing something your server should handle, see [docs/customizing.md](docs/customizing.md).

When you are done: `npm run destroy`. The Alexa Skill stays in your Amazon developer account at no cost; `ask smapi delete-skill --skill-id <id>` removes it.

## When something fails

- `npm run doctor -- --track <track>` first. It names the missing piece and the command that fixes it.
- Every script refuses to run on the wrong Node version and says how to switch.
- The example servers tell you when their port is taken and which `PORT=` to use instead.
- `npm run chat` explains why it could not reach the MCP server instead of failing on the first turn.
- [docs/troubleshooting.md](docs/troubleshooting.md) covers cold starts, "still working" loops, dropped elicitation streams, model access, and the Alexa free-text limitation.

## Commands

| Command                                         | What it does                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run doctor -- --track local\|cloud\|skill` | Prerequisite check with fixes.                                                                                                              |
| `npm run sample:start`                          | An example MCP server on port 3939. `EXAMPLE=<name>` picks one, `-- --list` shows them, `PORT=…` moves it. Logs every request and reply.    |
| `npm run chat`                                  | REPL through the in-process agent. `-- --debug`, `-- --remote`, `-- --budget <ms>`, `-- --record` (what you say becomes sample utterances). |
| `npm run generate`                              | Regenerate the manifest and interaction model. `-- --no-model` for deterministic utterances without a Bedrock call.                         |
| `npm run check-model-access`                    | One test call per configured model.                                                                                                         |
| `npm run agent:dev`                             | Build and run the agent container locally on 8080.                                                                                          |
| `npm run synth`                                 | `cdk synth`, no AWS calls.                                                                                                                  |
| `npm run deploy` / `npm run destroy`            | The stack.                                                                                                                                  |
| `npm run check:leaks`                           | What the pre-commit hook runs: staged files, or `-- --all` for everything a `git add -A` would commit.                                      |
| `npm test`, `npm run lint`, `npm run build`     | Tests need no AWS credentials; `npm run test:live` runs the round trip with the real model.                                                 |

## What happens on a turn

One turn is the eight numbered steps in the diagram near the top of this page. The whole round trip has to finish inside the few seconds Alexa allows, which is what shapes every choice in the turn path.

Elicitation: when your tool asks the user a question, the agent parks the open `tools/call` stream inside the microVM, the Alexa Skill speaks the question, and the answer on the next turn resumes the same tool call. Multi-field forms become one spoken question per field. Details in [docs/architecture.md](docs/architecture.md).

## Requirements your server must meet

- **Streamable HTTP.** The bridge declares the `elicitation` capability at `initialize` and speaks whatever
  protocol version the MCP SDK negotiates, so older servers work here. An Alexa+ add-on needs
  **2025-11-25 or later**, the latest known floor, so anything below it gets a warning from
  `npm run generate`, `npm run doctor`, and the agent log.
- Elicitation in form mode with flat primitive properties (string, number, integer, boolean, enum). URL-mode elicitation is declined with a spoken explanation.
- If a tool elicits, the server's `elicitInput` timeout must exceed the MCP SDK's 60 s default, and it should send a `ping` every 15 s or so to keep tunnels from cutting the stream. The example servers show both.
- **Set `relatedRequestId` on the elicitation** to the tool call's request id, so the question travels on the stream the client is already waiting on. Without it the SDK uses a side channel the client may not have opened yet, and the message is dropped with no error: the call then hangs until it times out. Measured, and the example servers show it.

## Docs

- [docs/architecture.md](docs/architecture.md): the turn story, elicitation parking, the state machine, and what was verified against live AWS.
- [docs/config.md](docs/config.md): every field, default, and effect.
- [docs/onboarding.md](docs/onboarding.md): the setup procedure an agent follows to walk you through this README.
- [docs/customizing.md](docs/customizing.md): when Alexa does not understand a phrasing your server should handle — utterances, synonyms, extra intents, and letting `npm run chat -- --record` write them for you.
- [docs/cost.md](docs/cost.md): a worked example per turn and what costs money when.
- [docs/troubleshooting.md](docs/troubleshooting.md).
- [docs/decisions.md](docs/decisions.md): every decision with its rationale and what would reverse it, plus the dated verification log.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md): layout, style, naming, and the rules for generated files. `AGENTS.md` is the instruction file for whichever coding agent you use; `CLAUDE.md` is a symlink to it.
- [docs/history/](docs/history/): the original brief and execution plan, frozen. Provenance, not instruction.

## Out of scope for v1

Widgets and visual output (`visual` is always null; `_meta.ui.resourceUri` is preserved for later), a web frontend (the CLI harness and the `Turn` contract are its foundation), OAuth authorization-code account linking, other locales, MCP 2026-07-28 stateless elicitation, Alexa progressive responses.

## Security, privacy, and what to keep out of git

This is a development bridge, and it is meant to be forked in public. Here is the full list of what that means, what the repo does about it, and what is left to you.

**Things that must not reach a commit.** `git config core.hooksPath .githooks` (from the prerequisites) runs `npm run check:leaks` before every commit and refuses one that carries any of these. Run it yourself any time with `npm run check:leaks -- --all`; override a false positive with `git commit --no-verify`. Before you push, run it once more with `-- --all`. The generated interaction model and tool manifest are meant to be committed: they are deterministic and carry nothing that identifies you. `npm run destroy` puts the placeholder ARN back into `skill-package/skill.json` and drops `BRIDGE_LAMBDA_ARN` from `.env`, so a torn-down clone is committable again.

- **Your MCP endpoint** belongs in `.env` as `BRIDGE_MCP_URL`, never in `bridge.config.ts`.
- **Your Lambda ARN** goes into `skill-package/skill.json` for `ask deploy` (track C, step 1) and carries your AWS account id. Keep that edit local; the repo ships a placeholder.
- **Your Alexa Skill id** belongs in `.env` as `BRIDGE_SKILL_ID`.
- **Never put a token in `mcp.url`.** Use `mcp.auth` with a Secrets Manager secret name; the value stays in Secrets Manager, or in `.env` as `MCP_SECRET_VALUE` for local runs.
- **The generated manifest and interaction model describe your server**: tool names, descriptions, and input schemas. If that surface is not public, add `packages/skill-lambda/generated/` and `skill-package/interactionModels/` to `.gitignore` in your fork and regenerate after cloning.

**The Alexa Skill Lambda is open until you set your Alexa Skill id.** The Alexa service principal is shared by every Alexa Skill in the world, so until `BRIDGE_SKILL_ID` is set and you have deployed again, any Alexa Skill whose developer knows your function ARN can invoke your Lambda: your Bedrock spend, your agent, your MCP server. This is how most Alexa Skill Lambdas start out and it is fine while your ARN is private. Track C, step 4 closes it; do it before you share anything that names the ARN.

**Your MCP server is trusted.** Its `instructions` go into the agent's system prompt and its tool results go to the model, so a hostile or compromised server can steer what the Alexa Skill says. Point the bridge at servers you control.

**Debug mode logs what people say.** `features.debug` (and the `LOG_LEVEL=debug` it sets on the runtime) puts tool arguments in CloudWatch and in every response. Arguments are whatever the user said: names, dates, destinations. Development only.

**Voice data leaves the device.** Utterances go to Bedrock for the model call. With `memory.shortTerm` or `memory.longTerm` on, they are also stored in AgentCore Memory for 30 days, keyed by a SHA-256 of the Alexa user id: raw Alexa ids never leave the Lambda. Set both to `false` to store nothing. `skill.json` declares `usesPersonalInfo: false`, which holds for a development Alexa Skill you never distribute; revisit it before certification.

**The merged config travels as an environment variable.** `BRIDGE_CONFIG` on the Lambda and on the runtime holds your MCP URL and every other setting, visible to anyone with read access to your AWS account, and it appears in the CloudFormation template. Nothing secret is in there by design; keep it that way.

**Smaller things, on purpose.** The Docker build context excludes `.env` (`.dockerignore`), but `npm run agent:dev` passes the config to `docker run` on the command line, where `ps` can see it. The Secrets Manager grant matches `<your-secret-name>-*`, which is how AWS name suffixes work. Neither matters on a development machine; both are worth knowing if you adapt this for anything else.

License: Apache-2.0. Owner: Kay Lerch.
