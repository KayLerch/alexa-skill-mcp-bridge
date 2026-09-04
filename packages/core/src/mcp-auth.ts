import { z } from 'zod';
import type { McpAuthConfig } from './config.js';

/**
 * Header construction for MCP auth. Pure: the caller fetches the secret value
 * (Secrets Manager in AWS, an env var locally) and passes it in.
 */
export function buildAuthHeaders(auth: McpAuthConfig, secret?: string): Record<string, string> {
  switch (auth.type) {
    case 'none':
    case 'oauthClientCredentials':
      // OAuth is handled by the MCP SDK's auth provider, not by static headers.
      return {};
    case 'bearer':
      return { Authorization: `Bearer ${requireSecret(auth, secret)}` };
    case 'apiKey':
      return { [auth.headerName ?? 'x-api-key']: requireSecret(auth, secret) };
  }
}

export const oauthClientSecretSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type OAuthClientSecret = z.infer<typeof oauthClientSecretSchema>;

/** The secret for oauthClientCredentials is a JSON object with clientId and clientSecret. */
export function parseOAuthClientSecret(secret: string): OAuthClientSecret {
  const parsed = oauthClientSecretSchema.safeParse(JSON.parse(secret));
  if (!parsed.success) {
    throw new Error('OAuth secret must be JSON with "clientId" and "clientSecret" fields.');
  }
  return parsed.data;
}

function requireSecret(auth: McpAuthConfig, secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      `mcp.auth.type is '${auth.type}' but no secret value was provided (secret name: ${auth.secretName ?? 'unset'}).`,
    );
  }
  return secret;
}
