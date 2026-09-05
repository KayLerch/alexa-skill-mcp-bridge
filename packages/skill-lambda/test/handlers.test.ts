import { describe, expect, it, vi } from 'vitest';
import { createLogger, type TurnInput, type TurnOutput } from '@alexa-mcp-bridge/core';
import { BridgeClient } from '../src/bridge.js';
import { answerHandler, answerHintFor, yesNoTurnHandler } from '../src/handlers/answers.js';
import { launchHandler } from '../src/handlers/launch.js';
import { fallbackHandler, stopHandler } from '../src/handlers/standard.js';
import { toolIntentHandler } from '../src/handlers/tool-intent.js';
import { slotValuesFor, toolForIntent } from '../src/manifest.js';
import { greeting, helpText } from '../src/greeting.js';
import { config, handlerInput, manifest, slot } from './helpers.js';

const logger = createLogger({}, { write: () => undefined });

function fakeBridge(reply: (turn: TurnInput) => TurnOutput | Promise<TurnOutput>) {
  const turns: TurnInput[] = [];
  const bridge = new BridgeClient({
    config,
    runtimeArn: 'arn:test',
    logger,
    invoke: async (envelope) => {
      turns.push(envelope.turn);
      return reply(envelope.turn);
    },
  });
  return { bridge, turns };
}

const done = (speech: string, endSession = false): TurnOutput => ({
  status: 'done',
  speech,
  endSession,
  visual: null,
});

/** Like the SDK client: never resolves, rejects when the abort signal fires. */
const neverAnswers = (
  _envelope: unknown,
  _sessionId: string,
  signal: AbortSignal,
): Promise<TurnOutput> =>
  new Promise((_resolve, reject) =>
    signal.addEventListener('abort', () => reject(new Error('aborted'))),
  );
const pendingQuestion = {
  pendingQuestion: {
    id: 'q1',
    expects: 'number',
    source: 'elicitation',
    message: 'How many guests?',
  },
};

describe('answer intents', () => {
  it('fire only while a question is pending', () => {
    const { bridge } = fakeBridge(() => done('x'));
    const handler = answerHandler(bridge);
    expect(
      handler.canHandle(
        handlerInput({ intent: 'NumberAnswerIntent', sessionAttributes: pendingQuestion }),
      ),
    ).toBe(true);
    expect(handler.canHandle(handlerInput({ intent: 'NumberAnswerIntent' }))).toBe(false);
    expect(
      handler.canHandle(
        handlerInput({ intent: 'AMAZON.YesIntent', sessionAttributes: pendingQuestion }),
      ),
    ).toBe(true);
    expect(
      handler.canHandle(
        handlerInput({ intent: 'SearchHotelsIntent', sessionAttributes: pendingQuestion }),
      ),
    ).toBe(false);
  });

  it('send the answer with the pending question id', async () => {
    const { bridge, turns } = fakeBridge(() => done('Found three hotels.'));
    const input = handlerInput({
      intent: 'NumberAnswerIntent',
      slots: { number: slot('number', '2') },
      sessionAttributes: pendingQuestion,
    });
    await answerHandler(bridge).handle(input);
    expect(turns[0]).toEqual({
      type: 'answer',
      questionId: 'q1',
      answer: { slots: { number: { value: '2', slotType: 'AMAZON.NUMBER' } } },
    });
  });

  it('map each answer intent onto an AnswerHint', () => {
    expect(answerHintFor(handlerInput({ intent: 'AMAZON.YesIntent' }), 'AMAZON.YesIntent')).toEqual(
      { yesNo: true },
    );
    expect(answerHintFor(handlerInput({ intent: 'AMAZON.NoIntent' }), 'AMAZON.NoIntent')).toEqual({
      yesNo: false,
    });
    expect(
      answerHintFor(
        handlerInput({ intent: 'DateAnswerIntent', slots: { date: slot('date', '2026-10-05') } }),
        'DateAnswerIntent',
      ),
    ).toEqual({ slots: { date: { value: '2026-10-05', slotType: 'AMAZON.DATE' } } });
    expect(
      answerHintFor(
        handlerInput({
          intent: 'FreeTextAnswerIntent',
          slots: { answer: slot('answer', 'the suite') },
        }),
        'FreeTextAnswerIntent',
      ),
    ).toEqual({ text: 'the suite' });
  });

  it('yes and no without a pending question become turns', async () => {
    const { bridge, turns } = fakeBridge(() => done('Okay.'));
    const handler = yesNoTurnHandler(bridge);
    const input = handlerInput({ intent: 'AMAZON.NoIntent' });
    expect(handler.canHandle(input)).toBe(true);
    expect(
      handler.canHandle(
        handlerInput({ intent: 'AMAZON.NoIntent', sessionAttributes: pendingQuestion }),
      ),
    ).toBe(false);
    await handler.handle(input);
    expect(turns[0]).toEqual({
      type: 'turn',
      utterance: { intent: 'AMAZON.NoIntent', text: 'no' },
    });
  });
});

describe('tool intents', () => {
  it('resolve intent → tool and slots → arguments with entity resolution', async () => {
    const { bridge, turns } = fakeBridge(() => done('Searching.'));
    const input = handlerInput({
      intent: 'SearchHotelsIntent',
      slots: {
        destination: slot('destination', 'berlin'),
        checkIn: slot('checkIn', '2026-10-05'),
        roomType: slot('roomType', 'sweet', { name: 'suite', id: 'ste' }),
      },
    });
    const handler = toolIntentHandler(bridge, manifest);
    expect(handler.canHandle(input)).toBe(true);
    expect(handler.canHandle(handlerInput({ intent: 'GetWeatherIntent' }))).toBe(false);
    await handler.handle(input);
    expect(turns[0]).toEqual({
      type: 'turn',
      utterance: {
        intent: 'SearchHotelsIntent',
        tool: 'search_hotels',
        slots: {
          checkIn: { value: '2026-10-05', slotType: 'AMAZON.DATE' },
          roomType: {
            value: 'sweet',
            resolvedValue: 'suite',
            resolvedId: 'ste',
            slotType: 'SearchHotelsRoomTypeType',
          },
          destination: { value: 'berlin', slotType: 'AMAZON.SearchQuery' },
        },
      },
    });
  });

  it('manifest lookup helpers', () => {
    expect(toolForIntent(manifest, 'SearchHotelsIntent')?.name).toBe('search_hotels');
    expect(toolForIntent(manifest, 'Nope')).toBeUndefined();
    const tool = manifest.tools[0];
    expect(slotValuesFor(tool as never, handlerInput({ intent: 'SearchHotelsIntent' }))).toEqual(
      {},
    );
  });
});

describe('launch', () => {
  it('greets on a warm runtime and speaks the cold-start line on a timeout', async () => {
    const warm = fakeBridge(() => done(''));
    const response = await launchHandler(warm.bridge, config, manifest).handle(handlerInput());
    expect(response.outputSpeech).toMatchObject({
      ssml: expect.stringContaining('Welcome to hotels and weather'),
    });
    expect(response.shouldEndSession).toBe(false);
    const coldConfig = { ...config, turn: { budgetMs: 300 } };
    const coldResponse = await launchHandler(
      new BridgeClient({
        config: coldConfig,
        runtimeArn: 'arn',
        logger,
        invoke: neverAnswers,
      }),
      coldConfig,
      manifest,
    ).handle(handlerInput());
    expect(coldResponse.outputSpeech).toMatchObject({
      ssml: expect.stringContaining("I'm still starting up"),
    });
    expect(coldResponse.shouldEndSession).toBe(true);
  });
});

describe('stop and fallback', () => {
  it('stop cancels and says goodbye', async () => {
    const { bridge, turns } = fakeBridge(() => done(''));
    const response = await stopHandler(bridge).handle(
      handlerInput({ intent: 'AMAZON.StopIntent', sessionAttributes: pendingQuestion }),
    );
    expect(turns[0]).toEqual({ type: 'cancel' });
    expect(response.outputSpeech).toMatchObject({ ssml: '<speak>Goodbye.</speak>' });
    expect(response.shouldEndSession).toBe(true);
  });

  it('fallback repeats a pending question without calling the agent', async () => {
    const invoke = vi.fn();
    const { bridge, turns } = fakeBridge(() => done(''));
    const input = handlerInput({
      intent: 'AMAZON.FallbackIntent',
      sessionAttributes: pendingQuestion,
    });
    const response = await fallbackHandler(bridge).handle(input);
    expect(turns).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    expect(response.outputSpeech).toMatchObject({
      ssml: expect.stringContaining('How many guests?'),
    });
    expect(input.attributesManager.getSessionAttributes()).toMatchObject(pendingQuestion);
  });
});

describe('poll-first (D16)', () => {
  it('speaks an outstanding result ahead of the new turn and shortens the budget', async () => {
    const budgets: number[] = [];
    const bridge = new BridgeClient({
      config,
      runtimeArn: 'arn',
      logger,
      invoke: async (envelope) => {
        budgets.push(envelope.budgetMs);
        if (envelope.turn.type === 'poll') {
          await new Promise((r) => setTimeout(r, 50));
          return done('Berlin is cloudy.');
        }
        return done('Hamburg has rain.');
      },
    });
    const input = handlerInput({
      intent: 'GetWeatherIntent',
      sessionAttributes: { awaitingResult: true },
    });
    const output = await bridge.turn(input, {
      type: 'turn',
      utterance: { text: 'weather in Hamburg' },
    });
    expect(output.speech).toBe('Berlin is cloudy. Hamburg has rain.');
    expect(budgets[0]).toBe(config.turn.budgetMs);
    expect(budgets[1]).toBeLessThan(config.turn.budgetMs);
  });

  it('returns pending when the poll is still pending', async () => {
    const bridge = new BridgeClient({
      config,
      runtimeArn: 'arn',
      logger,
      invoke: async () => ({
        status: 'pending',
        speech: 'Still working.',
        endSession: false,
        visual: null,
      }),
    });
    const input = handlerInput({
      intent: 'GetWeatherIntent',
      sessionAttributes: { awaitingResult: true },
    });
    expect((await bridge.turn(input, { type: 'turn', utterance: { text: 'x' } })).status).toBe(
      'pending',
    );
  });

  it('turns an aborted call into pending and a failure into a spoken apology', async () => {
    const slow = new BridgeClient({
      config: { ...config, turn: { budgetMs: 100 } },
      runtimeArn: 'arn',
      logger,
      invoke: neverAnswers,
    });
    expect(
      (await slow.turn(handlerInput(), { type: 'turn', utterance: { text: 'x' } })).status,
    ).toBe('pending');
    const broken = new BridgeClient({
      config,
      runtimeArn: 'arn',
      logger,
      invoke: async () => {
        throw new Error('boom');
      },
    });
    const out = await broken.turn(handlerInput(), { type: 'turn', utterance: { text: 'x' } });
    expect(out.status).toBe('error');
    expect(out.speech).not.toContain('boom');
  });
});

describe('greeting', () => {
  it('derives from the manifest unless configured', () => {
    expect(greeting(config, manifest)).toBe(
      'Welcome to hotels and weather. For example, say "search hotels in Berlin" or "get weather for Hamburg". What would you like to do?',
    );
    expect(
      greeting({ ...config, skill: { ...config.skill, greeting: 'Hi there.' } }, manifest),
    ).toBe('Hi there.');
    expect(helpText(config, manifest)).toContain('search hotels');
  });
});
