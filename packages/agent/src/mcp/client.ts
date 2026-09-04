import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ElicitRequestSchema,
  type ElicitRequestParams,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Logger } from '@alexa-mcp-bridge/core';
import type { McpAuth } from './auth.js';
import { parseToolResult, type McpToolResult } from './result.js';
import { assertProtocolVersion } from './version.js';

/**
 * Thin wrapper over the MCP SDK client. It owns the session with the developer's server:
 * initialize with the elicitation capability, version check, tool list, tool calls with a
 * timeout long enough to stay parked on a spoken answer, and one reconnect after a drop.
 *
 * The raw SDK client is used instead of Strands' McpClient because the bridge needs
 * structuredContent, the negotiated protocol version, and a per-call timeout above the
 * SDK's 60 s default (plan D21; measured in spikes/strands-elicitation).
 */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface McpServerInfo {
  name: string;
  version?: string;
  instructions?: string;
  protocolVersion: string;
}

export type ElicitationHandler = (params: ElicitRequestParams) => Promise<ElicitResult>;

export interface BridgeMcpClientOptions {
  url: string;
  auth: McpAuth;
  minProtocolVersion: string;
  /** Upper bound for one tools/call, including time parked on an elicitation. */
  callTimeoutMs: number;
  onElicitation: ElicitationHandler;
  logger: Logger;
  /** Replacement fetch (SigV4 signing for the Gateway). */
  fetch?: FetchLike;
}

export class BridgeMcpClient {
  private client?: Client;
  private info?: McpServerInfo;
  private tools?: McpToolDefinition[];
  private connecting?: Promise<McpServerInfo>;

  constructor(private readonly options: BridgeMcpClientOptions) {}

  get serverInfo(): McpServerInfo | undefined {
    return this.info;
  }

  get connected(): boolean {
    return this.client !== undefined;
  }

  async connect(): Promise<McpServerInfo> {
    if (this.client && this.info) return this.info;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    if (this.tools) return this.tools;
    const client = await this.ensureClient();
    const result = await client.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as Record<string, unknown>,
      ...(t.outputSchema ? { outputSchema: t.outputSchema as Record<string, unknown> } : {}),
    }));
    return this.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<McpToolResult> {
    const client = await this.ensureClient();
    const raw = await client.callTool({ name, arguments: args }, undefined, {
      timeout: this.options.callTimeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return parseToolResult(raw);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.forget();
    await client?.close().catch(() => undefined);
  }

  private async open(): Promise<McpServerInfo> {
    const { url, auth, logger } = this.options;
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      ...(auth.authProvider ? { authProvider: auth.authProvider } : {}),
      ...(Object.keys(auth.headers).length ? { requestInit: { headers: auth.headers } } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    const client = new Client(
      { name: 'alexa-skill-mcp-bridge', version: '0.1.0' },
      { capabilities: { elicitation: { form: {} } } },
    );
    client.setRequestHandler(ElicitRequestSchema, (request) =>
      this.options.onElicitation(request.params),
    );
    transport.onclose = () => {
      if (this.client === client) {
        logger.warn('mcp transport closed; will reconnect on the next call');
        this.forget();
      }
    };

    await client.connect(transport);
    const protocolVersion = assertProtocolVersion(
      transport.protocolVersion,
      this.options.minProtocolVersion,
    );
    const server = client.getServerVersion();
    this.client = client;
    this.info = {
      name: server?.name ?? 'mcp-server',
      ...(server?.version ? { version: server.version } : {}),
      ...(client.getInstructions() ? { instructions: client.getInstructions() } : {}),
      protocolVersion,
    };
    logger.info('mcp connected', { server: this.info.name, protocolVersion });
    return this.info;
  }

  /** Reconnects once when the transport dropped since the last call. */
  private async ensureClient(): Promise<Client> {
    if (!this.client) await this.connect();
    return this.requireClient();
  }

  private requireClient(): Client {
    const client = this.client;
    if (!client) throw new Error('MCP client is not connected');
    return client;
  }

  private forget(): void {
    this.client = undefined;
    this.info = undefined;
    this.tools = undefined;
  }
}
