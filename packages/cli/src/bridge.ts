import type { Model } from '@strands-agents/sdk';
import {
  BridgeSession,
  createModel,
  noopMemory,
  runTurn,
  type MemoryAdapter,
} from '@alexa-mcp-bridge/agent';
import type { BridgeConfig, Logger, TurnInput, TurnOutput } from '@alexa-mcp-bridge/core';

/**
 * A Bridge is anything that takes a TurnInput and returns a TurnOutput. The in-process one
 * runs the real agent code without a container; the remote one calls the deployed runtime.
 * The web frontend would sit on the same interface.
 */
export interface Bridge {
  turn(input: TurnInput): Promise<TurnOutput>;
  close(): Promise<void>;
  /** Waits for warm-up (in-process only). Resolves with the failure reason, or undefined when ready. */
  waitReady?(timeoutMs: number): Promise<string | undefined>;
}

export interface BridgeIdentity {
  actorId: string;
  sessionId: string;
  locale: string;
}

export interface LocalBridgeOptions {
  config: BridgeConfig;
  identity: BridgeIdentity;
  logger: Logger;
  budgetMs: number;
  debug: boolean;
  model?: Model;
  memory?: MemoryAdapter;
}

export function createLocalBridge(options: LocalBridgeOptions): Bridge {
  const session = new BridgeSession({
    config: options.config,
    model: options.model ?? createModel(options.config),
    memory: options.memory ?? noopMemory,
    logger: options.logger,
  });
  return {
    turn: (turn) =>
      runTurn(session, {
        turn,
        actorId: options.identity.actorId,
        sessionId: options.identity.sessionId,
        locale: options.identity.locale,
        budgetMs: options.budgetMs,
        debug: options.debug,
      }),
    close: () => session.close(),
    waitReady: async (timeoutMs) => {
      const state = await session.ready(
        { actorId: options.identity.actorId, locale: options.identity.locale },
        timeoutMs,
      );
      if (state === 'ready') return undefined;
      if (state === 'warming')
        return `still connecting to ${options.config.mcp.url} after ${timeoutMs} ms`;
      return session.warmupError?.message ?? 'warm-up failed';
    },
  };
}
