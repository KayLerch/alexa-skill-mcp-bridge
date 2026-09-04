import { Agent, type Model } from '@strands-agents/sdk';
import { z } from 'zod';
import { errorFields, type AnswerHint, type Logger } from '@alexa-mcp-bridge/core';
import { renderPrompt } from '../agent/prompt.js';
import { mapAnswer, type MappedAnswer } from './answer-mapper.js';
import type { QuestionSpec } from './question.js';

/**
 * Model fallback for free-text answers against typed properties (plan D6): one structured
 * output call, then the deterministic mapper validates what came back.
 */
export async function mapAnswerWithModel(
  model: Model,
  question: QuestionSpec,
  spoken: string,
  logger: Logger,
): Promise<MappedAnswer> {
  const schema = z.object({ value: valueSchemaFor(question).nullable() });
  const agent = new Agent({ model, printer: false, tools: [] });
  try {
    const result = await agent.invoke(
      renderPrompt('elicitation', {
        message: question.message,
        property: question.property,
        schema: JSON.stringify(question.schema),
        answer: spoken,
      }),
      { structuredOutputSchema: schema },
    );
    const value = (result.structuredOutput as { value?: unknown } | undefined)?.value;
    if (value === null || value === undefined) {
      return { ok: false, reason: 'invalid', detail: 'the model found no usable value' };
    }
    return mapAnswer(hintFor(value), question);
  } catch (err) {
    logger.warn('model answer mapping failed', errorFields(err));
    return { ok: false, reason: 'invalid', detail: 'model mapping failed' };
  }
}

function valueSchemaFor(question: QuestionSpec): z.ZodType {
  switch (question.expects) {
    case 'yesNo':
      return z.boolean();
    case 'number':
      return z.number();
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    case 'choice':
      return z.string();
    case 'text':
      return z.string();
  }
}

/** Feed the model's typed value back through the deterministic rules. */
function hintFor(value: unknown): AnswerHint {
  if (typeof value === 'boolean') return { yesNo: value };
  if (typeof value === 'number') {
    return { slots: { value: { value: String(value), slotType: 'AMAZON.NUMBER' } } };
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { slots: { value: { value: text, slotType: 'AMAZON.DATE' } } };
  }
  return { text };
}
