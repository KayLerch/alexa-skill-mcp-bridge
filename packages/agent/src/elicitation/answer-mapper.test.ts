import { describe, expect, it } from 'vitest';
import { mapAnswer, parseSpokenNumber } from './answer-mapper.js';
import type { QuestionSpec } from './question.js';

const q = (partial: Partial<QuestionSpec>): QuestionSpec => ({
  property: 'p',
  schema: { type: 'string' },
  message: 'm',
  expects: 'text',
  required: true,
  ...partial,
});

describe('mapAnswer yesNo', () => {
  const question = q({ expects: 'yesNo', schema: { type: 'boolean' } });
  it('uses the explicit flag, then the slot, then words', () => {
    expect(mapAnswer({ yesNo: true }, question)).toEqual({ ok: true, value: true });
    expect(
      mapAnswer(
        { slots: { a: { value: 'nope', resolvedValue: 'no', slotType: 'YesNoType' } } },
        question,
      ),
    ).toEqual({
      ok: true,
      value: false,
    });
    expect(mapAnswer({ text: 'yeah sure' }, question)).toEqual({ ok: true, value: true });
    expect(mapAnswer({ text: 'maybe' }, question)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('mapAnswer number', () => {
  const question = q({ expects: 'number', schema: { type: 'integer', minimum: 1, maximum: 6 } });
  it('reads AMAZON.NUMBER slots and spoken numbers', () => {
    expect(
      mapAnswer({ slots: { n: { value: '2', slotType: 'AMAZON.NUMBER' } } }, question),
    ).toEqual({ ok: true, value: 2 });
    expect(mapAnswer({ text: 'two' }, question)).toEqual({ ok: true, value: 2 });
    expect(mapAnswer({ text: 'for 3 people' }, question)).toEqual({ ok: true, value: 3 });
  });
  it('enforces integer and range rules', () => {
    expect(mapAnswer({ text: 'nine' }, question)).toMatchObject({
      ok: false,
      detail: 'must be at most 6',
    });
    expect(mapAnswer({ text: '2.5' }, question)).toMatchObject({
      ok: false,
      detail: 'expected a whole number',
    });
    expect(mapAnswer({ text: 'a few' }, question)).toMatchObject({
      ok: false,
      reason: 'needs-model',
    });
  });
});

describe('mapAnswer date', () => {
  const question = q({ expects: 'date', schema: { type: 'string', format: 'date' } });
  it('accepts a full AMAZON.DATE and rejects partial ones', () => {
    expect(
      mapAnswer({ slots: { d: { value: '2026-10-05', slotType: 'AMAZON.DATE' } } }, question),
    ).toEqual({ ok: true, value: '2026-10-05' });
    expect(
      mapAnswer({ slots: { d: { value: '2026-10', slotType: 'AMAZON.DATE' } } }, question),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(mapAnswer({ text: 'next Friday' }, question)).toMatchObject({
      ok: false,
      reason: 'needs-model',
    });
    expect(mapAnswer({ text: '2026-12-24' }, question)).toEqual({ ok: true, value: '2026-12-24' });
  });
});

describe('mapAnswer choice', () => {
  const question = q({
    expects: 'choice',
    schema: {
      type: 'string',
      oneOf: [
        { const: 'std', title: 'Standard' },
        { const: 'ste', title: 'Suite' },
      ],
    },
    choices: ['Standard', 'Suite'],
  });
  it('matches entity resolution first, then spoken text', () => {
    expect(
      mapAnswer(
        { slots: { c: { value: 'sweet', resolvedValue: 'Suite', slotType: 'RoomType' } } },
        question,
      ),
    ).toEqual({ ok: true, value: 'ste' });
    expect(mapAnswer({ text: 'standard please' }, question)).toEqual({ ok: true, value: 'std' });
    expect(mapAnswer({ text: 'the cheap one' }, question)).toMatchObject({
      ok: false,
      reason: 'needs-model',
    });
  });
  it('wraps multi-select values in an array', () => {
    const multi = q({
      expects: 'choice',
      schema: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    });
    expect(mapAnswer({ text: 'b' }, multi)).toEqual({ ok: true, value: ['b'] });
  });
});

describe('parseSpokenNumber', () => {
  it('handles words and digits', () => {
    expect(parseSpokenNumber('twenty five')).toBe(25);
    expect(parseSpokenNumber('a hundred and two')).toBe(102);
    expect(parseSpokenNumber('two thousand')).toBe(2000);
    expect(parseSpokenNumber('12 guests')).toBe(12);
    expect(parseSpokenNumber('none of them')).toBeUndefined();
  });
});
