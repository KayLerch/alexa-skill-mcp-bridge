# Contributing

Thanks for helping. This is a small project; the rules are short.

## Run it

```bash
nvm use            # Node 22
npm install        # npm only, never pnpm or yarn
npm run build      # tsc -b across packages
npm test           # vitest, no AWS credentials needed
npm run lint       # ESLint, Prettier, tooling typecheck
```

`npm run sample:start` runs the sample MCP server on port 3000 and `npm run chat` talks to it through the real agent code in-process. That is the fastest loop for anything in `packages/agent`.

## Where code goes

| Concern                                                           | Package                       |
| ----------------------------------------------------------------- | ----------------------------- |
| Turn contract, config schema, id hashing, manifest schema, logger | `packages/core` (no AWS deps) |
| MCP session, elicitation parking, agent loop, prompts, memory     | `packages/agent`              |
| Alexa handlers (thin: build `TurnInput`, call the bridge, render) | `packages/skill-lambda`       |
| MCP scan → manifest, interaction model, utterances                | `packages/generator`          |
| Local REPL, in-process or remote                                  | `packages/cli`                |
| CDK stack                                                         | `infra`                       |
| Sample MCP server                                                 | `examples/sample-mcp-server`  |

Import direction is downward only: `cli → agent → core`, `skill-lambda → core`, `generator → core`, `infra → core`.

## Style

The code style rules live in [CLAUDE.md](CLAUDE.md) (section "Code style") and the brief's section 10. In short: small modules, one file per concern, explicit types at boundaries, zod at every input edge, no prompt strings in TypeScript, errors become short spoken messages at the edge and structured logs inside.

## Tests

Unit tests sit next to the code as `*.test.ts`. The integration test in `packages/cli/test` runs the in-process agent against the sample server with a scripted model and must pass without AWS credentials. `npm run test:live` runs the same with the real model.

## Dependencies

A new dependency needs a one-line reason in the commit message. Keep the count low.

## Generated files

Never edit `packages/skill-lambda/generated/*` or `skill-package/interactionModels/custom/*` by hand. Run `npm run generate`. Utterance additions go to `skill-package/overrides/<locale>.utterances.json`.
