# Contributing

Thanks for helping. This is a small project; the rules are short.

## Run it

```bash
nvm use            # Node 22
npm install        # npm only, never pnpm or yarn
cp .env.example .env                     # your settings, git-ignored
git config core.hooksPath .githooks      # runs npm run check:leaks before each commit
npm run build      # tsc -b across packages
npm test           # vitest, no AWS credentials needed
npm run lint       # ESLint, Prettier, tooling typecheck
```

`npm run sample:start` runs the default example MCP server (national parks) on port 3939 and `npm run chat` talks to it through the real agent code in-process. That is the fastest loop for anything in `packages/agent`.

The repo is public and `bridge.config.ts` is tracked, so nothing that identifies you may go in it: your endpoint, secret name, Alexa Skill id and region come from `.env`. `npm run check:leaks` is what CI and the hook run; the README's security section explains what it looks for.

## Where code goes

| Concern                                                           | Package                              |
| ----------------------------------------------------------------- | ------------------------------------ |
| Turn contract, config schema, id hashing, manifest schema, logger | `packages/core` (no AWS deps)        |
| MCP session, elicitation parking, agent loop, prompts, memory     | `packages/agent`                     |
| Alexa handlers (thin: build `TurnInput`, call the bridge, render) | `packages/skill-lambda`              |
| MCP scan → manifest, interaction model, utterances                | `packages/generator`                 |
| Local REPL, in-process or remote                                  | `packages/cli`                       |
| CDK stack                                                         | `infra`                              |
| Sample MCP server                                                 | `examples/hotels-weather-mcp-server` |

Import direction is downward only: `cli → agent → core`, `skill-lambda → core`, `generator → core`, `infra → core`.

## Style

The code style and naming rules live in [AGENTS.md](AGENTS.md), which is what a coding agent reads and what a human contributor should skim. In short: small modules, one file per concern, explicit types at boundaries, zod at every input edge, no prompt strings in TypeScript, errors become short spoken messages at the edge and structured logs inside.

## Tests

Unit tests sit next to the code as `*.test.ts`. The integration test in `packages/cli/test` runs the in-process agent against the hotels-and-weather example server with a scripted model and must pass without AWS credentials. `npm run test:live` runs the same with the real model.

## Dependencies

A new dependency needs a one-line reason in the commit message. Keep the count low.

## Generated files

Never edit `packages/skill-lambda/generated/*` or `skill-package/interactionModels/custom/*` by hand. Run `npm run generate`. Additions go to `skill-package/overrides/<locale>.utterances.json` or come from `npm run chat -- --record`; see [docs/customizing.md](docs/customizing.md).
