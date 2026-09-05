# Hotels and weather MCP server

The second example. Two tools over fixed data for sixty-six cities, three hotels each: twenty-four in the
United States, eighteen European metropoles, and twenty-four across Canada, Latin America, Asia,
the Middle East, Africa and Oceania. It exists alongside the national parks example
because its `search_hotels` tool always elicits when guests are missing, which is the simplest way
to watch a question get parked, and because its `destination` argument is free text, so it exercises
the `AMAZON.SearchQuery` path that the parks example does not.

Hotel names are fictional; prices, ratings and weather are illustrative. Nothing here describes a
real business or a forecast. Prices are in the local currency where travellers expect it (US,
Europe, Canada, Japan, Singapore, Hong Kong, the Emirates, Australia, New Zealand) and in US
dollars elsewhere. City names are matched without regard to accents, so "Sao Paulo" finds São Paulo.

Tools:

- `search_hotels(destination, checkIn, checkOut, guests?)` — up to three matches sorted by rating,
  with `structuredContent` plus text. Elicits `guests` (form mode) on the open `tools/call` stream
  when it is missing.
- `get_weather(city)` — typical conditions and high and low in Celsius.

## Run

```bash
EXAMPLE=hotels-weather npm run sample:start           # this server, on http://localhost:3939/mcp
PORT=4000 EXAMPLE=hotels-weather npm run sample:start # any free port; set BRIDGE_MCP_URL in .env to match
MCP_BEARER_TOKEN=secret EXAMPLE=hotels-weather npm run sample:start   # requires "Authorization: Bearer secret"
SAMPLE_SLOW_SECONDS=8 EXAMPLE=hotels-weather npm run sample:start     # get_weather takes 8 s; exercises the overrun path
SAMPLE_LOG=json EXAMPLE=hotels-weather npm run sample:start           # raw event records instead of readable lines
```

Try, in `npm run chat`: "find hotels in Lisbon from the fifth to the seventh of October" (it asks how
many guests; answer "two"), then "what is the weather in Seattle".

## Expose it to AWS for device tests

The deployed agent runs in AWS and needs to reach your server. The quickest way is a cloudflared quick tunnel:

```bash
brew install cloudflared      # or see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
cloudflared tunnel --url http://localhost:3939
```

Put the printed `https://….trycloudflare.com/mcp` URL into `.env` as `BRIDGE_MCP_URL`, then `npm run generate` and `npm run deploy`.

## Stateful mode and timeouts

The server runs in stateful mode (one session id per client). Stateless mode cannot route an elicitation reply back to the pending tool call.

While a tool call waits for an elicitation answer, the server sends an MCP `ping` every 15 seconds so tunnels and proxies do not cut the idle stream, waits up to 10 minutes for the answer, and sends the question with `relatedRequestId` so it travels on the tool call's own stream. The MCP SDK's default request timeout is 60 seconds; the bridge relies on the longer timeout here.
