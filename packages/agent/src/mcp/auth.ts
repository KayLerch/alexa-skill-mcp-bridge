import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  buildAuthHeaders,
  parseOAuthClientSecret,
  type BridgeConfig,
} from '@alexa-mcp-bridge/core';
import type { TokenHolder } from './token.js';

/**
 * MCP auth: none, bearer, API key header, OAuth client credentials, or the user's own
 * account-linked token. The secret value is fetched once at startup. Locally, MCP_SECRET_VALUE
 * overrides Secrets Manager. The account-linked token is read per request instead (D48).
 */

export interface McpAuth {
  headers: Record<string, string>;
  authProvider?: OAuthClientProvider;
  /** A fetch that sets headers per request (the account-linked token). */
  fetch?: FetchLike;
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
  token?: TokenHolder,
): Promise<McpAuth> {
  const auth = config.mcp.auth;
  if (auth.type === 'none') return { headers: {} };
  if (auth.type === 'alexaAccountLinking') {
    if (!token) throw new Error("mcp.auth.type 'alexaAccountLinking' needs a token holder.");
    return { headers: {}, fetch: userTokenFetch(token) };
  }

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

/**
 * Adds the current account-linked token to every request the transport makes, and removes any
 * Authorization header when there is none, so a request never carries a token it was not given.
 */
export function userTokenFetch(token: TokenHolder, base?: FetchLike): FetchLike {
  return (url, init) => {
    const headers = new Headers(init?.headers);
    const current = token.get();
    if (current) headers.set('authorization', `Bearer ${current}`);
    else headers.delete('authorization');
    return (base ?? fetch)(url, { ...init, headers });
  };
}

/** The MCP server refused the credentials (HTTP 401). */
export function isUnauthorized(err: unknown): boolean {
  return (
    err instanceof UnauthorizedError || (err instanceof StreamableHTTPError && err.code === 401)
  );
}
