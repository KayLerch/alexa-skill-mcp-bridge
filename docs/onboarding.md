# Onboarding, walked by an agent

A procedure for a coding agent to take a developer through setup. Their side is one prompt:

```
Follow docs/onboarding.md
```

The [README](../README.md) explains what each step is for and is the only place that explanation lives.
This file is the order of operations, the gates, and the proof that each step worked. When the two
disagree, the README is right about _what_ and this file is wrong.

## Rules for the agent, before step 1

- **Money and other people's accounts.** `npm run deploy`, `npm run destroy`, `ask deploy`, `ask smapi *`
  and `cdk *` create, change or delete real resources. Ask in the message immediately before running one,
  and say what it creates and what it costs ([cost.md](cost.md)) before you ask. Track A creates nothing.
- **Never edit `bridge.config.ts`.** Developer-specific values go in `.env`, which is git-ignored. Show the
  line you propose to add, then add it.
- **Never say a step is done.** Every step ends with a command whose output proves it.
  `npm run doctor -- --track local|cloud|skill` is the state oracle: run it at any point, on a
  half-finished setup, and it reports what is actually true and prints the fix for whatever is not.
- **Manual steps belong to the developer.** Anything in a browser — Bedrock model access, `ask configure`,
  the Alexa developer console — you cannot do. Say exactly what to click, wait for them, then verify with a
  command. Never assume it happened.
- **Two failures and stop.** If a check fails twice, show the doctor output, say what you think is wrong,
  and hand back. Do not improvise around a failing prerequisite.
- **Stop where they want to stop.** Track A is a complete outcome, not a stepping stone. Ask before
  starting anything billable.

## Step 0: what are they here for

Ask which outcome they want, and say what each costs them in time and money:

| They want                                            | Track | Creates                   | Cost                                             |
| ---------------------------------------------------- | ----- | ------------------------- | ------------------------------------------------ |
| To hear their MCP server answer, in a terminal       | A     | Nothing in AWS            | Bedrock tokens only, fractions of a cent         |
| The agent running in AWS, driven from their terminal | B     | One CDK stack             | A few cents a month idle, see [cost.md](cost.md) |
| The Alexa Skill on a device or in the simulator      | C     | Stack plus an Alexa Skill | Same, plus manual console steps                  |

Then run `npm run doctor` and read it together. It is the fastest way to find out where they already are.

## Track A: their server answering, locally

1. **Node 22 and dependencies.** `node -v` must be 22.18 or later; `npm install` if `node_modules` is
   missing. Both are checked by `npm run doctor`, so run that rather than guessing.
2. **Local settings and the commit guard.** `cp .env.example .env` (the copy is inert: every line is
   commented, so the bundled national parks example stays the default) and
   `git config core.hooksPath .githooks`. One line of why: `.env` keeps their endpoint and ids out of
   commits, and the hook refuses a commit that carries one anyway.
3. **An MCP server to talk to.** If they have their own, add `BRIDGE_MCP_URL=<their url>` to `.env` — show
   the line first. If they do not, they use a bundled example: `npm run sample:start` runs the national
   parks one, and needs its own terminal (or the background, if your tool can hold a process).
   `npm run sample:start -- --list` shows the others; `EXAMPLE=<name>` picks one.
4. **Green doctor.** `npm run doctor` until every line is `ok`. Each failure prints a `→` fix; use it
   verbatim rather than inventing one. Model access is the common blocker and is a browser step: the
   Bedrock console link is in the doctor output, and `npm run check-model-access` confirms it afterwards.
5. **Talk to it.** `npm run chat`. Suggest the two-turn demo from the README so they see elicitation work:
   "which national park should I visit in June", then "stargazing" when it asks what they want to do.
   With their own server, suggest whatever their tools do.
6. **The judgment step.** If the agent picks the wrong tool or fills arguments badly, that is what their
   tool descriptions look like to a model. Say so plainly, offer `npm run chat -- --debug` to see the tool
   calls and timings, and let them fix descriptions on their server and try again. This is the point of
   Track A and worth spending time on. If they are heading for a device, suggest `npm run chat -- --record`
   now: what they say here becomes sample utterances for the Alexa Skill (see `docs/customizing.md`).

Stop here unless they asked for more.

## Track B: the agent in AWS

Everything here is billable. Say so, quote [cost.md](cost.md), and get a yes before each command that deploys.

1. **Prerequisites.** Docker Desktop or Finch running, CDK bootstrapped in us-east-1, and a **public**
   MCP URL — the deployed agent cannot reach `localhost`. For a laptop server, the README's cloudflared
   quick tunnel works; the URL goes in `.env` as `BRIDGE_MCP_URL`, and it changes on every tunnel restart.
2. **Regenerate.** `npm run generate` after any change to `mcp.*`. It rewrites the tool manifest and the
   interaction model from the live server.
3. **Check.** `npm run doctor -- --track cloud` must be green before deploying.
4. **Deploy.** Confirm, then `npm run deploy`. It prints the outputs and a cost note; read the note back
   to them rather than summarizing it away.
5. **Prove it.** `npm run chat -- --remote`. The first turn provisions the runtime and is slow; later ones
   are not.

## Track C: the Alexa Skill

Half of this is in a browser and belongs to the developer. Follow the README's Track C steps in order and
verify each with `npm run doctor -- --track skill`.

1. **ASK CLI**, installed and logged in (`ask configure` opens a browser — theirs to do).
2. **`npm run skill:deploy`** creates the Alexa Skill. Confirm before running it. It takes the Lambda
   ARN that `npm run deploy` wrote into `.env`, puts it into `skill-package/skill.json`, runs
   `ask deploy` from the repo root (never from `skill-package/`), and records the Alexa Skill id in
   `.env` as `BRIDGE_SKILL_ID`. If it stops for a missing ARN, `npm run deploy` has not run in this
   clone; the fix is in its message. Tell them `skill.json` now carries their AWS account id and the
   pre-commit hook will refuse to commit it — that is intended.
3. **Lock the Lambda.** Run `npm run deploy` again; with `BRIDGE_SKILL_ID` in `.env` it locks the
   Lambda to their Alexa Skill. Optional but recommended: until then any Alexa Skill that knows the
   function ARN can invoke theirs.
4. **The console.** They open the Alexa developer console, select the Alexa Skill named "bridge demo",
   go to Test, and set testing to Development. Then `open bridge demo` in the simulator, or
   "Alexa, open bridge demo" on a device signed in to the same account.

## Finishing

Ask whether they want it left running. `npm run destroy` removes the stack; the Alexa Skill stays in their
developer account at no cost and `ask smapi delete-skill --skill-id <id>` removes it. If they keep it,
point at the README's security section: the Lambda stays open until `BRIDGE_SKILL_ID` is set, and their
ARN should not become public before then.
