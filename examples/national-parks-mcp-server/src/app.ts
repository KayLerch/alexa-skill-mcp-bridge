import {
  DEFAULT_PORT,
  startMcpServer,
  type Log,
  type McpServerHandle,
} from '@alexa-mcp-bridge/mcp-server-harness';
import { registerTools, SERVER_INSTRUCTIONS } from './tools.js';

/**
 * National parks MCP server: two tools over a committed extract of public NPS data. The
 * Streamable HTTP plumbing lives in the harness; this file is the server's identity.
 */

export { DEFAULT_PORT };
export type ParksServerHandle = McpServerHandle;

export interface ParksServerOptions {
  /** 0 picks an ephemeral port (tests). */
  port?: number;
  /** When set, requests must carry "Authorization: Bearer <token>". */
  bearerToken?: string;
  log?: Log;
}

export async function startParksServer(
  options: ParksServerOptions = {},
): Promise<ParksServerHandle> {
  return startMcpServer({
    name: 'national-parks',
    version: '0.1.0',
    instructions: SERVER_INSTRUCTIONS,
    registerTools: (server, log) => registerTools(server, { log }),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.bearerToken ? { bearerToken: options.bearerToken } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
