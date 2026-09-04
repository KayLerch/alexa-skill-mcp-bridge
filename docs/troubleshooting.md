# Troubleshooting

## "I'm still starting up" every time I open the skill

The launch hit a cold runtime: provisioning the microVM plus MCP `initialize` took longer than `turn.budgetMs`. The runtime keeps warming up after the Lambda gives up, so the second launch within `runtime.idleTimeoutMinutes` should greet you. If every launch is cold:

- Check the runtime logs (`/aws/bedrock-agentcore/...` in CloudWatch) for `warm-up failed`. The usual cause is an unreachable `mcp.url` from AWS (a tunnel that expired, a server on localhost).
- Run `npm run chat -- --remote` and send a few turns; the second one should be fast.

## "I'm still working on that" loops

A turn runs past the budget on every request. Look at the `run finished` log line for `elapsedMs`. Causes, in order of likelihood: a slow MCP tool, reasoning effort above `off`, a very long tool result (the model reads all of it), or a system prompt bloated by long server `instructions`. Use `npm run chat -- --debug` to see per-call timings.

## The question never gets an answer, or the tool call fails after a minute

Elicitation parks the `tools/call` stream between turns. Anything on the path can cut it:

- **The MCP SDK's default request timeout is 60 seconds** on the server side (`elicitInput`) and on the client side (`callTool`). The bridge's client waits up to 10 minutes; your server must pass a longer `timeout` to `elicitInput` too. The sample server uses 10 minutes.
- **Tunnels and proxies** (cloudflared quick tunnels, ALBs, API Gateway) drop idle streams. The sample server sends an MCP `ping` every 15 seconds while it waits; do the same in yours. If it still drops, use a named cloudflared tunnel or a host with a longer idle timeout.
- **`elicitation.answerTimeoutSeconds`** (default 120) cancels the question on the bridge side; the server sees `action: cancel`.
- **`runtime.idleTimeoutMinutes`**: if the user walks away, the microVM and the parked promise are reclaimed together.

The runtime log says which one happened: `answer timeout`, `mcp transport closed`, or `elicitation aborted`.

## Free-text answers are not understood

Alexa only delivers free text through a carrier phrase. When the bridge asks a `text` question, answer with "the answer is …" or "it's …". Numbers and dates work bare. This is a limit of custom skills, not of the bridge; Alexa+ add-ons receive the transcript directly.

## The generated interaction model fails validation

`npm run generate` enforces Alexa's rules it knows about (one `AMAZON.SearchQuery` slot per intent, carrier phrases, no digits). If the developer console still rejects the model, the usual culprits are an invocation name with punctuation or a single word, or an enum value that is not pronounceable. Fix the tool schema or add an override in `skill-package/overrides/<locale>.utterances.json`.

## "Model access failed" during deploy

Enable Amazon Nova 2 Lite in the Bedrock console for us-east-1 (Model access), then run `npm run check-model-access`. Cross-region inference profiles (`us.` prefix) also need the model enabled in the regions they route to.

## The deploy warns that the Lambda permission is open

Until `skill.id` is set in `bridge.config.ts`, any skill could invoke the Lambda (the ASK SDK still checks the application id when `skill.id` is set). After `ask deploy` prints your skill id, set it and run `npm run deploy` again.

## "runtimeSessionId" errors

The runtime session id must be at least 33 characters and contain no dots. The bridge uses a SHA-256 hex of the Alexa user id (64 characters). If you drive the runtime yourself, hash your ids with `hashId()` from `@alexa-mcp-bridge/core`.

## `npm install` fails with "Cannot read properties of null (reading 'edgesOut')"

An npm 10 resolver bug triggered by some peer-dependency sets. The repo pins versions that install cleanly; if you upgraded a dependency, try `npm install --legacy-peer-deps` to confirm, then pick a version that installs without it.

## The sample server says its port is in use

Another program holds the port. `PORT=3940 npm run sample:start`, then set `mcp.url` in `bridge.config.ts` to `http://localhost:3940/mcp`.
