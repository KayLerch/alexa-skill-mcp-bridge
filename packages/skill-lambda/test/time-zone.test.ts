import { describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  parseConfig,
  type AgentInvocationInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { BridgeClient } from '../src/bridge.js';
import { handlerInput } from './helpers.js';

/** The device's time zone (D53): read once per Alexa session, bounded, skipped on failure. */
const done: TurnOutput = { status: 'done', speech: 'Hi.', endSession: false, visual: null };

function setup() {
  const config = parseConfig({
    mcp: { url: 'https://example.com/mcp' },
    skill: { invocationName: 'hotel helper' },
  });
  const lines: string[] = [];
  const logger = createLogger({}, { level: 'debug', write: (l) => lines.push(l) });
  const envelopes: AgentInvocationInput[] = [];
  const invoke = vi.fn(async (e: AgentInvocationInput) => {
    envelopes.push(e);
    return done;
  });
  return {
    bridge: new BridgeClient({ config, runtimeArn: 'arn:test', logger, invoke }),
    envelopes,
    lines,
  };
}

const turn = { type: 'turn', utterance: { text: 'hi' } } as const;

describe('device time zone', () => {
  it('sends the zone in the envelope and reads it once per session', async () => {
    const { bridge, envelopes } = setup();
    const timeZone = vi.fn(async () => 'America/Los_Angeles');
    const sessionAttributes: Record<string, unknown> = {};
    const input = handlerInput({ intent: 'X', timeZone, sessionAttributes });
    await bridge.turn(input, turn);
    await bridge.turn(input, turn);
    expect(timeZone).toHaveBeenCalledTimes(1);
    expect(timeZone).toHaveBeenCalledWith('amzn1.ask.device.D1');
    expect(envelopes.map((e) => e.timeZone)).toEqual([
      'America/Los_Angeles',
      'America/Los_Angeles',
    ]);
  });

  it('uses the zone cached in the session attributes without calling Alexa', async () => {
    const { bridge, envelopes } = setup();
    const timeZone = vi.fn(async () => 'Europe/Berlin');
    await bridge.turn(
      handlerInput({ intent: 'X', timeZone, sessionAttributes: { timeZone: 'Asia/Tokyo' } }),
      turn,
    );
    expect(timeZone).not.toHaveBeenCalled();
    expect(envelopes[0]?.timeZone).toBe('Asia/Tokyo');
  });

  it('sends no zone and no error when the UPS call fails, and logs it without detail', async () => {
    const { bridge, envelopes, lines } = setup();
    const out = await bridge.turn(
      handlerInput({
        intent: 'X',
        timeZone: async () => {
          throw new Error('403 forbidden');
        },
      }),
      turn,
    );
    expect(out.speech).toBe('Hi.');
    expect(envelopes[0]).not.toHaveProperty('timeZone');
    expect(lines.join('\n')).toContain('time zone');
  });

  it('gives up on a slow UPS call after about 300 ms', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, envelopes } = setup();
      const result = bridge.turn(
        handlerInput({ intent: 'X', timeZone: () => new Promise<string>(() => undefined) }),
        turn,
      );
      await vi.advanceTimersByTimeAsync(299);
      expect(envelopes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2);
      await result;
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0]).not.toHaveProperty('timeZone');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks again on the next turn after a timeout, and sends the zone then', async () => {
    vi.useFakeTimers();
    try {
      const { bridge, envelopes } = setup();
      const sessionAttributes: Record<string, unknown> = {};
      let calls = 0;
      const timeZone = vi.fn(() => {
        calls += 1;
        return calls === 1
          ? new Promise<string>(() => undefined)
          : Promise.resolve('America/New_York');
      });
      const input = handlerInput({ intent: 'X', timeZone, sessionAttributes });
      const first = bridge.turn(input, turn);
      await vi.advanceTimersByTimeAsync(301);
      await first;
      expect(envelopes[0]).not.toHaveProperty('timeZone');
      expect(sessionAttributes).not.toHaveProperty('timeZone');
      await bridge.turn(input, turn);
      expect(timeZone).toHaveBeenCalledTimes(2);
      expect(envelopes[1]?.timeZone).toBe('America/New_York');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks again on the next turn after an error', async () => {
    const { bridge, envelopes } = setup();
    const sessionAttributes: Record<string, unknown> = {};
    const timeZone = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('500 internal'))
      .mockResolvedValueOnce('Europe/Berlin');
    const input = handlerInput({ intent: 'X', timeZone, sessionAttributes });
    await bridge.turn(input, turn);
    await bridge.turn(input, turn);
    expect(timeZone).toHaveBeenCalledTimes(2);
    expect(envelopes.map((e) => e.timeZone)).toEqual([undefined, 'Europe/Berlin']);
  });

  it('caches "no zone" for the session when UPS answered without a usable one', async () => {
    const { bridge, envelopes } = setup();
    const sessionAttributes: Record<string, unknown> = {};
    const timeZone = vi.fn(async () => 'Mars/Olympus');
    const input = handlerInput({ intent: 'X', timeZone, sessionAttributes });
    await bridge.turn(input, turn);
    await bridge.turn(input, turn);
    expect(timeZone).toHaveBeenCalledTimes(1);
    expect(envelopes.every((e) => e.timeZone === undefined)).toBe(true);
  });

  it('drops a zone Intl rejects', async () => {
    const { bridge, envelopes } = setup();
    await bridge.turn(handlerInput({ intent: 'X', timeZone: async () => 'Mars/Olympus' }), turn);
    expect(envelopes[0]).not.toHaveProperty('timeZone');
  });

  it('sends none when the request has no UPS client', async () => {
    const { bridge, envelopes } = setup();
    await bridge.turn(handlerInput({ intent: 'X' }), turn);
    expect(envelopes[0]).not.toHaveProperty('timeZone');
  });
});
