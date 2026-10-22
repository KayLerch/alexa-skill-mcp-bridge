import type { Response } from 'ask-sdk-model';
import {
  createLogger,
  parseConfig,
  type BridgeConfig,
  type TurnInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { BridgeClient } from '../src/bridge.js';

/** Shared by the voice-flow tests: a config, a bridge that records turns, and response readers. */
const logger = createLogger({}, { write: () => undefined });

export function withConfig(extra: Record<string, unknown>): BridgeConfig {
  return parseConfig({ mcp: { url: 'https://example.com/mcp' }, ...extra });
}

export function fakeBridge(
  config: BridgeConfig,
  reply: (turn: TurnInput) => TurnOutput | Promise<TurnOutput>,
) {
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

export const done = (speech: string, extra: Partial<TurnOutput> = {}): TurnOutput => ({
  status: 'done',
  speech,
  endSession: false,
  visual: null,
  ...extra,
});

export const ssmlOf = (response: Response) => (response.outputSpeech as { ssml: string }).ssml;
export const repromptOf = (response: Response) =>
  (response.reprompt?.outputSpeech as { ssml: string } | undefined)?.ssml;

export const launchConfig = withConfig({
  skill: { launch: { tool: 'suggest_visit', arguments: { season: 'spring' } } },
});
export const LINE = 'Welcome back. Say "plan Zion", or name a park. What would you like?';
