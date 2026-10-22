import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  agentInvocationSchema,
  createLogger,
  hashId,
  parseConfig,
  type AgentInvocationInput,
  type TurnInput,
  type Visual,
} from '@alexa-mcp-bridge/core';
import { BridgeSession } from './session.js';
import { noopMemory } from './memory/store.js';
import { runTurn } from './turn.js';
import { ScriptedModel, type ScriptStep } from './testing/scripted-model.js';
import type { RenderJob, ScreenRenderer } from './visual/index.js';

/**
 * Direct tool calls (D57) and the end-session field (D58): the frontend names a tool, the agent
 * calls it without the model, speaks its result field and shows its widget; the result's flag,
 * not a trailing question mark, decides whether the session ends.
 */

const URI = 'ui://parks/start-0123456789ab.html';
const SUGGEST =
  'Welcome back. Glacier is open in June. Say "plan a visit to Glacier", or name a park. What would you like?';

let http: Server;
let url = '';
const calls: { name: string; args: unknown }[] = [];

beforeAll(async () => {
  http = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const body = await readJson(req);
      const server = new McpServer({ name: 'parks-start', version: '1.0.0' });
      server.registerTool(
        'suggest_visit',
        { description: 'Suggest a park to visit.', _meta: { ui: { resourceUri: URI } } },
        async (args) => {
          calls.push({ name: 'suggest_visit', args });
          return {
            content: [{ type: 'text', text: 'suggestion' }],
            structuredContent: { say: SUGGEST, end_session: false, trip_id: 't-1' },
          };
        },
      );
      server.registerTool(
        'suggest_with_args',
        { description: 'Suggest with fixed arguments.', inputSchema: { season: z.string() } },
        async ({ season }) => {
          calls.push({ name: 'suggest_with_args', args: { season } });
          return {
            content: [{ type: 'text', text: season }],
            structuredContent: { say: `In ${season}, try Zion. Want to plan it?` },
          };
        },
      );
      server.registerTool('close_trip', { description: 'Nothing left.' }, async () => ({
        content: [{ type: 'text', text: 'closed' }],
        structuredContent: { say: 'No parks saved yet. Goodbye for now.', end_session: true },
      }));
      server.registerTool('no_line', { description: 'No say field.' }, async () => ({
        content: [{ type: 'text', text: 'plain' }],
        structuredContent: { count: 3 },
      }));
      server.registerTool('broken', { description: 'Always fails.' }, async () => ({
        content: [{ type: 'text', text: 'failure' }],
        isError: true,
      }));
      server.registerTool(
        'plan_trip',
        { description: 'Plan a trip.', inputSchema: { park: z.string() } },
        async ({ park }) => ({
          content: [{ type: 'text', text: park }],
          structuredContent: { say: `Planned ${park}.`, end_session: false },
        }),
      );
      server.registerTool('end_trip', { description: 'End.' }, async () => ({
        content: [{ type: 'text', text: 'end' }],
        structuredContent: { say: 'Trip saved.', end_session: true },
      }));
      server.registerResource(
        'start-widget',
        URI,
        { mimeType: 'text/html;profile=mcp-app' },
        async () => ({
          contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: '<p>start</p>' }],
        }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/mcp`;
});
afterAll(async () => {
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

const IMAGE: Visual = {
  kind: 'image',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  width: 1280,
  height: 800,
};

class FakeScreen implements ScreenRenderer {
  readonly jobs: RenderJob[] = [];
  async warm(): Promise<void> {}
  async render(job: RenderJob): Promise<Visual | undefined> {
    this.jobs.push(job);
    return IMAGE;
  }
  async close(): Promise<void> {}
}

function harness(steps: ScriptStep[] = [], overrides: Record<string, unknown> = {}) {
  const config = parseConfig({
    mcp: { url },
    speech: { resultField: 'say', endSessionField: 'end_session' },
    visual: { enabled: true },
    ...overrides,
  });
  const model = new ScriptedModel(steps);
  const screen = new FakeScreen();
  const session = new BridgeSession({
    config,
    model,
    memory: noopMemory,
    logger: createLogger({ service: 'test' }, { write: () => undefined }),
    renderer: screen,
  });
  const send = (turn: TurnInput, extra: Partial<AgentInvocationInput> = {}) =>
    runTurn(
      session,
      agentInvocationSchema.parse({
        turn,
        actorId: hashId('u'),
        sessionId: hashId('s'),
        locale: 'en-US',
        budgetMs: 6500,
        ...extra,
      } satisfies AgentInvocationInput),
    );
  return { session, model, screen, send };
}

const launch: TurnInput = { type: 'tool', tool: 'suggest_visit', intent: 'LaunchRequest' };

describe('direct tool calls (D57)', () => {
  it('calls the tool without the model, speaks its field, shows its widget, stays open', async () => {
    const { session, model, screen, send } = harness();
    const out = await send(launch, { display: { width: 1280, height: 800, theme: 'dark' } });
    expect(out).toMatchObject({
      status: 'done',
      speech: SUGGEST,
      reprompt: 'What would you like?',
      endSession: false,
      visual: IMAGE,
    });
    expect(model.calls).toHaveLength(0);
    expect(screen.jobs[0]?.toolResult.structuredContent).toMatchObject({ trip_id: 't-1' });
    await session.close();
  });

  it('passes the configured arguments', async () => {
    const { session, send } = harness();
    const out = await send({
      type: 'tool',
      tool: 'suggest_with_args',
      arguments: { season: 'spring' },
    });
    expect(out.speech).toBe('In spring, try Zion. Want to plan it?');
    expect(calls.at(-1)).toEqual({ name: 'suggest_with_args', args: { season: 'spring' } });
    await session.close();
  });

  it('ends the session when the result says so', async () => {
    const { session, send } = harness();
    const out = await send({ type: 'tool', tool: 'close_trip' });
    expect(out).toMatchObject({ speech: 'No parks saved yet. Goodbye for now.', endSession: true });
    expect(out.reprompt).toBeUndefined();
    await session.close();
  });

  it('answers with empty speech when there is nothing to say, so the frontend uses its own line', async () => {
    const { session, send } = harness();
    for (const tool of ['no_line', 'broken', 'not_a_tool']) {
      const out = await send({ type: 'tool', tool });
      expect(out).toMatchObject({ status: 'done', speech: '', endSession: false });
    }
    await session.close();
  });

  it('answers with empty speech when the MCP server is unreachable', async () => {
    const { session, send } = harness([], { mcp: { url: 'http://127.0.0.1:9/mcp' } });
    const out = await send(launch);
    expect(out).toMatchObject({ status: 'done', speech: '', endSession: false });
    await session.close();
  });

  it('puts the call into the history, so the next turn knows what the user heard', async () => {
    const { session, model, send } = harness([{ text: 'Glacier it is. Want to plan it?' }]);
    await send(launch);
    await send({ type: 'turn', utterance: { text: 'the first one' } });
    const history = JSON.stringify(model.calls[0]);
    expect(history).toContain('suggest_visit');
    expect(history).toContain('trip_id');
    expect(history).toContain('Glacier is open in June');
    await session.close();
  });
});

describe('speech.endSessionField (D58)', () => {
  const plan: ScriptStep = { toolUse: { name: 'plan_trip', input: { park: 'Zion' } } };

  it('keeps the session open after a line without a question when the field is false', async () => {
    const { session, send } = harness([plan, { text: 'ignored' }]);
    const out = await send({ type: 'turn', utterance: { text: 'plan zion' } });
    expect(out).toMatchObject({ speech: 'Planned Zion.', endSession: false });
    expect(out.reprompt).toBeUndefined();
    await session.close();
  });

  it('ends the session when the last result sets the field', async () => {
    const { session, send } = harness([
      { toolUse: { name: 'end_trip', input: {} } },
      { text: 'ignored' },
    ]);
    const out = await send({ type: 'turn', utterance: { text: 'that is all' } });
    expect(out).toMatchObject({ speech: 'Trip saved.', endSession: true });
    await session.close();
  });

  it("never ends the session on the model's own words, question or not", async () => {
    const { session, send } = harness([{ text: 'Sorry, that did not work.' }]);
    const out = await send({ type: 'turn', utterance: { text: 'hello' } });
    expect(out).toMatchObject({ speech: 'Sorry, that did not work.', endSession: false });
    await session.close();
  });

  it('without the field, a reply that is not a question still ends the session', async () => {
    const { session, send } = harness([{ text: 'Zion is in Utah.' }], {
      speech: { resultField: 'say' },
    });
    const out = await send({ type: 'turn', utterance: { text: 'where is zion' } });
    expect(out.endSession).toBe(true);
    await session.close();
  });
});
