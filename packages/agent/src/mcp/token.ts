/**
 * The user's account-linked token, for mcp.auth.type 'alexaAccountLinking' (D48). One holder
 * per container, and AgentCore runs one container per hashed user, so it only ever holds that
 * user's token. Every invocation sets it, and every MCP request reads it, so a refreshed token
 * is used without reconnecting and an invocation without one sends nothing stale. Never logged.
 */
export class TokenHolder {
  private token?: string;

  set(token: string | undefined): void {
    this.token = token;
  }

  get(): string | undefined {
    return this.token;
  }
}
