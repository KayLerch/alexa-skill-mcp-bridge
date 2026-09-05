import type { ElicitRequestParams } from '@modelcontextprotocol/sdk/types.js';
import type { QuestionExpects } from '@alexa-mcp-bridge/core';
import { cleanSpeech } from '../speech.js';

/**
 * Elicitation params → the questions a voice can ask, one property at a time (plan D5).
 * Deterministic, and the voice rules live here rather than in a prompt because the model never
 * sees this text: the server's message is cleaned up and spoken, and choices are offered as
 * examples rather than read out as a menu.
 */

/** Voice rules from config.speech. */
export interface SpeechStyle {
  maxChoicesSpoken: number;
}

const DEFAULT_STYLE: SpeechStyle = { maxChoicesSpoken: 3 };

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

export function planElicitation(
  params: ElicitRequestParams,
  style: SpeechStyle = DEFAULT_STYLE,
): ElicitationPlan {
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
      message: questionMessage(
        params.message,
        property,
        schema,
        expects,
        choices,
        multi,
        index,
        style,
      ),
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
  style: SpeechStyle,
): string {
  const label = (schema.title as string | undefined) ?? humanize(property);
  // The server wrote this for a reader, not a listener: strip markdown, links and emoji.
  const spoken = cleanSpeech(message);
  let text: string;
  if (!multi) {
    text = spoken;
  } else if (index === 0) {
    text = `${spoken} First, ${propertyQuestion(label, expects)}`;
  } else {
    text = capitalize(propertyQuestion(label, expects));
  }
  if (choices?.length) {
    // A server that already offers the options in its own sentence should not be echoed.
    const offer = alreadyOffers(text, choices)
      ? ''
      : spokenChoices(choices, style.maxChoicesSpoken);
    if (offer) text += ` ${offer}`;
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

/** Two or more of the choices already named in the question is an offer, not a coincidence. */
function alreadyOffers(message: string, choices: string[]): boolean {
  const lower = message.toLowerCase();
  return choices.filter((c) => lower.includes(c.trim().toLowerCase())).length >= 2;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Sets a listener already knows. Reading them out teaches nothing and costs seconds. */
function isKnownSet(choices: string[]): boolean {
  const lower = choices.map((c) => c.trim().toLowerCase());
  const all = (set: string[]) => lower.length >= 4 && lower.every((c) => set.includes(c));
  return all(MONTHS) || all(WEEKDAYS);
}

/**
 * What to say after the question. Empty when the choices speak for themselves, the whole list
 * when it is short enough to hold in your head, and a few examples when it is not: the answer
 * mapper matches anything the schema allows, so the list was never a menu.
 */
export function spokenChoices(choices: string[], max = 3): string {
  if (isKnownSet(choices)) return '';
  if (choices.length === 1) return `The option is ${choices[0]}.`;
  if (choices.length <= max) {
    if (choices.length === 2) return `The options are ${choices[0]} or ${choices[1]}.`;
    const head = choices.slice(0, -1).join(', ');
    return `The options are ${head}, or ${choices[choices.length - 1]}.`;
  }
  const examples = choices.slice(0, max);
  const head = examples.slice(0, -1).join(', ');
  return `For example ${head}, or ${examples[examples.length - 1]}.`;
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
