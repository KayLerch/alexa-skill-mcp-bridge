import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Model } from '@strands-agents/sdk';
import {
  SPOKEN,
  agentInvocationSchema,
  errorFields,
  type BridgeConfig,
  type Logger,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import type { MemoryAdapter } from './memory/store.js';
import { BridgeSession } from './session.js';
import { runTurn } from './turn.js';

/**
 * The AgentCore Runtime contract: GET /ping and POST /invocations on 8080.
 * Plain node:http (plan D1). One session per process; AgentCore gives each user their own.
 */

export interface AgentServerOptions {
  config: BridgeConfig;
  model: Model;
  memory: MemoryAdapter;
  logger: Logger;
  port?: number;
  host?: string;
  gatewayUrl?: string;
}

export interface AgentServer {
  server: Server;
  session: BridgeSession;
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
}

export function createAgentServer(options: AgentServerOptions): AgentServer {
  const { logger } = options;
  const session = new BridgeSession(options);

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      logger.error('request handling failed', errorFields(err));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, {
        status: session.ping(),
        time_of_last_update: Math.floor(Date.now() / 1000),
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/invocations') {
      const body = await readJson(req);
      const parsed = agentInvocationSchema.safeParse(body);
      if (!parsed.success) {
        logger.warn('invalid invocation', { issues: parsed.error.issues.map((i) => i.message) });
        json(res, 400, { error: 'invalid invocation', issues: parsed.error.issues });
        return;
      }
      const startedAt = Date.now();
      let output: TurnOutput;
      try {
        output = await runTurn(session, parsed.data);
      } catch (err) {
        logger.error('turn failed', errorFields(err));
        output = { status: 'error', speech: SPOKEN.error, endSession: false, visual: null };
      }
      logger.info('invocation done', {
        turnType: parsed.data.turn.type,
        status: output.status,
        elapsedMs: Date.now() - startedAt,
        state: session.state,
      });
      json(res, 200, output);
      return;
    }
    res.writeHead(404).end();
  }

  return {
    server,
    session,
    start: () =>
      new Promise((resolve) => {
        server.listen(options.port ?? 8080, options.host ?? '0.0.0.0', () => {
          const address = server.address();
          const port =
            typeof address === 'object' && address ? address.port : (options.port ?? 8080);
          logger.info('agent server listening', { port });
          resolve({ port });
        });
      }),
    stop: async () => {
      await session.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
