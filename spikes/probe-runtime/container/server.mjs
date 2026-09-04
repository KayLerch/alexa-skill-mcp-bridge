import { createServer } from 'node:http';

/**
 * Probe container. Commands arrive as JSON on POST /invocations: {"cmd": "...", ...}.
 *   boot-info    process start time, invocation counter, uptime
 *   park         start a fake tool call that awaits a promise; return immediately
 *   resolve      settle the parked promise; return the fake tool result and how long it waited
 *   slow N       return after N seconds
 *   heartbeat    return the buffer a 1 s setInterval has been writing; gaps show a paused VM
 *   busy on|off  flip /ping between Healthy and HealthyBusy
 *   hold-stream  open an SSE connection to --url and report; next call reports whether it is still open
 */
const startedAt = new Date();
let invocations = 0;
let busy = false;
let parked = null; // { promise, resolve, startedAt, result }
const heartbeat = [];
setInterval(() => {
  heartbeat.push(Date.now());
  if (heartbeat.length > 600) heartbeat.shift();
}, 1000);
let held = null; // { url, openedAt, closedAt, error, bytes }

const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const gaps = () => {
  const out = [];
  for (let i = 1; i < heartbeat.length; i++) {
    const d = heartbeat[i] - heartbeat[i - 1];
    if (d > 2500) out.push({ at: new Date(heartbeat[i - 1]).toISOString(), gapMs: d });
  }
  return out;
};

async function handle(body) {
  invocations += 1;
  const cmd = body.cmd;
  switch (cmd) {
    case 'boot-info':
      return {
        startedAt: startedAt.toISOString(),
        invocations,
        uptimeS: process.uptime(),
        pid: process.pid,
      };
    case 'park': {
      if (parked && !parked.result) return { alreadyParked: true, since: parked.startedAt };
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      parked = { promise, resolve, startedAt: new Date().toISOString(), result: null };
      // The fake tool call: awaits the parked promise, then records its result.
      promise.then((value) => {
        parked.result = {
          value,
          waitedMs: Date.now() - Date.parse(parked.startedAt),
          at: new Date().toISOString(),
        };
      });
      return { parked: true, since: parked.startedAt };
    }
    case 'resolve': {
      if (!parked) return { error: 'nothing parked' };
      parked.resolve(body.value ?? 'resolved');
      await parked.promise;
      const result = parked.result;
      parked = null;
      return { resolved: true, result };
    }
    case 'slow': {
      const seconds = Number(body.seconds ?? 10);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { slept: seconds };
    }
    case 'heartbeat':
      return {
        samples: heartbeat.length,
        first: heartbeat[0],
        last: heartbeat.at(-1),
        gaps: gaps(),
      };
    case 'busy':
      busy = body.state === 'on';
      return { busy };
    case 'hold-stream': {
      if (held && !held.closedAt)
        return { held: true, since: held.openedAt, bytes: held.bytes, stillOpen: true };
      const url = body.url;
      held = { url, openedAt: new Date().toISOString(), closedAt: null, error: null, bytes: 0 };
      fetch(url, { headers: { accept: 'text/event-stream' } })
        .then(async (res) => {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            held.bytes += value.length;
          }
          held.closedAt = new Date().toISOString();
        })
        .catch((e) => {
          held.error = String(e);
          held.closedAt = new Date().toISOString();
        });
      return { held: true, since: held.openedAt };
    }
    case 'stream-status':
      return held ?? { held: false };
    default:
      return { error: `unknown cmd ${cmd}` };
  }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: busy ? 'HealthyBusy' : 'Healthy',
        time_of_last_update: Math.floor(Date.now() / 1000),
      }),
    );
    return;
  }
  if (req.method === 'POST' && req.url === '/invocations') {
    try {
      const body = await readBody(req);
      const out = await handle(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...out, invocationAt: new Date().toISOString() }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  res.writeHead(404).end();
}).listen(8080, '0.0.0.0', () => console.log(JSON.stringify({ msg: 'probe up', startedAt })));
