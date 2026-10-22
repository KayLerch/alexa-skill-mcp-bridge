import { z } from 'zod';
import { SPOKEN } from './messages.js';

/**
 * The Turn contract: the boundary between any frontend (Alexa Skill, CLI, a future web UI)
 * and the agent. Keep it small and stable.
 */

/** A slot value as the frontend resolved it. `slotType` tells the agent how to read `value`. */
export const slotValueSchema = z.object({
  /** What the user said, as transcribed. */
  value: z.string(),
  /** Canonical value from entity resolution, when the slot type defines one. */
  resolvedValue: z.string().optional(),
  /** Entity id from entity resolution, when the slot type defines one. */
  resolvedId: z.string().optional(),
  /** Slot type name, e.g. AMAZON.DATE, AMAZON.NUMBER, YesNoType, or a generated enum type. */
  slotType: z.string(),
});
export type SlotValue = z.infer<typeof slotValueSchema>;

export const utteranceHintSchema = z.object({
  /** Free text if the frontend has it (web input, AMAZON.SearchQuery slot). */
  text: z.string().optional(),
  /** Alexa intent name, if any. */
  intent: z.string().optional(),
  /** Tool the intent maps to (from the manifest). A hint for the agent, never a command. */
  tool: z.string().optional(),
  /** Resolved slot values keyed by tool argument name. */
  slots: z.record(z.string(), slotValueSchema).optional(),
});
export type UtteranceHint = z.infer<typeof utteranceHintSchema>;

export const answerHintSchema = z.object({
  text: z.string().optional(),
  slots: z.record(z.string(), slotValueSchema).optional(),
  yesNo: z.boolean().optional(),
});
export type AnswerHint = z.infer<typeof answerHintSchema>;

export const turnInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('warmup') }),
  z.object({ type: z.literal('turn'), utterance: utteranceHintSchema }),
  z.object({ type: z.literal('answer'), questionId: z.string(), answer: answerHintSchema }),
  z.object({ type: z.literal('poll') }),
  /**
   * Call one tool directly, without the model (D57): the launch tool and mapped built-in intents.
   * `intent` names what the frontend matched, for the conversation record.
   */
  z.object({
    type: z.literal('tool'),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
    intent: z.string().optional(),
  }),
  z.object({ type: z.literal('cancel') }),
]);
export type TurnInput = z.infer<typeof turnInputSchema>;

/** Tells the frontend which answer intents apply to a pending question. */
export const questionExpectsSchema = z.enum(['yesNo', 'date', 'number', 'choice', 'text']);
export type QuestionExpects = z.infer<typeof questionExpectsSchema>;

export const questionSchema = z.object({
  id: z.string(),
  /** MCP elicitation versus the agent asking for a missing argument. */
  source: z.enum(['elicitation', 'agent']),
  /** What to speak. */
  message: z.string(),
  /** The elicitation property's JSON schema (flat primitives only), when there is one. */
  schema: z.record(z.string(), z.unknown()).optional(),
  expects: questionExpectsSchema,
  choices: z.array(z.string()).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const toolCallDebugSchema = z.object({
  name: z.string(),
  input: z.unknown().optional(),
  status: z.enum(['success', 'error']),
  elapsedMs: z.number(),
});
export type ToolCallDebug = z.infer<typeof toolCallDebugSchema>;

export const turnDebugSchema = z.object({
  toolCalls: z.array(toolCallDebugSchema),
  modelCalls: z.number().int().nonnegative(),
  elapsedMs: z.number(),
});
export type TurnDebug = z.infer<typeof turnDebugSchema>;

/**
 * A rendered screen (D54): the MCP server's own widget as an inline JPEG, at most 1280 px wide.
 * The bridge draws nothing itself; the frontend shows the image as it is.
 */
export const visualSchema = z.object({
  kind: z.literal('image'),
  mimeType: z.literal('image/jpeg'),
  dataUrl: z.string(),
  width: z.number(),
  height: z.number(),
});
export type Visual = z.infer<typeof visualSchema>;

export const turnStatusSchema = z.enum(['done', 'question', 'pending', 'error']);
export type TurnStatus = z.infer<typeof turnStatusSchema>;

export const turnOutputSchema = z.object({
  status: turnStatusSchema,
  /** Plain text, TTS-friendly, no markdown. */
  speech: z.string(),
  reprompt: z.string().optional(),
  /** Present when status is 'question'. */
  question: questionSchema.optional(),
  endSession: z.boolean(),
  /** The server's widget rendered for a device with a screen (D54); null otherwise. */
  visual: visualSchema.nullable(),
  /** Only when features.debug is on. */
  debug: turnDebugSchema.optional(),
  /** The MCP server needs the user's linked account: the frontend shows how to link it (D48). */
  linkAccount: z.boolean().optional(),
  /**
   * The server's own line for a reply the frontend could not make out (speech.fallbackField, D70).
   * Only on an output that keeps the session open.
   */
  fallback: z.string().optional(),
});
export type TurnOutput = z.infer<typeof turnOutputSchema>;

/**
 * The answer while a run works past the budget: skill.stillWorkingMessage and its reprompt. The
 * session stays open, and the next request fetches the result (D72).
 */
export function stillWorkingOutput(skill: {
  stillWorkingMessage: string;
  stillWorkingReprompt: string;
}): TurnOutput {
  return {
    status: 'pending',
    speech: skill.stillWorkingMessage,
    reprompt: skill.stillWorkingReprompt,
    endSession: false,
    visual: null,
  };
}

/** The answer when the request has no usable account-linked token. Ends the session. */
export function linkAccountOutput(): TurnOutput {
  return {
    status: 'done',
    speech: SPOKEN.linkAccount,
    endSession: true,
    visual: null,
    linkAccount: true,
  };
}
