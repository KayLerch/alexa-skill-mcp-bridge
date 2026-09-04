import { parseArgs } from 'node:util';
import { McpClient } from '@strands-agents/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { startInlineServer } from './inline-server.ts';

/**
 * S1: Strands elicitation callback settled later from "another invocation" (a timer here).
 *
 * Scenarios (default runs all):
 *   strands       Strands McpClient + elicitationCallback returning a deferred promise, settled after --delay.
 *   raw           Raw MCP Client + setRequestHandler(ElicitRequestSchema), same deferred pattern.
 *   long-strands  Strands callTool with --long-delay to expose the client-side 60 s request timeout.
 *   long-raw      Raw client.callTool with an explicit timeout, same --long-delay, expected to succeed.
 */

const { values } = parseArgs({
  options: {
    delay: { type: 'string', default: '20' },
    'long-delay': { type: 'string', default: '65' },
    scenario: { type: 'string', default: 'all' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'node spike.ts [--delay 20] [--long-delay 65] [--scenario strands|raw|long-strands|long-raw|all]',
  );
  process.exit(0);
}
const delayMs = Number(values.delay) * 1000;
const longDelayMs = Number(values['long-delay']) * 1000;

interface Deferred {
  promise: Promise<ElicitResult>;
  resolve: (r: ElicitResult) => void;
}
const deferred = (): Deferred => {
  let resolve!: (r: ElicitResult) => void;
  const promise = new Promise<ElicitResult>((r) => (resolve = r));
  return { promise, resolve };
};

const results: Record<string, unknown> = {};

async function strandsScenario(name: string, wait: number) {
  const server = await startInlineServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const pending = deferred();
  let callbackAt = 0;
  let params: unknown;
  const client = new McpClient({
    transport,
    elicitationCallback: async (_ctx, p) => {
      callbackAt = Date.now();
      params = p;
      console.log('[client] elicitation callback fired, parking the promise');
      return pending.promise;
    },
  });
  await client.connect();
  const negotiated = transport.protocolVersion;
  const tools = await client.listTools();
  const tool = tools.find((t) => t.name === 'needs_input')!;
  const t0 = Date.now();
  const call = client.callTool(tool, { topic: 'spike' });
  const settleTimer = setTimeout(() => {
    console.log(`[client] settling after ${wait / 1000}s`);
    pending.resolve({ action: 'accept', content: { answer: 'forty-two' } });
  }, wait);
  let outcome: unknown;
  try {
    outcome = await call;
  } catch (err) {
    outcome = { error: String(err) };
  }
  const elapsed = Date.now() - t0;
  results[name] = {
    negotiatedProtocolVersion: negotiated,
    serverSawElicitationCapability: server.events.find((e) => e.event === 'initialize')?.detail,
    callbackReceivedParams: params,
    callbackFiredAfterMs: callbackAt ? callbackAt - t0 : null,
    toolCallElapsedMs: elapsed,
    outcome,
    serverEvents: server.events.map((e) => e.event),
  };
  console.log(`[${name}] ${JSON.stringify(results[name], null, 2)}`);
  clearTimeout(settleTimer);
  pending.resolve({ action: 'cancel' });
  await client.disconnect();
  await server.close();
}

async function rawScenario(name: string, wait: number, timeoutMs?: number) {
  const server = await startInlineServer();
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  const client = new Client(
    { name: 'spike-raw', version: '0.0.1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  const pending = deferred();
  let callbackAt = 0;
  client.setRequestHandler(ElicitRequestSchema, async () => {
    callbackAt = Date.now();
    console.log('[client] raw request handler fired, parking the promise');
    return pending.promise;
  });
  await client.connect(transport);
  const negotiated = transport.protocolVersion;
  const t0 = Date.now();
  const call = client.callTool(
    { name: 'needs_input', arguments: { topic: 'spike' } },
    undefined,
    timeoutMs ? { timeout: timeoutMs } : undefined,
  );
  setTimeout(() => {
    console.log(`[client] settling after ${wait / 1000}s`);
    pending.resolve({ action: 'accept', content: { answer: 'forty-two' } });
  }, wait);
  let outcome: unknown;
  try {
    outcome = await call;
  } catch (err) {
    outcome = { error: String(err) };
  }
  results[name] = {
    negotiatedProtocolVersion: negotiated,
    callbackFiredAfterMs: callbackAt ? callbackAt - t0 : null,
    toolCallElapsedMs: Date.now() - t0,
    callToolTimeoutMs: timeoutMs ?? 'default (60000)',
    outcome,
    serverEvents: server.events.map((e) => e.event),
  };
  console.log(`[${name}] ${JSON.stringify(results[name], null, 2)}`);
  clearTimeout(settleTimer);
  pending.resolve({ action: 'cancel' });
  await client.close();
  await server.close();
}

const scenario = values.scenario;
if (scenario === 'all' || scenario === 'strands') await strandsScenario('strands', delayMs);
if (scenario === 'all' || scenario === 'raw') await rawScenario('raw', delayMs);
if (scenario === 'all' || scenario === 'long-strands')
  await strandsScenario('long-strands', longDelayMs);
if (scenario === 'all' || scenario === 'long-raw')
  await rawScenario('long-raw', longDelayMs, 10 * 60 * 1000);

console.log('\n=== SUMMARY ===');
for (const [k, v] of Object.entries(results)) {
  const r = v as {
    outcome: unknown;
    toolCallElapsedMs: number;
    negotiatedProtocolVersion?: string;
  };
  const ok = typeof r.outcome === 'object' && r.outcome !== null && !('error' in r.outcome);
  console.log(
    `${k}: ${ok ? 'OK' : 'FAILED'} in ${r.toolCallElapsedMs} ms, protocol ${r.negotiatedProtocolVersion}`,
  );
}
process.exit(0);
