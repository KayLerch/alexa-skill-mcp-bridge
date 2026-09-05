import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startHotelsWeatherServer,
  type HotelsWeatherServerHandle,
} from '@alexa-mcp-bridge/hotels-weather-mcp-server';
import {
  createLogger,
  hashId,
  parseConfig,
  type AgentInvocation,
  type TurnInput,
} from '@alexa-mcp-bridge/core';
import { BridgeSession } from './session.js';
import { noopMemory } from './memory/store.js';
import { runTurn } from './turn.js';
import { ScriptedModel, type ScriptStep } from './testing/scripted-model.js';

/**
 * The turn state machine (plan 6.2) end to end against the sample server:
 * question, pending and poll, cancel, stale answer, new request while a question is pending (D7).
 */
const logger = createLogger({ service: 'test' }, { write: () => undefined });
let server: HotelsWeatherServerHandle;
const serverEvents: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = await startHotelsWeatherServer({ port: 0, log: (event) => serverEvents.push(event) });
});
afterAll(async () => {
  await server.close();
});

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const hotelSearch: ScriptStep = {
  toolUse: {
    name: 'search_hotels',
    input: { destination: 'Berlin', checkIn: '2026-10-05', checkOut: '2026-10-07' },
  },
};

function harness(steps: ScriptStep[], overrides: Record<string, unknown> = {}) {
  const config = parseConfig({ mcp: { url: server.url }, ...overrides });
  const model = new ScriptedModel(steps);
  const session = new BridgeSession({ config, model, memory: noopMemory, logger });
  const send = (turn: TurnInput, budgetMs = 6500) =>
    runTurn(session, {
      turn,
      actorId: hashId('u'),
      sessionId: hashId('s'),
      locale: 'en-US',
      budgetMs,
      debug: false,
    } satisfies AgentInvocation);
  return { session, model, send };
}

describe('warmup', () => {
  it('answers immediately and leaves the session warming, then ready', async () => {
    const { session, send } = harness([]);
    const out = await send({ type: 'warmup' });
    expect(out).toEqual({ status: 'done', speech: '', endSession: false, visual: null });
    expect(['warming', 'ready']).toContain(session.state);
    expect(await session.ready({ actorId: 'a', locale: 'en-US' }, 5000)).toBe('ready');
    expect(session.state).toBe('ready');
    expect(session.serverName).toBe('hotels-and-weather');
    await session.close();
  });

  it('fails cleanly when the MCP server is unreachable', async () => {
    const { session, send } = harness([], { mcp: { url: 'http://127.0.0.1:9/mcp' } });
    const out = await send({ type: 'turn', utterance: { text: 'hi' } });
    expect(out.status).toBe('error');
    expect(out.speech).not.toMatch(/ECONNREFUSED|Error/);
    await session.close();
  });
});

describe('question and answer', () => {
  it('parks the elicitation, then continues the same run with the answer', async () => {
    const { session, send } = harness([hotelSearch, { text: 'Three hotels found. Want more?' }]);
    const first = await send({
      type: 'turn',
      utterance: { intent: 'SearchHotelsIntent', tool: 'search_hotels', text: 'hotels in Berlin' },
    });
    expect(first.status).toBe('question');
    expect(session.state).toBe('awaiting-answer');
    expect(session.ping()).toBe('Healthy');

    const second = await send({
      type: 'answer',
      questionId: first.question?.id as string,
      answer: { slots: { n: { value: '2', slotType: 'AMAZON.NUMBER' } } },
    });
    expect(second.status).toBe('done');
    expect(second.speech).toBe('Three hotels found. Want more?');
    expect(second.endSession).toBe(false);
    expect(session.state).toBe('ready');
    await session.close();
  });

  it('re-asks when the answer is not usable', async () => {
    const { session, send } = harness([hotelSearch, { text: 'done' }]);
    const first = await send({ type: 'turn', utterance: { text: 'hotels in Berlin' } });
    const bad = await send({
      type: 'answer',
      questionId: first.question?.id as string,
      answer: { text: 'nine' },
    });
    expect(bad.status).toBe('question');
    expect(bad.question?.id).toBe(first.question?.id);
    expect(bad.speech).toMatch(/still need an answer/);
    await send({ type: 'cancel' });
    await session.close();
  });

  it('"no" to a non yes/no question declines the elicitation and the tool ends cleanly', async () => {
    const { session, send } = harness([hotelSearch, { text: 'Okay, no search then. What else?' }]);
    const first = await send({ type: 'turn', utterance: { text: 'hotels in Berlin' } });
    serverEvents.length = 0;
    const out = await send({
      type: 'answer',
      questionId: first.question?.id as string,
      answer: { yesNo: false },
    });
    expect(out.status).toBe('done');
    expect(serverEvents).toContainEqual(expect.objectContaining({ action: 'decline' }));
    await session.close();
  });

  it('treats a stale answer as a new request instead of dropping it', async () => {
    const { session, send, model } = harness([{ text: 'Sure, Hamburg it is.' }]);
    const out = await send({
      type: 'answer',
      questionId: 'nope',
      answer: { text: 'weather in Hamburg' },
    });
    expect(out.status).toBe('done');
    expect(out.speech).toBe('Sure, Hamburg it is.');
    expect(JSON.stringify(model.calls[0]?.at(-1)?.toJSON())).toContain('weather in Hamburg');
    await session.close();
  });
});

describe('cancel and topic change', () => {
  it('cancel while a question is pending resolves the elicitation with cancel', async () => {
    const { session, send } = harness([hotelSearch, { text: 'unused' }]);
    await send({ type: 'turn', utterance: { text: 'hotels in Berlin' } });
    serverEvents.length = 0;
    const out = await send({ type: 'cancel' });
    expect(out).toMatchObject({ status: 'done', speech: '' });
    expect(session.state).toBe('ready');
    expect(session.queue.current()).toBeUndefined();
    // The server learns about it a moment later, either from the cancel answer or from the
    // cancelled tool call, never from a timeout.
    await waitFor(() =>
      serverEvents.some((e) => e.action === 'cancel' || e.msg === 'elicitation aborted'),
    );
    expect(serverEvents).not.toContainEqual(
      expect.objectContaining({ msg: 'elicitation timed out' }),
    );
    await session.close();
  });

  it('a new request while a question is pending cancels it and answers the new request (D7)', async () => {
    const { session, send } = harness([
      hotelSearch,
      { text: 'discarded' },
      { text: 'Hamburg has light rain.' },
    ]);
    const first = await send({ type: 'turn', utterance: { text: 'hotels in Berlin' } });
    expect(first.status).toBe('question');
    const second = await send({
      type: 'turn',
      utterance: { text: 'what is the weather in Hamburg' },
    });
    expect(second.status).toBe('done');
    expect(second.speech).toBe('Hamburg has light rain.');
    await session.close();
  });
});

describe('overrun and poll', () => {
  it('returns pending at the deadline, keeps working, and poll fetches the result', async () => {
    // The scripted model is instant; make the tool slow instead through the sample server's option.
    const slow = await startHotelsWeatherServer({ port: 0, slowSeconds: 2, log: () => undefined });
    try {
      const { session: slowSession, send: slowSend } = harness(
        [
          { toolUse: { name: 'get_weather', input: { city: 'Berlin' } } },
          { text: 'Berlin is partly cloudy.' },
        ],
        { mcp: { url: slow.url }, skill: { stillWorkingMessage: 'Still working.' } },
      );
      await slowSession.ready({ actorId: 'a', locale: 'en-US' }, 5000);
      const first = await slowSend(
        { type: 'turn', utterance: { text: 'weather in Berlin' } },
        1200,
      );
      expect(first).toMatchObject({ status: 'pending', speech: 'Still working.' });
      expect(slowSession.state).toBe('overrun');
      expect(slowSession.ping()).toBe('HealthyBusy');

      const early = await slowSend({ type: 'turn', utterance: { text: 'anything' } }, 1000);
      expect(early.status).toBe('pending');

      const polled = await slowSend({ type: 'poll' }, 6500);
      expect(polled).toMatchObject({ status: 'done', speech: 'Berlin is partly cloudy.' });
      expect(slowSession.state).toBe('ready');
      expect(await slowSend({ type: 'poll' })).toMatchObject({ status: 'done', speech: '' });
      await slowSession.close();
    } finally {
      await slow.close();
    }
  }, 30_000);

  it('cancel during an overrun aborts the run', async () => {
    const slow = await startHotelsWeatherServer({ port: 0, slowSeconds: 3, log: () => undefined });
    try {
      const { session, send } = harness(
        [{ toolUse: { name: 'get_weather', input: { city: 'Berlin' } } }, { text: 'never spoken' }],
        { mcp: { url: slow.url } },
      );
      await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
      const first = await send({ type: 'turn', utterance: { text: 'weather' } }, 1000);
      expect(first.status).toBe('pending');
      const out = await send({ type: 'cancel' });
      expect(out.status).toBe('done');
      expect(session.currentRun).toBeUndefined();
      expect(session.state).toBe('ready');
      expect(await send({ type: 'poll' })).toMatchObject({ status: 'done', speech: '' });
      await session.close();
    } finally {
      await slow.close();
    }
  }, 30_000);
});
