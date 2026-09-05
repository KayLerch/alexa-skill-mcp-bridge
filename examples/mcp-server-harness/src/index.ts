import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createConsoleLog } from './console-log.js';
import { attachWireLog, type Log } from './wire.js';

/**
 * The plumbing every example MCP server needs, so each one is only its data and its tools.
 * Streamable HTTP, stateful (one session per client): stateless mode cannot route an
 * elicitation reply back to the pending tools/call, and elicitation is the point of the bridge.
 */

export { createConsoleLog, jsonLog, type ConsoleLogOptions } from './console-log.js';
export { attachWireLog, type Log, type LogEvent, type WireEvent } from './wire.js';

const PATH = '/mcp';
/** Off the beaten path on purpose: 3000 and 8080 are usually taken on a developer machine. */
export const DEFAULT_PORT = 3939;

export interface McpServerOptions {
  /** Server name and version reported at initialize. */
  name: string;
  version: string;
  /** The server's `instructions` string. The agent injects it into its system prompt. */
  instructions: string;
  /** Registers the tools on a freshly built server, once per client session. */
  registerTools: (server: McpServer, log: Log) => void;
  /** 0 picks an ephemeral port (tests). */
  port?: number;
  /** When set, requests must carry "Authorization: Bearer <token>". */
  bearerToken?: string;
  log?: Log;
}

export interface McpServerHandle {
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

export async function startMcpServer(options: McpServerOptions): Promise<McpServerHandle> {
  const log = options.log ?? createConsoleLog();
  const sessions = new Map<string, Session>();
  const bearerToken = options.bearerToken;

  const buildServer = (): McpServer => {
    const server = new McpServer(
      { name: options.name, version: options.version },
      { instructions: options.instructions },
    );
    options.registerTools(server, log);
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
        log({ msg: 'session initialized', session: id });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        log({ msg: 'session closed', session: id });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    // After connect: the wire log wraps the onmessage handler that connect installed.
    attachWireLog(transport, log);
    await transport.handleRequest(req, res, body);
  };

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log({ msg: 'request failed', error: String(err) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const requestedPort = options.port ?? DEFAULT_PORT;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${requestedPort} is already in use by another program. ` +
              `Start the server on a free port, e.g. PORT=${requestedPort + 1} npm run sample:start, ` +
              `and set mcp.url in bridge.config.ts to http://localhost:${requestedPort + 1}${PATH}.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    httpServer.listen(requestedPort, resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  const url = `http://localhost:${port}${PATH}`;
  log({
    msg: `${options.name} listening`,
    url,
    auth: bearerToken ? 'bearer' : 'none',
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
