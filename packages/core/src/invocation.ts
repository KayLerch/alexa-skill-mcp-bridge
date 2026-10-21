import { z } from 'zod';
import { turnInputSchema } from './turn.js';

/** True when the Intl API accepts the string as an IANA time zone ("America/Los_Angeles"). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The screen of a device that can show one (D54), in pixels. Generic on purpose: the frontend
 * maps its own device description onto it, the agent only learns how big and which theme.
 */
export const displaySchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  theme: z.enum(['light', 'dark']).default('dark'),
});
export type Display = z.infer<typeof displaySchema>;

/**
 * The envelope a frontend sends to the agent container's POST /invocations.
 * Identity fields are already hashed (see hashId); raw frontend ids never appear here.
 */
export const agentInvocationSchema = z.object({
  turn: turnInputSchema,
  /** Hashed user id. Also the AgentCore runtime session id and the Memory actor id. */
  actorId: z.string().min(1),
  /** Hashed frontend session id. The Memory session id. */
  sessionId: z.string().min(1),
  locale: z.string().min(2),
  /** How long the agent may take for this call before answering 'pending'. */
  budgetMs: z.number().int().positive(),
  debug: z.boolean().default(false),
  /**
   * The user's account-linked token, when mcp.auth.type is 'alexaAccountLinking' (D48).
   * Sent on to the MCP server as a bearer token; never logged. Over HTTP it travels in
   * USER_TOKEN_HEADER, never in the payload (D63); the agent server fills it in from there.
   */
  userToken: z.string().min(1).optional(),
  /**
   * The user's IANA time zone (D53). A string the Intl API rejects is dropped, not an error: a
   * wrong zone must never cost a turn.
   */
  timeZone: z.string().refine(isValidTimeZone).optional().catch(undefined),
  /** Present only when the device has a screen: the agent may then render a widget (D54). */
  display: displaySchema.optional(),
});
export type AgentInvocation = z.infer<typeof agentInvocationSchema>;
export type AgentInvocationInput = z.input<typeof agentInvocationSchema>;

/**
 * The HTTP header that carries the account-linked token to the agent runtime (D63): a custom
 * header AgentCore Runtime passes through once the runtime allow-lists it. The payload, which
 * the runtime's request logs record, never holds the token.
 */
export const USER_TOKEN_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Token';

/**
 * An AWS SDK build-step middleware that sets USER_TOKEN_HEADER on the outgoing request.
 * Structural, so core stays free of the SDK: `command.middlewareStack.add(userTokenMiddleware(t),
 * { step: 'build', name: 'bridgeUserToken' })`.
 */
export function userTokenMiddleware(token: string) {
  return <A extends { request: unknown }, R>(next: (args: A) => Promise<R>) =>
    async (args: A): Promise<R> => {
      const request = args.request as { headers?: Record<string, string> };
      if (request.headers) request.headers[USER_TOKEN_HEADER] = token;
      return next(args);
    };
}
