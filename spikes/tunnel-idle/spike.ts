import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { startInlineServer } from '../strands-elicitation/inline-server.ts';

/**
 * S3: elicitation through a cloudflared quick tunnel with a long gap before the answer.
 *
 * 1. Start the inline server locally on --port (default 3100).
 * 2. In another terminal: cloudflared tunnel --url http://localhost:3100
 * 3. node spike.ts --url https://<random>.trycloudflare.com/mcp --gaps 30,90 [--no-ping]
 *
 * Reports, per gap, whether the tool result came back after the parked answer or whether
 * the stream was cut by the tunnel. --no-ping disables the server's 15 s keepalive ping.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    port: { type: 'string', default: '3100' },
    gaps: { type: 'string', default: '30,90' },
    'no-ping': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !values.url) {
  console.log('node spike.ts --url https://…/mcp [--port 3100] [--gaps 30,90] [--no-ping]');
  process.exit(values.help ? 0 : 1);
}

const server = await startInlineServer({
  port: Number(values.port),
  pingIntervalMs: values['no-ping'] ? 0 : 15_000,
});
console.log(`local server on ${server.url}; using tunnel ${values.url}`);

const results: Record<string, unknown> = {};
for (const gapS of values.gaps!.split(',').map(Number)) {
  const transport = new StreamableHTTPClientTransport(new URL(values.url!));
  const client = new Client(
    { name: 'spike-tunnel', version: '0.0.1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  let settle!: (r: ElicitResult) => void;
  const answer = new Promise<ElicitResult>((r) => (settle = r));
  client.setRequestHandler(ElicitRequestSchema, async () => {
    console.log(`[client] elicitation received; answering in ${gapS}s`);
    setTimeout(
      () => settle({ action: 'accept', content: { answer: `after ${gapS}s` } }),
      gapS * 1000,
    );
    return answer;
  });
  await client.connect(transport);
  const t0 = Date.now();
  let outcome: unknown;
  try {
    outcome = await client.callTool(
      { name: 'needs_input', arguments: { topic: 'tunnel' } },
      undefined,
      { timeout: 10 * 60 * 1000 },
    );
  } catch (e) {
    outcome = { error: String(e) };
  }
  results[`gap ${gapS}s`] = { elapsedMs: Date.now() - t0, ping: !values['no-ping'], outcome };
  console.log(JSON.stringify(results[`gap ${gapS}s`], null, 2));
  await client.close();
}
await server.close();
console.log('\n=== SUMMARY ===\n' + JSON.stringify(results, null, 2));
process.exit(0);
