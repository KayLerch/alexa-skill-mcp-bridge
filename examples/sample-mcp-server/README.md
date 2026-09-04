# Sample MCP server

A small Streamable HTTP MCP server (protocol 2025-11-25) to develop and test the bridge without your own server.

Tools:

- `search_hotels(destination, checkIn, checkOut, guests?)`: fixed dataset of 8 hotels in Berlin, Munich, and Hamburg. When `guests` is missing the tool **elicits** it (form mode) on the open `tools/call` stream and returns `structuredContent` plus text.
- `get_weather(city)`: fixed table for a handful of cities.

## Run

```bash
npm run sample:start          # http://localhost:3000/mcp
PORT=4000 npm run sample:start
MCP_BEARER_TOKEN=secret npm run sample:start   # requires "Authorization: Bearer secret"
SAMPLE_SLOW_SECONDS=8 npm run sample:start     # get_weather takes 8 s; exercises the bridge's overrun path
```

## Expose it to AWS for device tests

The deployed agent runs in AWS and needs to reach your server. The quickest way is a cloudflared quick tunnel:

```bash
brew install cloudflared      # or see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
cloudflared tunnel --url http://localhost:3000
```

Put the printed `https://….trycloudflare.com/mcp` URL into `bridge.config.ts` as `mcp.url`, then `npm run generate` and `npm run deploy`.

## Stateful mode and timeouts

The server runs in stateful mode (one session id per client). Stateless mode cannot route an elicitation reply back to the pending tool call.

While a tool call waits for an elicitation answer, the server sends an MCP `ping` every 15 seconds so tunnels and proxies do not cut the idle stream, and it waits up to 10 minutes for the answer. The MCP SDK's default request timeout is 60 seconds; the bridge's turn path relies on the longer timeout here. If your own server uses the default, a spoken answer that takes longer than a minute will arrive after the elicitation has already failed.
