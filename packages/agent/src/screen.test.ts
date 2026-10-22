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
 * The screen in the turn (D54): after a finished run that called a tool with an MCP Apps widget,
 * a frontend that sent `display` gets the widget rendered as `visual`. The renderer here is a
 * fake; renderer.test.ts drives the real one in Chromium.
 */

const URI = 'ui://parks/park-0123456789ab.html';
const WIDGET = '<!doctype html><p>park widget</p>';

let http: Server;
let url = '';
const reads: string[] = [];

beforeAll(async () => {
  http = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const body = await readJson(req);
      const message = body as { method?: string; params?: { uri?: string } } | undefined;
      if (message?.method === 'resources/read') reads.push(String(message.params?.uri));
      const server = new McpServer({ name: 'parks-with-a-screen', version: '1.0.0' });
      server.registerTool(
        'show_park',
        {
          description: 'Show a park.',
          inputSchema: { park: z.string() },
          _meta: { ui: { resourceUri: URI } },
        },
        async ({ park }) => ({
          content: [{ type: 'text', text: `SECRET-RESULT-TEXT ${park}` }],
          structuredContent: { title: park },
          _meta: { ui: { resourceUri: URI } },
        }),
      );
      server.registerTool('plain', { description: 'No screen.' }, async () => ({
        content: [{ type: 'text', text: 'plain' }],
      }));
      server.registerResource(
        'park-widget',
        URI,
        { mimeType: 'text/html;profile=mcp-app' },
        async () => ({
          contents: [{ uri: URI, mimeType: 'text/html;profile=mcp-app', text: WIDGET }],
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
  dataUrl: 'data:image/jpeg;base64,SECRETIMAGEBYTES',
  width: 1280,
  height: 800,
};

class FakeScreen implements ScreenRenderer {
  readonly jobs: RenderJob[] = [];
  warmed = 0;
  closed = 0;
  constructor(private readonly reply: (job: RenderJob) => Promise<Visual | undefined>) {}
  async warm(): Promise<void> {
    this.warmed++;
  }
  render(job: RenderJob): Promise<Visual | undefined> {
    this.jobs.push(job);
    return this.reply(job);
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

const showPark: ScriptStep = { toolUse: { name: 'show_park', input: { park: 'Yosemite' } } };
const DISPLAY = { width: 1280, height: 800 };

function harness(
  steps: ScriptStep[],
  options: {
    enabled?: boolean;
    reply?: (job: RenderJob) => Promise<Visual | undefined>;
  } = {},
) {
  const lines: string[] = [];
  const logger = createLogger({ service: 'test' }, { write: (l) => lines.push(l) });
  const config = parseConfig({ mcp: { url }, visual: { enabled: options.enabled ?? true } });
  const screen = new FakeScreen(options.reply ?? (async () => IMAGE));
  const session = new BridgeSession({
    config,
    model: new ScriptedModel(steps),
    memory: noopMemory,
    logger,
    renderer: screen,
  });
  const send = (
    turn: TurnInput,
    extra: Partial<Pick<AgentInvocationInput, 'display' | 'budgetMs'>> = {},
  ) =>
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
  return { session, screen, send, lines };
}

const ask = { type: 'turn', utterance: { text: 'show me Yosemite' } } as const;

describe('the screen in a turn (D54)', () => {
  it('warms the renderer and renders the widget of the last tool call for a device with a display', async () => {
    const { session, screen, send } = harness([showPark, { text: 'Here is Yosemite.' }]);
    await send({ type: 'warmup' });
    const out = await send(ask, { display: DISPLAY });
    expect(screen.warmed).toBe(1);
    expect(out.speech).toBe('Here is Yosemite.');
    expect(out.visual).toEqual(IMAGE);
    expect(screen.jobs).toHaveLength(1);
    const [job] = screen.jobs;
    expect(job?.html).toBe(WIDGET);
    expect(job?.toolInput).toEqual({ park: 'Yosemite' });
    expect(job?.toolResult.structuredContent).toEqual({ title: 'Yosemite' });
    expect(job?.display).toEqual({ width: 1280, height: 800, theme: 'dark' });
    await session.close();
    expect(screen.closed).toBe(1);
  });

  it('never calls the renderer when the envelope has no display', async () => {
    const { session, screen, send } = harness([showPark, { text: 'Here is Yosemite.' }]);
    const out = await send(ask);
    expect(out.visual).toBeNull();
    expect(screen.jobs).toHaveLength(0);
    await session.close();
  });

  it('reads the widget resource once for two turns with the same URI', async () => {
    reads.length = 0;
    const { session, screen, send } = harness([
      showPark,
      { text: 'Here is Yosemite.' },
      showPark,
      { text: 'Yosemite again.' },
    ]);
    await send(ask, { display: DISPLAY });
    await send(ask, { display: DISPLAY });
    expect(screen.jobs).toHaveLength(2);
    expect(reads).toEqual([URI]);
    await session.close();
  });

  it('renders nothing when the run called no tool with a widget', async () => {
    const { session, screen, send } = harness([
      { toolUse: { name: 'plain', input: {} } },
      { text: 'Done.' },
    ]);
    const out = await send(ask, { display: DISPLAY });
    expect(out.visual).toBeNull();
    expect(screen.jobs).toHaveLength(0);
    await session.close();
  });

  it('keeps the speech and drops the visual when the render throws or gives up', async () => {
    const throwing = harness([showPark, { text: 'Here is Yosemite.' }], {
      reply: async () => {
        throw new Error('browser crashed');
      },
    });
    const out = await throwing.send(ask, { display: DISPLAY });
    expect(out).toMatchObject({ status: 'done', speech: 'Here is Yosemite.', visual: null });
    await throwing.session.close();

    const empty = harness([showPark, { text: 'Here is Yosemite.' }], {
      reply: async () => undefined,
    });
    expect((await empty.send(ask, { display: DISPLAY })).visual).toBeNull();
    await empty.session.close();
  });

  it('skips the render when less than a second of the budget is left', async () => {
    const { session, screen, send } = harness([showPark, { text: 'Here is Yosemite.' }]);
    // Budget 1400 ms leaves a 900 ms deadline: never enough for a screen.
    const out = await send(ask, { display: DISPLAY, budgetMs: 1400 });
    expect(out.speech).toBe('Here is Yosemite.');
    expect(out.visual).toBeNull();
    expect(screen.jobs).toHaveLength(0);
    await session.close();
  });

  it('answers by the deadline without a visual when the render hangs', async () => {
    const { session, send } = harness([showPark, { text: 'Here is Yosemite.' }], {
      reply: () => new Promise<never>(() => undefined),
    });
    await send({ type: 'warmup' });
    await session.ready({ actorId: 'a', locale: 'en-US' }, 5000);
    const startedAt = Date.now();
    const out = await send(ask, { display: DISPLAY, budgetMs: 2500 });
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(out).toMatchObject({ speech: 'Here is Yosemite.', visual: null });
    await session.close();
  });

  it('does nothing with visual.enabled off', async () => {
    const { session, screen, send } = harness([showPark, { text: 'Here is Yosemite.' }], {
      enabled: false,
    });
    await send({ type: 'warmup' });
    const out = await send(ask, { display: DISPLAY });
    expect(out.visual).toBeNull();
    expect(screen.warmed).toBe(0);
    expect(screen.jobs).toHaveLength(0);
    await session.close();
  });

  it('forgets the remembered widget call with the conversation', async () => {
    const { session, send } = harness([showPark, { text: 'Here is Yosemite.' }]);
    await send(ask, { display: DISPLAY });
    expect(session.widgets.latest?.resourceUri).toBe(URI);
    session.forgetConversation();
    expect(session.widgets.latest).toBeUndefined();
    await session.close();
  });

  it('logs neither the image nor the tool result text', async () => {
    const { session, send, lines } = harness([showPark, { text: 'Here is Yosemite.' }]);
    await send(ask, { display: DISPLAY });
    const all = lines.join('\n');
    expect(all).not.toContain('SECRETIMAGEBYTES');
    expect(all).not.toContain('SECRET-RESULT-TEXT');
    await session.close();
  });
});
