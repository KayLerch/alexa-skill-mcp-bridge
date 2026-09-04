import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
  ListSessionsCommand,
  RetrieveMemoryRecordsCommand,
  type Event,
} from '@aws-sdk/client-bedrock-agentcore';
import type { MessageData } from '@strands-agents/sdk';
import { errorFields, type Logger } from '@alexa-mcp-bridge/core';
import type { MemoryAdapter } from './store.js';

/**
 * AgentCore Memory adapter. Short-term: one event per completed exchange under
 * (actorId, sessionId); on a cold start the last N exchanges of the actor's most recent
 * sessions become the agent's history. Long-term: user preferences extracted by the memory
 * service, read once at warm-up into the system prompt. Nothing here may break a turn.
 */

export interface AgentCoreMemoryOptions {
  memoryId: string;
  region: string;
  /** Exchanges (user plus assistant message) to rehydrate. */
  hydrateLastEvents: number;
  longTerm: boolean;
  logger: Logger;
  client?: BedrockAgentCoreClient;
  now?: () => Date;
}

/** Namespaces match the strategies the CDK stack creates (infra/lib/alexa-mcp-bridge-stack.ts). */
export const PREFERENCE_NAMESPACE = (actorId: string) => `/users/${actorId}/preferences`;
export const SUMMARY_NAMESPACE = (actorId: string, sessionId: string) =>
  `/users/${actorId}/sessions/${sessionId}`;

const RECENT_SESSIONS = 3;
const EVENT_PAGE = 100;

export function createAgentCoreMemory(options: AgentCoreMemoryOptions): MemoryAdapter {
  const { memoryId, logger } = options;
  const client = options.client ?? new BedrockAgentCoreClient({ region: options.region });
  const now = options.now ?? (() => new Date());

  return {
    async record(actorId, sessionId, userText, assistantText) {
      try {
        await client.send(
          new CreateEventCommand({
            memoryId,
            actorId,
            sessionId,
            eventTimestamp: now(),
            payload: [
              { conversational: { role: 'USER', content: { text: userText } } },
              { conversational: { role: 'ASSISTANT', content: { text: assistantText } } },
            ],
          }),
        );
      } catch (err) {
        logger.warn('memory: record failed', errorFields(err));
      }
    },

    async hydrate(actorId) {
      if (options.hydrateLastEvents <= 0) return [];
      try {
        const sessions = await recentSessions(client, memoryId, actorId);
        const events: Event[] = [];
        for (const sessionId of sessions) {
          const page = await client.send(
            new ListEventsCommand({
              memoryId,
              actorId,
              sessionId,
              includePayloads: true,
              maxResults: EVENT_PAGE,
            }),
          );
          events.push(...(page.events ?? []));
        }
        const messages = toMessages(events).slice(-2 * options.hydrateLastEvents);
        logger.info('memory: hydrated', { sessions: sessions.length, messages: messages.length });
        return messages;
      } catch (err) {
        logger.warn('memory: hydration failed', errorFields(err));
        return [];
      }
    },

    async longTermContext(actorId) {
      if (!options.longTerm) return '';
      try {
        const out = await client.send(
          new RetrieveMemoryRecordsCommand({
            memoryId,
            namespace: PREFERENCE_NAMESPACE(actorId),
            searchCriteria: {
              searchQuery: 'preferences, habits, and past requests of this user',
              topK: 5,
            },
          }),
        );
        const facts = (out.memoryRecordSummaries ?? [])
          .map((r) => r.content?.text?.trim())
          .filter((t): t is string => Boolean(t));
        if (facts.length === 0) return '';
        return `\n## Known about this user\n\n${facts.map((f) => `- ${f}`).join('\n')}\n`;
      } catch (err) {
        logger.warn('memory: long-term retrieval failed', errorFields(err));
        return '';
      }
    },
  };
}

async function recentSessions(
  client: BedrockAgentCoreClient,
  memoryId: string,
  actorId: string,
): Promise<string[]> {
  const out = await client.send(new ListSessionsCommand({ memoryId, actorId, maxResults: 20 }));
  return (out.sessionSummaries ?? [])
    .filter((s) => s.sessionId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .slice(-RECENT_SESSIONS)
    .map((s) => s.sessionId as string);
}

/**
 * Events → alternating user/assistant messages, oldest first. Bedrock rejects a history that
 * does not start with a user turn or repeats a role, so stray messages are dropped or merged.
 */
export function toMessages(events: Event[]): MessageData[] {
  const ordered = [...events].sort(
    (a, b) => (a.eventTimestamp?.getTime() ?? 0) - (b.eventTimestamp?.getTime() ?? 0),
  );
  const out: MessageData[] = [];
  for (const event of ordered) {
    for (const item of event.payload ?? []) {
      const text = item.conversational?.content?.text?.trim();
      const role =
        item.conversational?.role === 'USER'
          ? 'user'
          : item.conversational?.role === 'ASSISTANT'
            ? 'assistant'
            : undefined;
      if (!text || !role) continue;
      const last = out[out.length - 1];
      if (!last && role === 'assistant') continue;
      if (last && last.role === role) {
        last.content = [{ text: `${(last.content[0] as { text: string }).text}\n${text}` }];
      } else {
        out.push({ role, content: [{ text }] });
      }
    }
  }
  if (out[out.length - 1]?.role === 'user') out.pop();
  return out;
}
