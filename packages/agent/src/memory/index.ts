import type { BridgeConfig, Logger } from '@alexa-mcp-bridge/core';
import { noopMemory, type MemoryAdapter } from './store.js';

/**
 * Picks the memory adapter for this process. The AgentCore Memory adapter (Phase 6) plugs in
 * here when MEMORY_ID is set; without it, or with memory.shortTerm off, memory is a no-op.
 */
export function createMemoryAdapter(
  config: BridgeConfig,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): MemoryAdapter {
  if (!config.memory.shortTerm || !env.MEMORY_ID) {
    logger.info('memory disabled', {
      reason: env.MEMORY_ID ? 'memory.shortTerm is false' : 'MEMORY_ID unset',
    });
    return noopMemory;
  }
  logger.warn(
    'MEMORY_ID is set but the AgentCore Memory adapter is not implemented yet; memory is a no-op',
  );
  return noopMemory;
}
