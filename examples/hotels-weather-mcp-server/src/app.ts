import {
  DEFAULT_PORT,
  startMcpServer,
  type Log,
  type McpServerHandle,
} from '@alexa-mcp-bridge/mcp-server-harness';
import { registerTools, SERVER_INSTRUCTIONS } from './tools.js';

/**
 * Sample MCP server: hotels and weather, one tool that elicits. The Streamable HTTP plumbing
 * lives in the harness; this file is the server's identity, its options and its tools.
 */

export { DEFAULT_PORT };
export type HotelsWeatherServerHandle = McpServerHandle;

export interface HotelsWeatherServerOptions {
  /** 0 picks an ephemeral port (tests). */
  port?: number;
  /** When set, requests must carry "Authorization: Bearer <token>". */
  bearerToken?: string;
  /** Delay get_weather by this many seconds to exercise the bridge's overrun path. */
  slowSeconds?: number;
  /** Where events go. Defaults to readable console lines; tests collect them instead. */
  log?: Log;
}

export async function startHotelsWeatherServer(
  options: HotelsWeatherServerOptions = {},
): Promise<HotelsWeatherServerHandle> {
  return startMcpServer({
    name: 'hotels-and-weather',
    version: '0.1.0',
    instructions: SERVER_INSTRUCTIONS,
    registerTools: (server, log) =>
      registerTools(server, { slowSeconds: options.slowSeconds ?? 0, log }),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.bearerToken ? { bearerToken: options.bearerToken } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
