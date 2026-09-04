import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * Inline Streamable HTTP MCP server with one tool that elicits.
 * Stateful (session ids) so the elicitation reply routes back to the pending tools/call.
 */

export interface ServerEvent {
  at: number;
  event: string;
  detail?: unknown;
}

export interface InlineServerOptions {
  port?: number;
  /** Send an MCP ping to the client at this interval while a tool call waits (0 = off). */
  pingIntervalMs?: number;
  /** Server-side elicitInput timeout. The SDK default is 60 s. */
  elicitTimeoutMs?: number;
}

export async function startInlineServer(options: InlineServerOptions = {}) {
  const events: ServerEvent[] = [];
  const log = (event: string, detail?: unknown) => {
    events.push({ at: Date.now(), event, detail });
    console.log(`[server] ${event}${detail !== undefined ? ' ' + JSON.stringify(detail) : ''}`);
  };
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  const buildServer = () => {
    const server = new McpServer({ name: 'inline-elicit', version: '0.0.1' });
    server.registerTool(
      'needs_input',
      {
        description: 'Asks the user for a value and echoes it back.',
        inputSchema: { topic: z.string() },
      },
      async ({ topic }, extra) => {
        log('tool called', { topic, clientCapabilities: server.server.getClientCapabilities() });
        const ping = options.pingIntervalMs
          ? setInterval(() => {
              server.server
                .ping()
                .then(() => log('ping ok'))
                .catch((e) => log('ping failed', String(e)));
            }, options.pingIntervalMs)
          : undefined;
        const t0 = Date.now();
        try {
          const result = await server.server.elicitInput(
            {
              mode: 'form',
              message: `What value for ${topic}?`,
              requestedSchema: {
                type: 'object',
                properties: { answer: { type: 'string', title: 'Answer' } },
                required: ['answer'],
              },
            },
            { timeout: options.elicitTimeoutMs ?? 10 * 60 * 1000, signal: extra.signal },
          );
          log('elicitation result', {
            action: result.action,
            content: result.content,
            waitedMs: Date.now() - t0,
          });
          if (result.action !== 'accept') {
            return {
              content: [{ type: 'text', text: `no answer (${result.action})` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: `you said: ${String(result.content?.answer)}` }],
          };
        } catch (err) {
          log('elicitation threw', { error: String(err), waitedMs: Date.now() - t0 });
          throw err;
        } finally {
          if (ping) clearInterval(ping);
        }
      },
    );
    return server;
  };

  const readBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : undefined;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const sid = req.headers['mcp-session-id'];
    const existing = typeof sid === 'string' ? sessions.get(sid) : undefined;
    if (existing) {
      await existing.transport.handleRequest(
        req,
        res,
        req.method === 'POST' ? await readBody(req) : undefined,
      );
      return;
    }
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    if (!isInitializeRequest(body)) {
      res.writeHead(400).end('initialize first');
      return;
    }
    log('initialize', {
      protocolVersion: body.params?.protocolVersion,
      capabilities: body.params?.capabilities,
    });
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, { server, transport }),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const http = createServer((req, res) => {
    if (process.env.DEBUG_HTTP) {
      const t0 = Date.now();
      res.on('close', () =>
        log('http', {
          method: req.method,
          sid: req.headers['mcp-session-id'],
          status: res.statusCode,
          ms: Date.now() - t0,
        }),
      );
    }
    handle(req, res).catch((e) => {
      log('http error', String(e));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((r) => http.listen(options.port ?? 0, r));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    events,
    close: () => new Promise<void>((r) => http.close(() => r())),
  };
}
