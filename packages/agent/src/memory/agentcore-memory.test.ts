import { describe, expect, it, vi } from 'vitest';
import type { BedrockAgentCoreClient, Event } from '@aws-sdk/client-bedrock-agentcore';
import { createLogger } from '@alexa-mcp-bridge/core';
import { createAgentCoreMemory, toMessages } from './agentcore-memory.js';

const logger = createLogger({}, { write: () => undefined });
const at = (s: number) => new Date(2026, 8, 3, 12, 0, s);
const event = (sessionId: string, seconds: number, user: string, assistant: string): Event => ({
  memoryId: 'm',
  actorId: 'a',
  sessionId,
  eventId: `${sessionId}-${seconds}`,
  eventTimestamp: at(seconds),
  payload: [
    { conversational: { role: 'USER', content: { text: user } } },
    { conversational: { role: 'ASSISTANT', content: { text: assistant } } },
  ],
});

type Command = { constructor: { name: string }; input: Record<string, unknown> };

function fakeClient(
  responses: Record<string, unknown | ((input: Record<string, unknown>) => unknown)>,
) {
  const send = vi.fn(async (command: Command) => {
    const reply = responses[command.constructor.name];
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(command.input) : (reply ?? {});
  });
  return { send } as unknown as BedrockAgentCoreClient & { send: typeof send };
}

describe('record', () => {
  it('writes one event with the user and assistant messages', async () => {
    const client = fakeClient({ CreateEventCommand: {} });
    const memory = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 20,
      longTerm: true,
      logger,
      client,
      now: () => at(1),
    });
    await memory.record('actor', 'session', 'hi', 'hello');
    const input = client.send.mock.calls[0]?.[0].input;
    expect(input).toEqual({
      memoryId: 'm',
      actorId: 'actor',
      sessionId: 'session',
      eventTimestamp: at(1),
      payload: [
        { conversational: { role: 'USER', content: { text: 'hi' } } },
        { conversational: { role: 'ASSISTANT', content: { text: 'hello' } } },
      ],
    });
  });

  it('never throws into the turn path', async () => {
    const client = fakeClient({ CreateEventCommand: new Error('down') });
    const memory = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 20,
      longTerm: true,
      logger,
      client,
    });
    await expect(memory.record('a', 's', 'u', 'x')).resolves.toBeUndefined();
  });
});

describe('hydrate', () => {
  it('reads the most recent sessions oldest first and keeps the last N exchanges', async () => {
    const client = fakeClient({
      ListSessionsCommand: {
        sessionSummaries: [
          { sessionId: 's2', actorId: 'a', createdAt: at(10) },
          { sessionId: 's1', actorId: 'a', createdAt: at(0) },
        ],
      },
      ListEventsCommand: (input: Record<string, unknown>) =>
        input.sessionId === 's1'
          ? { events: [event('s1', 2, 'u2', 'a2'), event('s1', 1, 'u1', 'a1')] }
          : { events: [event('s2', 3, 'u3', 'a3')] },
    });
    const memory = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 2,
      longTerm: false,
      logger,
      client,
    });
    const messages = await memory.hydrate('a');
    expect(messages).toEqual([
      { role: 'user', content: [{ text: 'u2' }] },
      { role: 'assistant', content: [{ text: 'a2' }] },
      { role: 'user', content: [{ text: 'u3' }] },
      { role: 'assistant', content: [{ text: 'a3' }] },
    ]);
    const sessionIds = client.send.mock.calls
      .filter((c) => c[0].constructor.name === 'ListEventsCommand')
      .map((c) => c[0].input.sessionId);
    expect(sessionIds).toEqual(['s1', 's2']);
  });

  it('returns nothing when disabled or failing', async () => {
    const off = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 0,
      longTerm: false,
      logger,
      client: fakeClient({}),
    });
    expect(await off.hydrate('a')).toEqual([]);
    const broken = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 5,
      longTerm: false,
      logger,
      client: fakeClient({ ListSessionsCommand: new Error('nope') }),
    });
    expect(await broken.hydrate('a')).toEqual([]);
  });
});

describe('toMessages', () => {
  it('drops a leading assistant turn, merges repeated roles, and ends on an assistant turn', () => {
    const messages = toMessages([
      {
        ...event('s', 1, 'u1', 'a1'),
        payload: [{ conversational: { role: 'ASSISTANT', content: { text: 'stray' } } }],
      },
      {
        ...event('s', 2, 'u2', 'a2'),
        payload: [
          { conversational: { role: 'USER', content: { text: 'first' } } },
          { conversational: { role: 'USER', content: { text: 'second' } } },
          { conversational: { role: 'ASSISTANT', content: { text: 'reply' } } },
        ],
      },
      {
        ...event('s', 3, 'u3', 'a3'),
        payload: [{ conversational: { role: 'USER', content: { text: 'dangling' } } }],
      },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: [{ text: 'first\nsecond' }] },
      { role: 'assistant', content: [{ text: 'reply' }] },
    ]);
  });
});

describe('longTermContext', () => {
  it('formats retrieved facts for the system prompt', async () => {
    const client = fakeClient({
      RetrieveMemoryRecordsCommand: {
        memoryRecordSummaries: [
          { content: { text: 'Prefers hotels near the station.' } },
          { content: { text: '' } },
        ],
      },
    });
    const memory = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 5,
      longTerm: true,
      logger,
      client,
    });
    expect(await memory.longTermContext('actor')).toBe(
      '\n## Known about this user\n\n- Prefers hotels near the station.\n',
    );
    expect(client.send.mock.calls[0]?.[0].input.namespace).toBe('/users/actor/preferences');
  });

  it('is empty when long-term memory is off', async () => {
    const memory = createAgentCoreMemory({
      memoryId: 'm',
      region: 'us-east-1',
      hydrateLastEvents: 5,
      longTerm: false,
      logger,
      client: fakeClient({}),
    });
    expect(await memory.longTermContext('a')).toBe('');
  });
});
