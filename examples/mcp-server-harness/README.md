# MCP server harness

Shared plumbing for the example MCP servers, so each example is only its data and its tools.

`startMcpServer()` runs a stateful Streamable HTTP server on `/mcp`: one session per client, an
optional bearer token, and a readable console log of every JSON-RPC message in both directions
(`createConsoleLog`, or `jsonLog` for raw records). Stateful mode is not optional — an elicitation
reply has to be routed back to the pending `tools/call`, which stateless mode cannot do.

This is not part of the bridge. It exists so that adding an example server is a directory with a
`src/tools.ts`, a `src/app.ts` naming the server, and a `src/server.ts` bin entry.
