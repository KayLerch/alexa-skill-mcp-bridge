import type { ElicitRequestParams } from '@modelcontextprotocol/sdk/types.js';
import type { QuestionExpects } from '@alexa-mcp-bridge/core';

/**
 * Elicitation params → the questions a voice can ask, one property at a time (plan D5).
 * Deterministic: the server's message is spoken as-is; enum choices are appended.
 */

export type PropertySchema = Record<string, unknown> & { type?: string };

export interface QuestionSpec {
  property: string;
  schema: PropertySchema;
  message: string;
  expects: QuestionExpects;
  choices?: string[];
  required: boolean;
}

export type ElicitationPlan =
  { mode: 'form'; questions: QuestionSpec[] } | { mode: 'url'; url: string; message: string };

export function planElicitation(params: ElicitRequestParams): ElicitationPlan {
  if (params.mode === 'url') {
    return { mode: 'url', url: params.url, message: params.message };
  }
  const properties = (params.requestedSchema.properties ?? {}) as Record<string, PropertySchema>;
  const required = new Set(params.requestedSchema.required ?? []);
  const names = Object.keys(properties).sort((a, b) => {
    // Required properties first, otherwise keep the server's order.
    const ra = required.has(a) ? 0 : 1;
    const rb = required.has(b) ? 0 : 1;
    return ra - rb;
  });
  const multi = names.length > 1;
  const questions = names.map((property, index) => {
    const schema = properties[property] as PropertySchema;
    const expects = expectsFor(schema);
    const choices = choicesFor(schema);
    return {
      property,
      schema,
      expects,
      ...(choices ? { choices } : {}),
      required: required.has(property),
      message: questionMessage(params.message, property, schema, expects, choices, multi, index),
    };
  });
  return { mode: 'form', questions };
}

export function expectsFor(schema: PropertySchema): QuestionExpects {
  if (schema.type === 'boolean') return 'yesNo';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (choicesFor(schema)) return 'choice';
  if (schema.type === 'string' && (schema.format === 'date' || schema.format === 'date-time')) {
    return 'date';
  }
  return 'text';
}

/** Spoken choice labels: enumNames or oneOf/anyOf titles when present, else the values. */
export function choicesFor(schema: PropertySchema): string[] | undefined {
  const items = schema.type === 'array' ? (schema.items as PropertySchema | undefined) : undefined;
  const source = items ?? schema;
  const titled = (source.oneOf ?? source.anyOf) as
    Array<{ const: string; title: string }> | undefined;
  if (Array.isArray(titled) && titled.length) return titled.map((o) => o.title ?? o.const);
  const values = source.enum as string[] | undefined;
  if (Array.isArray(values) && values.length) {
    const names = source.enumNames as string[] | undefined;
    return names?.length === values.length ? names : values;
  }
  return undefined;
}

/** Map a spoken choice label back to the schema's value. */
export function choiceValueFor(schema: PropertySchema, spoken: string): string | undefined {
  const items = schema.type === 'array' ? (schema.items as PropertySchema | undefined) : undefined;
  const source = items ?? schema;
  const norm = (s: string) => s.trim().toLowerCase();
  const titled = (source.oneOf ?? source.anyOf) as
    Array<{ const: string; title: string }> | undefined;
  if (Array.isArray(titled)) {
    const hit =
      titled.find((o) => norm(o.title ?? '') === norm(spoken) || norm(o.const) === norm(spoken)) ??
      titled.find(
        (o) =>
          norm(o.title ?? '').includes(norm(spoken)) || norm(spoken).includes(norm(o.title ?? '')),
      );
    return hit?.const;
  }
  const values = source.enum as string[] | undefined;
  if (!Array.isArray(values)) return undefined;
  const names = source.enumNames as string[] | undefined;
  const idx = values.findIndex(
    (v, i) =>
      norm(v) === norm(spoken) ||
      (names?.[i] !== undefined && norm(names[i] as string) === norm(spoken)),
  );
  if (idx >= 0) return values[idx];
  const loose = values.findIndex(
    (v, i) =>
      norm(spoken).includes(norm(v)) ||
      norm(v).includes(norm(spoken)) ||
      (names?.[i] !== undefined && norm(spoken).includes(norm(names[i] as string))),
  );
  return loose >= 0 ? values[loose] : undefined;
}

function questionMessage(
  message: string,
  property: string,
  schema: PropertySchema,
  expects: QuestionExpects,
  choices: string[] | undefined,
  multi: boolean,
  index: number,
): string {
  const label = (schema.title as string | undefined) ?? humanize(property);
  let text: string;
  if (!multi) {
    text = message.trim();
  } else if (index === 0) {
    text = `${message.trim()} First, ${propertyQuestion(label, expects)}`;
  } else {
    text = capitalize(propertyQuestion(label, expects));
  }
  if (choices?.length) {
    text += ` ${spokenChoices(choices)}`;
  } else if (expects === 'yesNo' && !/\byes\b.*\bno\b/i.test(text)) {
    text += ' Yes or no?';
  }
  return text;
}

function propertyQuestion(label: string, expects: QuestionExpects): string {
  switch (expects) {
    case 'yesNo':
      return `${label.toLowerCase()}?`;
    case 'number':
      return `how many for ${label.toLowerCase()}?`;
    case 'date':
      return `what date for ${label.toLowerCase()}?`;
    case 'choice':
      return `which ${label.toLowerCase()}?`;
    case 'text':
      return `what is the ${label.toLowerCase()}?`;
  }
}

export function spokenChoices(choices: string[]): string {
  if (choices.length === 1) return `The option is ${choices[0]}.`;
  if (choices.length === 2) return `The options are ${choices[0]} or ${choices[1]}.`;
  const head = choices.slice(0, -1).join(', ');
  return `The options are ${head}, or ${choices[choices.length - 1]}.`;
}

export function humanize(property: string): string {
  return property
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
