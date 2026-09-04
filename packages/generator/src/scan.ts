import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assertProtocolVersion, type BridgeConfig } from '@alexa-mcp-bridge/core';
import { resolveScanAuth } from './auth.js';

/** What the generator needs from the server: identity, instructions, and the tool list. */
export interface ScannedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ScanResult {
  server: { name: string; version?: string; instructions?: string };
  protocolVersion: string;
  tools: ScannedTool[];
}

export class ScanError extends Error {
  override readonly name = 'ScanError';
}

/** initialize + tools/list with the agent's client settings. Fails with a plain-language message. */
export async function scanServer(config: BridgeConfig): Promise<ScanResult> {
  const auth = await resolveScanAuth(config);
  const transport = new StreamableHTTPClientTransport(new URL(config.mcp.url), {
    ...(auth.authProvider ? { authProvider: auth.authProvider } : {}),
    ...(Object.keys(auth.headers).length ? { requestInit: { headers: auth.headers } } : {}),
  });
  const client = new Client(
    { name: 'alexa-skill-mcp-bridge generator', version: '0.1.0' },
    { capabilities: { elicitation: { form: {} } } },
  );

  try {
    await client.connect(transport);
  } catch (err) {
    throw new ScanError(explainConnectError(config, err));
  }

  try {
    const protocolVersion = assertProtocolVersion(
      transport.protocolVersion,
      config.mcp.protocolVersion,
    );
    const server = client.getServerVersion();
    const instructions = client.getInstructions();
    const { tools } = await client.listTools();
    if (tools.length === 0) {
      throw new ScanError(`${config.mcp.url} exposes no tools; there is nothing to generate.`);
    }
    return {
      server: {
        name: server?.name ?? 'mcp-server',
        ...(server?.version ? { version: server.version } : {}),
        ...(instructions ? { instructions } : {}),
      },
      protocolVersion,
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<
          string,
          unknown
        >,
      })),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function explainConnectError(config: BridgeConfig, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|Unauthorized|Forbidden/i.test(message)) {
    return (
      `${config.mcp.url} refused the connection (${message.split('\n')[0]}). ` +
      (config.mcp.auth.type === 'none'
        ? 'The server needs auth: set mcp.auth in bridge.config.ts and create the secret.'
        : `Check the secret ${config.mcp.auth.secretName ?? ''} and mcp.auth.type (${config.mcp.auth.type}).`)
    );
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|EAI_AGAIN/i.test(message)) {
    return (
      `Cannot reach ${config.mcp.url} (${message.split('\n')[0]}). ` +
      'Is the server running? For the sample server: npm run sample:start.'
    );
  }
  return `Connecting to ${config.mcp.url} failed: ${message.split('\n')[0]}`;
}
