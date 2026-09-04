import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, SERVER_INSTRUCTIONS } from './tools.js';

/**
 * Sample MCP server: Streamable HTTP, stateful (one session per client), protocol 2025-11-25.
 * Stateful mode is required: the elicitation reply has to be routed back to the
 * pending tools/call request, which stateless mode cannot do.
 */

const PATH = '/mcp';

export interface SampleServerOptions {
  /** 0 picks an ephemeral port (tests). */
  port?: number;
  /** When set, requests must carry "Authorization: Bearer <token>". */
  bearerToken?: string;
  /** Delay get_weather by this many seconds to exercise the bridge's overrun path. */
  slowSeconds?: number;
  log?: (event: Record<string, unknown>) => void;
}

export interface SampleServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length ? JSON.parse(raw) : undefined;
}

export async function startSampleServer(
  options: SampleServerOptions = {},
): Promise<SampleServerHandle> {
  const log = options.log ?? ((event) => console.error(JSON.stringify(event)));
  const sessions = new Map<string, Session>();
  const bearerToken = options.bearerToken;

  const buildServer = (): McpServer => {
    const server = new McpServer(
      { name: 'sample-hotel-and-weather', version: '0.1.0' },
      { instructions: SERVER_INSTRUCTIONS },
    );
    registerTools(server, { slowSeconds: options.slowSeconds ?? 0, log });
    return server;
  };

  const authorized = (req: IncomingMessage): boolean =>
    !bearerToken || req.headers.authorization === `Bearer ${bearerToken}`;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) {
      res.writeHead(404).end('Not found. The MCP endpoint is ' + PATH);
      return;
    }
    if (!authorized(req)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('Unauthorized');
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

    if (existing) {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
      await existing.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(400).end('Missing or unknown mcp-session-id');
      return;
    }

    const body = await readJsonBody(req);
    if (!isInitializeRequest(body)) {
      res.writeHead(400).end('Send an initialize request first');
      return;
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
        log({ msg: 'session initialized', sessionId: id });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        log({ msg: 'session closed', sessionId: id });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log({ msg: 'request failed', error: String(err) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(options.port ?? 3000, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 3000);
  const url = `http://localhost:${port}${PATH}`;
  log({
    msg: 'sample MCP server listening',
    url,
    auth: bearerToken ? 'bearer' : 'none',
    slowSeconds: options.slowSeconds ?? 0,
  });

  return {
    url,
    port,
    close: async () => {
      for (const s of sessions.values()) await s.transport.close().catch(() => undefined);
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
