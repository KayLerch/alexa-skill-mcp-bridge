import { z } from 'zod';
import { turnInputSchema } from './turn.js';

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
});
export type AgentInvocation = z.infer<typeof agentInvocationSchema>;
export type AgentInvocationInput = z.input<typeof agentInvocationSchema>;
