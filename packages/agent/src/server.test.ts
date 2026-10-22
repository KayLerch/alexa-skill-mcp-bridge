import { afterEach, describe, expect, it } from 'vitest';
import {
  USER_TOKEN_HEADER,
  createLogger,
  hashId,
  parseConfig,
  type AgentInvocationInput,
} from '@alexa-mcp-bridge/core';
import { createAgentServer, type AgentServer } from './server.js';
import { noopMemory } from './memory/store.js';
import { ScriptedModel } from './testing/scripted-model.js';

/**
 * The account-linked token reaches the agent in its own header, never in the payload the
 * runtime's request logs record (D63): the server takes it from the header and ignores a payload
 * field of the same name.
 */
const TOKEN = 'Atza|header-token-0123456789';
let server: AgentServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function start() {
  const lines: string[] = [];
  server = createAgentServer({
    config: parseConfig({
      mcp: { url: 'http://127.0.0.1:9/mcp', auth: { type: 'alexaAccountLinking' } },
    }),
    model: new ScriptedModel([]),
    memory: noopMemory,
    logger: createLogger({ service: 'test' }, { level: 'debug', write: (l) => lines.push(l) }),
    port: 0,
    host: '127.0.0.1',
  });
  const { port } = await server.start();
  return { session: server.session, lines, url: `http://127.0.0.1:${port}/invocations` };
}

const envelope = (extra: Partial<AgentInvocationInput> = {}): AgentInvocationInput => ({
  turn: { type: 'warmup' },
  actorId: hashId('u'),
  sessionId: hashId('s'),
  locale: 'en-US',
  budgetMs: 6500,
  ...extra,
});

describe('the agent server and the token header (D63)', () => {
  it('takes the token from its header', async () => {
    const { session, lines, url } = await start();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [USER_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(envelope()),
    });
    expect(response.status).toBe(200);
    expect(session.token.get()).toBe(TOKEN);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });

  it('ignores a token in the payload', async () => {
    const { session, url } = await start();
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope({ userToken: TOKEN })),
    });
    expect(session.token.get()).toBeUndefined();
  });
});
