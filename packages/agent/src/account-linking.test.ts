import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startHotelsWeatherServer,
  type HotelsWeatherServerHandle,
} from '@alexa-mcp-bridge/hotels-weather-mcp-server';
import {
  SPOKEN,
  createLogger,
  hashId,
  parseConfig,
  type AgentInvocation,
  type TurnInput,
} from '@alexa-mcp-bridge/core';
import { BridgeSession } from './session.js';
import { noopMemory, type MemoryAdapter } from './memory/store.js';
import { runTurn } from './turn.js';
import { ScriptedModel, type ScriptStep } from './testing/scripted-model.js';

/**
 * mcp.auth.type 'alexaAccountLinking' (D48): each invocation carries the user's own token, and
 * every MCP request carries the token of the invocation that is current, without reconnecting.
 * A 401 from the server ends the run with the link prompt. The token never reaches a log line.
 *
 * A recording proxy sits in front of the sample server: it notes the Authorization header of
 * every JSON-RPC request and answers 401 to tokens it treats as revoked.
 */

interface Seen {
  method: string;
  authorization?: string;
  /** The arguments of a tools/call. */
  args?: unknown;
}

let upstream: HotelsWeatherServerHandle;
let proxy: Server;
let proxyUrl: string;
let seen: Seen[] = [];
let refuse: (seen: Seen) => boolean = () => false;

beforeAll(async () => {
  upstream = await startHotelsWeatherServer({ port: 0, log: () => undefined });
  const target = new URL(upstream.url);
  proxy = createServer((req, res) => {
    void readBody(req).then((body) => {
      const method = rpcMethod(body);
      const entry: Seen = {
        method,
        ...(method === 'tools/call' ? { args: rpcArguments(body) } : {}),
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      };
      if (req.method === 'POST') seen.push(entry);
      if (refuse(entry)) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('Unauthorized');
        return;
      }
      const forward = httpRequest(
        {
          host: target.hostname,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: target.host },
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      forward.on('error', () => res.writeHead(502).end());
      forward.end(body);
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  proxyUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/mcp`;
});

afterAll(async () => {
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await upstream.close();
});

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function rpcMethod(body: Buffer): string {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { method?: string; result?: unknown };
    return parsed.method ?? 'response';
  } catch {
    return '';
  }
}

function rpcArguments(body: Buffer): unknown {
  try {
    return (JSON.parse(body.toString('utf8')) as { params?: { arguments?: unknown } }).params
      ?.arguments;
  } catch {
    return undefined;
  }
}

const weather = (city: string): ScriptStep => ({
  toolUse: { name: 'get_weather', input: { city } },
});

/** Memory that remembers an earlier conversation, to show what an unlink forgets. */
const remembering: MemoryAdapter = {
  hydrate: async () => [
    { role: 'user', content: [{ text: 'HYDRATED-OLD question' }] },
    { role: 'assistant', content: [{ text: 'HYDRATED-OLD answer' }] },
  ],
  longTermContext: async () => 'LONGTERM-FACT about the first account',
  record: async () => undefined,
};

function harness(
  steps: ScriptStep[],
  auth: Record<string, unknown> = { type: 'alexaAccountLinking' },
  memory: MemoryAdapter = noopMemory,
  hiddenArguments: string[] = [],
  resultField?: string,
) {
  seen = [];
  refuse = () => false;
  const lines: string[] = [];
  const logger = createLogger({ service: 'test' }, { level: 'debug', write: (l) => lines.push(l) });
  const config = parseConfig({
    mcp: { url: proxyUrl, auth },
    features: { debug: true },
    tools: { hiddenArguments },
    ...(resultField ? { speech: { resultField } } : {}),
  });
  const model = new ScriptedModel(steps);
  const session = new BridgeSession({
    config,
    model,
    memory,
    logger,
    secretResolver: async () => 'static-secret',
  });
  const send = (turn: TurnInput, userToken?: string) =>
    runTurn(session, {
      turn,
      actorId: hashId('u'),
      sessionId: hashId('s'),
      locale: 'en-US',
      budgetMs: 6500,
      debug: true,
      ...(userToken ? { userToken } : {}),
    } satisfies AgentInvocation);
  return { session, send, lines, model };
}

/** What the model saw on its last call: the conversation and the system prompt. */
function lastCall(model: ScriptedModel): string {
  const messages = JSON.stringify(model.calls.at(-1)?.map((m) => m.toJSON()));
  return `${messages} ${model.systemPrompts.at(-1) ?? ''}`;
}

const toolCalls = () => seen.filter((s) => s.method === 'tools/call');

describe('account-linked token', () => {
  it('sends the current invocation’s token on every request, a refreshed one included', async () => {
    const { session, send, lines } = harness([
      weather('Berlin'),
      { text: 'Berlin is cloudy.' },
      weather('Hamburg'),
      { text: 'Hamburg has light rain.' },
    ]);
    await send({ type: 'warmup' }, 'tok-one-7f3a');
    expect(await session.ready({ actorId: 'a', locale: 'en-US' }, 5000)).toBe('ready');
    const first = await send(
      { type: 'turn', utterance: { text: 'weather in Berlin' } },
      'tok-one-7f3a',
    );
    expect(first.speech).toBe('Berlin is cloudy.');
    const second = await send(
      { type: 'turn', utterance: { text: 'weather in Hamburg' } },
      'tok-two-9c1e',
    );
    expect(second.speech).toBe('Hamburg has light rain.');
    expect(second.linkAccount).toBeUndefined();

    expect(toolCalls().map((c) => c.authorization)).toEqual([
      'Bearer tok-one-7f3a',
      'Bearer tok-two-9c1e',
    ]);
    // One MCP session throughout: the refreshed token did not cost a reconnect.
    expect(seen.filter((s) => s.method === 'initialize')).toHaveLength(1);
    for (const line of lines) {
      expect(line).not.toContain('tok-one-7f3a');
      expect(line).not.toContain('tok-two-9c1e');
    }
    await session.close();
  });

  it('ends the run with the link prompt when the server answers 401', async () => {
    const { session, send, lines } = harness([weather('Berlin'), { text: 'never spoken' }]);
    await send({ type: 'warmup' }, 'tok-revoked-55aa');
    await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    refuse = (s) => s.method === 'tools/call';
    const out = await send(
      { type: 'turn', utterance: { text: 'weather in Berlin' } },
      'tok-revoked-55aa',
    );
    expect(out).toMatchObject({
      status: 'done',
      speech: SPOKEN.linkAccount,
      endSession: true,
      linkAccount: true,
    });
    expect(session.state).toBe('ready');
    for (const line of lines) expect(line).not.toContain('tok-revoked-55aa');
    await session.close();
  });

  it('keeps the link prompt when speech.resultField is configured and the server answers 401', async () => {
    const { session, send } = harness(
      [weather('Berlin'), { text: 'never spoken' }],
      { type: 'alexaAccountLinking' },
      noopMemory,
      [],
      'city',
    );
    await send({ type: 'warmup' }, 'tok-field-1b2c');
    await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    refuse = (s) => s.method === 'tools/call';
    const out = await send({ type: 'turn', utterance: { text: 'weather' } }, 'tok-field-1b2c');
    expect(out).toMatchObject({ speech: SPOKEN.linkAccount, linkAccount: true, endSession: true });
    await session.close();
  });

  it('asks to link when the server refuses the token at warm-up', async () => {
    const { session, send } = harness([{ text: 'never spoken' }]);
    refuse = () => true;
    await send({ type: 'warmup' }, 'tok-expired-0b0b');
    const out = await send({ type: 'turn', utterance: { text: 'hi' } }, 'tok-expired-0b0b');
    expect(out).toMatchObject({ speech: SPOKEN.linkAccount, linkAccount: true, endSession: true });
    await session.close();
  });
});

describe('other auth modes are unchanged', () => {
  it('none: no Authorization header, even when an invocation carries a token', async () => {
    const { session, send } = harness([weather('Berlin'), { text: 'Cloudy.' }], { type: 'none' });
    await send({ type: 'turn', utterance: { text: 'weather' } }, 'tok-ignored');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.authorization === undefined)).toBe(true);
    await session.close();
  });

  it('bearer: the static secret, never the invocation’s token; a 401 is not a link prompt', async () => {
    const { session, send } = harness([weather('Berlin'), { text: 'Cloudy.' }], {
      type: 'bearer',
      secretName: 'bridge/token',
    });
    await send({ type: 'turn', utterance: { text: 'weather' } }, 'tok-ignored');
    expect(toolCalls().map((c) => c.authorization)).toEqual(['Bearer static-secret']);
    await session.close();

    const refused = harness([weather('Berlin'), { text: 'The tool failed.' }], {
      type: 'bearer',
      secretName: 'bridge/token',
    });
    await refused.session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    refuse = (s) => s.method === 'tools/call';
    const out = await refused.send({ type: 'turn', utterance: { text: 'weather' } });
    expect(out.linkAccount).toBeUndefined();
    expect(out.speech).toBe('The tool failed.');
    await refused.session.close();
  });
});

describe('a lost link forgets the conversation (D48)', () => {
  const earlier = /HYDRATED-OLD|LONGTERM-FACT|Berlin/;

  it('an invocation without a token drops the history and what was hydrated', async () => {
    const { session, send, model } = harness(
      [weather('Berlin'), { text: 'Berlin is cloudy.' }, { text: 'Fresh start.' }],
      { type: 'alexaAccountLinking' },
      remembering,
    );
    await send({ type: 'warmup' }, 'tok-one-7f3a');
    await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    await send({ type: 'turn', utterance: { text: 'weather in Berlin' } }, 'tok-one-7f3a');
    expect(lastCall(model)).toMatch(/HYDRATED-OLD/);
    expect(lastCall(model)).toMatch(/LONGTERM-FACT/);

    expect(await send({ type: 'cancel' })).toMatchObject({ status: 'done', speech: '' });
    const next = await send({ type: 'turn', utterance: { text: 'hello' } }, 'tok-two-9c1e');
    expect(next.speech).toBe('Fresh start.');
    expect(lastCall(model)).toMatch(/hello/);
    expect(lastCall(model)).not.toMatch(earlier);
    await session.close();
  });

  it('a 401 from the server drops it too', async () => {
    const { session, send, model } = harness(
      [
        weather('Berlin'),
        { text: 'Berlin is cloudy.' },
        weather('Berlin'),
        { text: 'never spoken' },
        { text: 'Fresh start.' },
      ],
      { type: 'alexaAccountLinking' },
      remembering,
    );
    await send({ type: 'warmup' }, 'tok-one-7f3a');
    await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    await send({ type: 'turn', utterance: { text: 'weather in Berlin' } }, 'tok-one-7f3a');
    refuse = (s) => s.method === 'tools/call';
    const refused = await send({ type: 'turn', utterance: { text: 'again' } }, 'tok-one-7f3a');
    expect(refused.linkAccount).toBe(true);
    refuse = () => false;
    await send({ type: 'turn', utterance: { text: 'hello' } }, 'tok-two-9c1e');
    expect(lastCall(model)).toMatch(/hello/);
    expect(lastCall(model)).not.toMatch(earlier);
    await session.close();
  });

  it('a 401 at warm-up means the next warm-up does not hydrate memory', async () => {
    const { session, send, model } = harness(
      [{ text: 'Fresh start.' }],
      { type: 'alexaAccountLinking' },
      remembering,
    );
    refuse = () => true;
    await send({ type: 'warmup' }, 'tok-expired-0b0b');
    const out = await send({ type: 'turn', utterance: { text: 'hi' } }, 'tok-expired-0b0b');
    expect(out.linkAccount).toBe(true);
    refuse = () => false;
    const next = await send({ type: 'turn', utterance: { text: 'hello' } }, 'tok-two-9c1e');
    expect(next.speech).toBe('Fresh start.');
    expect(lastCall(model)).not.toMatch(earlier);
    await session.close();
  });

  it('forgets remembered hidden arguments with the conversation (no id from the last account)', async () => {
    const steps = [
      weather('Berlin'),
      { text: 'Berlin is cloudy.' },
      { toolUse: { name: 'get_weather', input: {} } },
      { text: 'Done.' },
    ];
    const lastArgs = () => toolCalls().at(-1)?.args;

    // Control: with the link intact, the missing city is filled from the earlier result.
    const kept = harness(steps, { type: 'alexaAccountLinking' }, noopMemory, ['city']);
    await kept.send({ type: 'warmup' }, 'tok-one-7f3a');
    await kept.session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    await kept.send({ type: 'turn', utterance: { text: 'weather in Berlin' } }, 'tok-one-7f3a');
    await kept.send({ type: 'turn', utterance: { text: 'again' } }, 'tok-one-7f3a');
    expect(lastArgs()).toEqual({ city: 'Berlin' });
    await kept.session.close();

    // A tokenless invocation forgets the conversation, and the remembered value with it.
    const lost = harness(steps, { type: 'alexaAccountLinking' }, noopMemory, ['city']);
    await lost.send({ type: 'warmup' }, 'tok-one-7f3a');
    await lost.session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    await lost.send({ type: 'turn', utterance: { text: 'weather in Berlin' } }, 'tok-one-7f3a');
    await lost.send({ type: 'cancel' });
    await lost.send({ type: 'turn', utterance: { text: 'again' } }, 'tok-two-9c1e');
    expect(lastArgs()).toEqual({});
    await lost.session.close();
  });

  it('other modes keep the history when an invocation has no token', async () => {
    const { session, send, model } = harness(
      [{ text: 'One.' }, { text: 'Two.' }],
      { type: 'none' },
      remembering,
    );
    await send({ type: 'turn', utterance: { text: 'first' } });
    await send({ type: 'cancel' });
    await send({ type: 'turn', utterance: { text: 'second' } });
    expect(lastCall(model)).toMatch(/HYDRATED-OLD/);
    expect(lastCall(model)).toMatch(/first/);
    await session.close();
  });
});
