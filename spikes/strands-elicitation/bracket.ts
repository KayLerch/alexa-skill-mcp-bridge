import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { startInlineServer } from './inline-server.ts';

/** Bracket the ~60 s threshold seen in S1 long-raw: raw client, explicit timeouts, HTTP logging. */
const delays = (process.argv[2] ?? '55,62').split(',').map(Number);
for (const delayS of delays) {
  const server = await startInlineServer({ elicitTimeoutMs: 150_000 });
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const client = new Client(
    { name: 'bracket', version: '0' },
    { capabilities: { elicitation: { form: {} } } },
  );
  let settle!: (r: ElicitResult) => void;
  const answer = new Promise<ElicitResult>((r) => (settle = r));
  client.setRequestHandler(ElicitRequestSchema, async (_req, extra) => {
    console.log(`[client] elicitation received at +${Date.now() - t0}ms; settling in ${delayS}s`);
    extra.signal.addEventListener('abort', () =>
      console.log(
        `[client] elicitation request ABORTED at +${Date.now() - t0}ms reason=${String(extra.signal.reason)}`,
      ),
    );
    setTimeout(
      () => settle({ action: 'accept', content: { answer: `after ${delayS}s` } }),
      delayS * 1000,
    );
    return answer;
  });
  await client.connect(transport);
  const t0 = Date.now();
  try {
    const r = await client.callTool({ name: 'needs_input', arguments: { topic: 'b' } }, undefined, {
      timeout: 150_000,
    });
    console.log(`delay ${delayS}s: OK in ${Date.now() - t0}ms ${JSON.stringify(r.content)}`);
  } catch (e) {
    console.log(`delay ${delayS}s: FAILED in ${Date.now() - t0}ms ${String(e)}`);
  }
  await client.close();
  await server.close();
}
process.exit(0);
