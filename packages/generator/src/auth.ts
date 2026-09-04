import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  buildAuthHeaders,
  parseOAuthClientSecret,
  type BridgeConfig,
} from '@alexa-mcp-bridge/core';

/**
 * Same auth settings as the agent, resolved once for the scan. Kept small and separate so the
 * generator depends on core only (plan section 3). MCP_SECRET_VALUE overrides Secrets Manager.
 */
export interface ScanAuth {
  headers: Record<string, string>;
  authProvider?: OAuthClientProvider;
}

export async function resolveScanAuth(config: BridgeConfig): Promise<ScanAuth> {
  const auth = config.mcp.auth;
  if (auth.type === 'none') return { headers: {} };
  const secret =
    process.env.MCP_SECRET_VALUE ??
    (await fetchSecret(auth.secretName as string, config.aws.region));
  if (auth.type === 'oauthClientCredentials') {
    const { clientId, clientSecret } = parseOAuthClientSecret(secret);
    return {
      headers: {},
      authProvider: new ClientCredentialsProvider({
        clientId,
        clientSecret,
        clientName: 'alexa-skill-mcp-bridge generator',
        ...(auth.scopes?.length ? { scope: auth.scopes.join(' ') } : {}),
      }),
    };
  }
  return { headers: buildAuthHeaders(auth, secret) };
}

async function fetchSecret(name: string, region: string): Promise<string> {
  const out = await new SecretsManagerClient({ region }).send(
    new GetSecretValueCommand({ SecretId: name }),
  );
  if (!out.SecretString) throw new Error(`Secret ${name} has no string value.`);
  return out.SecretString;
}
