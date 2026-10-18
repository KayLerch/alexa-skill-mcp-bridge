import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPOKEN,
  createLogger,
  parseConfig,
  type AgentInvocationInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { BridgeClient } from '../src/bridge.js';
import { handlerInput } from './helpers.js';

/** Progressive Response (D52): "One moment." after turn.progressiveAfterMs, once per request. */
const done: TurnOutput = { status: 'done', speech: 'Hi.', endSession: false, visual: null };

function setup(delayMs: number, overrides: { progressiveAfterMs?: number } = {}) {
  const config = parseConfig({
    mcp: { url: 'https://example.com/mcp' },
    skill: { invocationName: 'hotel helper' },
    turn: overrides,
  });
  const lines: string[] = [];
  const logger = createLogger({}, { level: 'debug', write: (l) => lines.push(l) });
  const invoke = vi.fn(
    (_e: AgentInvocationInput) =>
      new Promise<TurnOutput>((resolve) => setTimeout(() => resolve(done), delayMs)),
  );
  const bridge = new BridgeClient({ config, runtimeArn: 'arn:test', logger, invoke });
  return { bridge, lines };
}

describe('progressive response', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('enqueues one "One moment." at 1.5 s when the agent answers at 2 s', async () => {
    const { bridge } = setup(2000);
    const enqueue = vi.fn(async () => undefined);
    const result = bridge.turn(handlerInput({ intent: 'X', enqueue }), { type: 'turn', utterance: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(1499);
    expect(enqueue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      header: { requestId: 'r1' },
      directive: { type: 'VoicePlayer.Speak', speech: SPOKEN.oneMoment },
    });
    await vi.advanceTimersByTimeAsync(600);
    expect((await result).speech).toBe('Hi.');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the agent answers at 1 s', async () => {
    const { bridge } = setup(1000);
    const enqueue = vi.fn(async () => undefined);
    const result = bridge.turn(handlerInput({ intent: 'X', enqueue }), { type: 'turn', utterance: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('is off at 0', async () => {
    const { bridge } = setup(3000, { progressiveAfterMs: 0 });
    const enqueue = vi.fn(async () => undefined);
    const result = bridge.turn(handlerInput({ intent: 'X', enqueue }), { type: 'turn', utterance: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('still answers when the directive service throws or never returns', async () => {
    for (const enqueue of [
      vi.fn(async () => {
        throw new Error('boom');
      }),
      vi.fn(() => new Promise<void>(() => undefined)),
    ]) {
      const { bridge, lines } = setup(2000);
      const result = bridge.turn(handlerInput({ intent: 'X', enqueue }), { type: 'turn', utterance: { text: 'hi' } });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await result).speech).toBe('Hi.');
      expect(enqueue).toHaveBeenCalledTimes(1);
      if (lines.length) expect(lines.join('\n')).not.toContain('Atza');
    }
  });

  it('does nothing without a directive service (no API client)', async () => {
    const { bridge } = setup(2000);
    const result = bridge.turn(handlerInput({ intent: 'X' }), { type: 'turn', utterance: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).speech).toBe('Hi.');
  });

  it('skips the no-token cancel path and cancel turns', async () => {
    const linking = parseConfig({
      mcp: { url: 'https://example.com/mcp', auth: { type: 'alexaAccountLinking' } },
      skill: { invocationName: 'hotel helper' },
    });
    const invoke = vi.fn(
      () => new Promise<TurnOutput>((r) => setTimeout(() => r(done), 3000)),
    );
    const logger = createLogger({}, { level: 'debug', write: () => undefined });
    const bridge = new BridgeClient({ config: linking, runtimeArn: 'arn:test', logger, invoke });
    const enqueue = vi.fn(async () => undefined);
    const result = bridge.turn(handlerInput({ intent: 'X', enqueue }), { type: 'turn', utterance: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(enqueue).not.toHaveBeenCalled();
  });
});
