import type { AnswerHint, SlotValue } from '@alexa-mcp-bridge/core';
import { choiceValueFor, type QuestionSpec } from './question.js';

/**
 * Deterministic answer → typed value mapping (plan D6). The model is only consulted
 * (elsewhere) for free-text answers against typed properties when this returns 'needs-model'.
 */

export type MappedAnswer =
  | { ok: true; value: string | number | boolean | string[] }
  | { ok: false; reason: 'needs-model' | 'invalid'; detail: string };

export function mapAnswer(answer: AnswerHint, question: QuestionSpec): MappedAnswer {
  const spoken = spokenText(answer);
  switch (question.expects) {
    case 'yesNo':
      return mapYesNo(answer, spoken);
    case 'number':
      return mapNumber(answer, spoken, question);
    case 'date':
      return mapDate(answer, spoken);
    case 'choice':
      return mapChoice(answer, spoken, question);
    case 'text':
      return spoken ? { ok: true, value: spoken } : invalid('no text in the answer');
  }
}

/** What the user said, best effort: free text, otherwise the first slot value. */
export function spokenText(answer: AnswerHint): string {
  if (answer.text?.trim()) return answer.text.trim();
  const slot = firstSlot(answer);
  if (slot) return (slot.resolvedValue ?? slot.value).trim();
  if (answer.yesNo !== undefined) return answer.yesNo ? 'yes' : 'no';
  return '';
}

function firstSlot(answer: AnswerHint): SlotValue | undefined {
  const values = Object.values(answer.slots ?? {});
  return values.find((s) => s.value?.trim());
}

const YES = /^(yes|yeah|yep|yup|sure|correct|right|ok|okay|affirmative|please do|of course)\b/i;
const NO = /^(no|nope|nah|negative|don't|do not|not really)\b/i;

function mapYesNo(answer: AnswerHint, spoken: string): MappedAnswer {
  if (answer.yesNo !== undefined) return { ok: true, value: answer.yesNo };
  const slot = firstSlot(answer);
  const resolved = slot?.resolvedValue?.toLowerCase() ?? slot?.resolvedId?.toLowerCase();
  if (resolved === 'yes') return { ok: true, value: true };
  if (resolved === 'no') return { ok: true, value: false };
  if (YES.test(spoken)) return { ok: true, value: true };
  if (NO.test(spoken)) return { ok: true, value: false };
  return invalid('expected yes or no');
}

function mapNumber(answer: AnswerHint, spoken: string, question: QuestionSpec): MappedAnswer {
  const slot = firstSlot(answer);
  const candidate =
    slot?.slotType === 'AMAZON.NUMBER' ? Number(slot.value) : parseSpokenNumber(spoken);
  if (candidate === undefined || Number.isNaN(candidate)) {
    return spoken
      ? needsModel('no number found in the answer')
      : invalid('no number in the answer');
  }
  const schema = question.schema;
  if (schema.type === 'integer' && !Number.isInteger(candidate))
    return invalid('expected a whole number');
  if (typeof schema.minimum === 'number' && candidate < schema.minimum) {
    return invalid(`must be at least ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && candidate > schema.maximum) {
    return invalid(`must be at most ${schema.maximum}`);
  }
  return { ok: true, value: candidate };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function mapDate(answer: AnswerHint, spoken: string): MappedAnswer {
  const slot = firstSlot(answer);
  const raw = slot?.slotType === 'AMAZON.DATE' ? slot.value : spoken;
  if (ISO_DATE.test(raw)) return { ok: true, value: raw };
  // AMAZON.DATE can resolve to a month (2026-10), a week (2026-W41), or a season; not a full date.
  if (slot?.slotType === 'AMAZON.DATE') return invalid('needs a full date with a day');
  return spoken ? needsModel('date given as free text') : invalid('no date in the answer');
}

function mapChoice(answer: AnswerHint, spoken: string, question: QuestionSpec): MappedAnswer {
  const slot = firstSlot(answer);
  const candidates = [slot?.resolvedValue, slot?.resolvedId, spoken].filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );
  for (const c of candidates) {
    const value = choiceValueFor(question.schema, c);
    if (value !== undefined) {
      return { ok: true, value: question.schema.type === 'array' ? [value] : value };
    }
  }
  return spoken ? needsModel('answer did not match a choice') : invalid('no choice in the answer');
}

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** "two", "twenty five", "3", "for 4 people" → number. Undefined when nothing numeric is present. */
export function parseSpokenNumber(text: string): number | undefined {
  const digits = text.match(/-?\d+(?:[.,]\d+)?/);
  if (digits) return Number(digits[0].replace(',', '.'));
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in SMALL) {
      current += SMALL[w] as number;
      seen = true;
    } else if (w === 'hundred') {
      current = Math.max(current, 1) * 100;
      seen = true;
    } else if (w === 'thousand') {
      total += Math.max(current, 1) * 1000;
      current = 0;
      seen = true;
    } else if (seen && w !== 'and') {
      break;
    }
  }
  return seen ? total + current : undefined;
}

function invalid(detail: string): MappedAnswer {
  return { ok: false, reason: 'invalid', detail };
}

function needsModel(detail: string): MappedAnswer {
  return { ok: false, reason: 'needs-model', detail };
}
