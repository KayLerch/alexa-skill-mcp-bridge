import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSampleServer, type SampleServerHandle } from '@alexa-mcp-bridge/sample-mcp-server';
import { ScriptedModel, createModel } from '@alexa-mcp-bridge/agent';
import { createLogger, hashId, parseConfig } from '@alexa-mcp-bridge/core';
import { createLocalBridge } from '../src/bridge.js';

/**
 * The in-process harness against the sample server, including one elicitation round trip.
 * Runs with a scripted model (no AWS). BRIDGE_TEST_LIVE=1 runs the same with the real model.
 */
const live = process.env.BRIDGE_TEST_LIVE === '1';
const logger = createLogger(
  { service: 'test' },
  { level: 'debug', write: live ? (line) => process.stderr.write(line + '\n') : () => undefined },
);

let server: SampleServerHandle;
beforeAll(async () => {
  server = await startSampleServer({ port: 0, log: () => undefined });
});
afterAll(async () => {
  await server.close();
});

const identity = {
  actorId: hashId('test-user'),
  sessionId: hashId('test-session'),
  locale: 'en-US',
};

describe('hotel search with the guests elicitation', () => {
  it('asks for guests, accepts the spoken answer, and speaks the result', async () => {
    const config = parseConfig({ mcp: { url: server.url }, features: { debug: true } });
    const model = live
      ? createModel(config)
      : new ScriptedModel([
          {
            toolUse: {
              name: 'search_hotels',
              input: { destination: 'Berlin', checkIn: '2026-10-05', checkOut: '2026-10-07' },
            },
          },
          {
            text: 'I found three hotels in Berlin. The top rated is Hotel Adlon at three hundred twenty euros a night. Want to hear more?',
          },
        ]);
    const bridge = createLocalBridge({
      config,
      identity,
      logger,
      budgetMs: live ? 20_000 : 6500,
      debug: true,
      model,
    });
    try {
      expect((await bridge.turn({ type: 'warmup' })).status).toBe('done');

      const first = await bridge.turn({
        type: 'turn',
        utterance: { text: 'find hotels in Berlin from the fifth to the seventh of October' },
      });
      expect(first.status).toBe('question');
      expect(first.question).toMatchObject({ source: 'elicitation', expects: 'number' });
      expect(first.speech).toBe('How many guests will be staying?');
      expect(first.endSession).toBe(false);
      expect(first.reprompt).toBe(first.speech);

      const second = await bridge.turn({
        type: 'answer',
        questionId: first.question?.id as string,
        answer: { text: 'two' },
      });
      expect(second.status).toBe('done');
      expect(second.speech.toLowerCase()).toContain('adlon');
      expect(second.visual).toBeNull();
      expect(second.debug?.toolCalls).toEqual([
        expect.objectContaining({ name: 'search_hotels', status: 'success' }),
      ]);
      if (model instanceof ScriptedModel) {
        // The tool result the model saw carried the structured content with the elicited value.
        const toolResultTurn = model.calls.at(-1)?.at(-1);
        const json = JSON.stringify(toolResultTurn?.toJSON());
        expect(json).toContain('"guests":2');
        expect(json).toContain('Hotel Adlon');
      }
    } finally {
      await bridge.close();
    }
  }, 60_000);
});

describe('weather turn without elicitation', () => {
  it('calls the tool and answers in one turn', async () => {
    const config = parseConfig({ mcp: { url: server.url } });
    const model = live
      ? createModel(config)
      : new ScriptedModel([
          { toolUse: { name: 'get_weather', input: { city: 'Hamburg' } } },
          { text: 'Hamburg has light rain today with a high of eighteen degrees.' },
        ]);
    const bridge = createLocalBridge({
      config,
      identity,
      logger,
      budgetMs: live ? 20_000 : 6500,
      debug: false,
      model,
    });
    try {
      const out = await bridge.turn({
        type: 'turn',
        utterance: { text: 'what is the weather in Hamburg' },
      });
      expect(out.status).toBe('done');
      expect(out.speech.toLowerCase()).toContain('hamburg');
      expect(out.debug).toBeUndefined();
      expect(out.endSession).toBe(true);
    } finally {
      await bridge.close();
    }
  }, 60_000);
});
