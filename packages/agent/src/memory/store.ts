import type { MessageData } from '@strands-agents/sdk';

/**
 * Conversation memory boundary. The AgentCore Memory adapter lands in Phase 6;
 * until then the no-op adapter keeps the turn path identical.
 */
export interface MemoryAdapter {
  /** Past turns for this actor, oldest first, ready for the agent's message history. */
  hydrate(actorId: string): Promise<MessageData[]>;
  /** Long-term facts about the user for the system prompt. Empty string when none. */
  longTermContext(actorId: string): Promise<string>;
  /** Store one completed exchange. Must never throw into the turn path. */
  record(
    actorId: string,
    sessionId: string,
    userText: string,
    assistantText: string,
  ): Promise<void>;
}

export const noopMemory: MemoryAdapter = {
  hydrate: async () => [],
  longTermContext: async () => '',
  record: async () => undefined,
};
