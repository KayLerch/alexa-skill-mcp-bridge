import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

/**
 * S2 driver. Runs the sequences from EXECUTION-PLAN.md section 4.1 against the probe runtime.
 * Usage: node drive.ts --sequence 1|2|3|4|5|6|7|8|all [--runtime-arn arn] [--tunnel-url https://…/mcp]
 * The runtime ARN defaults to cdk-outputs.json written by `npx cdk deploy --outputs-file cdk-outputs.json`.
 */
const { values } = parseArgs({
  options: {
    sequence: { type: 'string', default: 'all' },
    'runtime-arn': { type: 'string' },
    'tunnel-url': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log('node drive.ts --sequence 1..8|all [--runtime-arn arn] [--tunnel-url url]');
  process.exit(0);
}

const runtimeArn =
  values['runtime-arn'] ??
  (JSON.parse(readFileSync('cdk-outputs.json', 'utf8')) as Record<string, Record<string, string>>)
    .AlexaMcpBridgeProbe?.RuntimeArn;
if (!runtimeArn) throw new Error('runtime ARN not found; pass --runtime-arn');

const client = new BedrockAgentCoreClient({ region: 'us-east-1' });
const newSessionId = () => randomBytes(32).toString('hex'); // 64-char hex, like core.hashId()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invoke(sessionId: string, body: Record<string, unknown>, timeoutMs = 120_000) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const out = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: sessionId,
        contentType: 'application/json',
        accept: 'application/json',
        payload: Buffer.from(JSON.stringify(body)),
      }),
      { abortSignal: ac.signal },
    );
    const text = await out.response?.transformToString();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { ms: Date.now() - t0, status: out.statusCode, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

const report = (name: string, data: unknown) =>
  console.log(`\n[${name}]\n${JSON.stringify(data, null, 2)}`);

const sequences: Record<string, () => Promise<void>> = {
  // Item 5: cold start, 5 fresh sessions.
  '1': async () => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await invoke(newSessionId(), { cmd: 'boot-info' });
      times.push(r.ms);
      console.log(`cold start #${i + 1}: ${r.ms} ms`, JSON.stringify(r.body));
    }
    report('sequence 1: cold start', { times, p50: [...times].sort((a, b) => a - b)[2] });
  },
  // Item 2: park, wait 20 s, resolve; then again with a 5 min gap.
  '2': async () => {
    const sid = newSessionId();
    await invoke(sid, { cmd: 'boot-info' });
    for (const gapS of [20, 300]) {
      const park = await invoke(sid, { cmd: 'park' });
      console.log(`parked (${gapS}s gap):`, JSON.stringify(park.body));
      await sleep(gapS * 1000);
      const res = await invoke(sid, { cmd: 'resolve', value: `after-${gapS}s` });
      report(`sequence 2: park/resolve with ${gapS}s gap`, res);
    }
  },
  // Item 2: heartbeat gaps after 60 s idle.
  '3': async () => {
    const sid = newSessionId();
    await invoke(sid, { cmd: 'boot-info' });
    await sleep(60_000);
    const hb = await invoke(sid, { cmd: 'heartbeat' });
    report('sequence 3: heartbeat after 60s idle (gaps mean the VM was paused)', hb);
  },
  // Item 2: HealthyBusy semantics.
  '4': async () => {
    const sid = newSessionId();
    await invoke(sid, { cmd: 'busy', state: 'on' });
    await sleep(5000);
    let outcome: unknown;
    try {
      outcome = await invoke(sid, { cmd: 'boot-info' }, 30_000);
    } catch (e) {
      outcome = { error: String(e) };
    }
    report('sequence 4: invoke while /ping says HealthyBusy', outcome);
    await invoke(sid, { cmd: 'busy', state: 'off' }).catch(() => undefined);
  },
  // Item 4: abandon the first invocation at 6.5 s during cold start.
  '5': async () => {
    const sid = newSessionId();
    let aborted: unknown;
    try {
      aborted = await invoke(sid, { cmd: 'boot-info' }, 6500);
    } catch (e) {
      aborted = { error: String(e) };
    }
    console.log('first (abandoned) invocation:', JSON.stringify(aborted));
    await sleep(30_000);
    const second = await invoke(sid, { cmd: 'boot-info' });
    report(
      'sequence 5: boot-info 30s after an abandoned first invocation (startedAt should predate the abort)',
      second,
    );
  },
  // Item 3: session reuse after reclaim. Deploy with PROBE_IDLE_SECONDS=60 first.
  '6': async () => {
    const sid = newSessionId();
    const first = await invoke(sid, { cmd: 'boot-info' });
    console.log('first:', JSON.stringify(first.body));
    await sleep(150_000);
    let second: unknown;
    try {
      second = await invoke(sid, { cmd: 'boot-info' });
    } catch (e) {
      second = { error: String(e) };
    }
    report(
      'sequence 6: same session id after the idle timeout (expect a new pid, no error)',
      second,
    );
  },
  // Item 6: session id format.
  '7': async () => {
    const hex = await invoke(newSessionId(), { cmd: 'boot-info' })
      .then((r) => r.status)
      .catch((e) => String(e));
    const dotted = await invoke('a.b.' + newSessionId().slice(0, 40), { cmd: 'boot-info' })
      .then((r) => r.status)
      .catch((e) => String(e));
    report('sequence 7: session id format', { hex64: hex, withDots: dotted });
  },
  // Items 2 and 7: hold an SSE stream to a tunneled server across 60 s of idle.
  '8': async () => {
    const url = values['tunnel-url'];
    if (!url) throw new Error('--tunnel-url required for sequence 8');
    const sid = newSessionId();
    const opened = await invoke(sid, { cmd: 'hold-stream', url });
    console.log('opened:', JSON.stringify(opened.body));
    await sleep(60_000);
    const status = await invoke(sid, { cmd: 'stream-status' });
    report('sequence 8: held stream status after 60s', status);
  },
};

const wanted = values.sequence === 'all' ? Object.keys(sequences) : [values.sequence!];
for (const s of wanted) {
  const fn = sequences[s];
  if (!fn) throw new Error(`unknown sequence ${s}`);
  await fn();
}
