import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  buildAuthHeaders,
  parseOAuthClientSecret,
  type BridgeConfig,
} from '@alexa-mcp-bridge/core';

/**
 * MCP auth: none, bearer, API key header, or OAuth client credentials.
 * The secret value is fetched once at startup. Locally, MCP_SECRET_VALUE overrides Secrets Manager.
 */

export interface McpAuth {
  headers: Record<string, string>;
  authProvider?: OAuthClientProvider;
}

export type SecretResolver = (secretName: string) => Promise<string>;

export function secretsManagerResolver(region: string): SecretResolver {
  const client = new SecretsManagerClient({ region });
  return async (secretName) => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!out.SecretString) throw new Error(`Secret ${secretName} has no string value.`);
    return out.SecretString;
  };
}

export function defaultSecretResolver(region: string): SecretResolver {
  const override = process.env.MCP_SECRET_VALUE;
  if (override) return async () => override;
  return secretsManagerResolver(region);
}

export async function resolveMcpAuth(
  config: BridgeConfig,
  resolveSecret: SecretResolver = defaultSecretResolver(config.aws.region),
): Promise<McpAuth> {
  const auth = config.mcp.auth;
  if (auth.type === 'none') return { headers: {} };

  const secret = await resolveSecret(auth.secretName as string);
  if (auth.type === 'oauthClientCredentials') {
    const { clientId, clientSecret } = parseOAuthClientSecret(secret);
    return {
      headers: {},
      authProvider: new ClientCredentialsProvider({
        clientId,
        clientSecret,
        clientName: 'alexa-skill-mcp-bridge',
        ...(auth.scopes?.length ? { scope: auth.scopes.join(' ') } : {}),
      }),
    };
  }
  return { headers: buildAuthHeaders(auth, secret) };
}
