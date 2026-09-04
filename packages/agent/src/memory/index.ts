import type { BridgeConfig, Logger } from '@alexa-mcp-bridge/core';
import { createAgentCoreMemory } from './agentcore-memory.js';
import { noopMemory, type MemoryAdapter } from './store.js';

/**
 * Picks the memory adapter for this process: AgentCore Memory when the stack passed a
 * MEMORY_ID and memory.shortTerm is on, otherwise a no-op (local chat, tests).
 */
export function createMemoryAdapter(
  config: BridgeConfig,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): MemoryAdapter {
  const memoryId = env.MEMORY_ID;
  if (!config.memory.shortTerm || !memoryId) {
    logger.info('memory disabled', {
      reason: memoryId ? 'memory.shortTerm is false' : 'MEMORY_ID unset',
    });
    return noopMemory;
  }
  return createAgentCoreMemory({
    memoryId,
    region: config.aws.region,
    hydrateLastEvents: config.memory.hydrateLastEvents,
    longTerm: config.memory.longTerm,
    logger,
  });
}
