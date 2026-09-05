import { describe, expect, it } from 'vitest';
import {
  choiceValueFor,
  choicesFor,
  expectsFor,
  planElicitation,
  spokenChoices,
} from './question.js';

const form = (
  properties: Record<string, unknown>,
  required: string[] = [],
  message = 'Tell me more.',
) =>
  planElicitation({
    mode: 'form',
    message,
    requestedSchema: { type: 'object', properties, required },
  } as never);

describe('expectsFor', () => {
  it('derives the answer kind from the property schema', () => {
    expect(expectsFor({ type: 'boolean' })).toBe('yesNo');
    expect(expectsFor({ type: 'integer' })).toBe('number');
    expect(expectsFor({ type: 'number' })).toBe('number');
    expect(expectsFor({ type: 'string', format: 'date' })).toBe('date');
    expect(expectsFor({ type: 'string', enum: ['a', 'b'] })).toBe('choice');
    expect(expectsFor({ type: 'string', oneOf: [{ const: 'a', title: 'A' }] })).toBe('choice');
    expect(expectsFor({ type: 'string' })).toBe('text');
  });
});

describe('planElicitation', () => {
  it('speaks a single-property message as-is and derives expects', () => {
    const plan = form(
      { guests: { type: 'integer', title: 'Guests', minimum: 1, maximum: 6 } },
      ['guests'],
      'How many guests will be staying?',
    );
    expect(plan.mode).toBe('form');
    if (plan.mode !== 'form') return;
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]).toMatchObject({
      property: 'guests',
      expects: 'number',
      required: true,
      message: 'How many guests will be staying?',
    });
  });

  it('orders required properties first and asks one at a time', () => {
    const plan = form(
      {
        notes: { type: 'string', title: 'Notes' },
        checkIn: { type: 'string', format: 'date', title: 'Check-in' },
        smoking: { type: 'boolean', title: 'Smoking room' },
      },
      ['checkIn', 'smoking'],
      'I need a few details.',
    );
    if (plan.mode !== 'form') throw new Error();
    expect(plan.questions.map((q) => q.property)).toEqual(['checkIn', 'smoking', 'notes']);
    expect(plan.questions[0]?.message).toBe('I need a few details. First, what date for check-in?');
    expect(plan.questions[1]?.message).toBe('Smoking room? Yes or no?');
    expect(plan.questions[2]?.message).toBe('What is the notes?');
  });

  it('appends spoken choices for enums, using titles when present', () => {
    const plan = form(
      {
        room: {
          type: 'string',
          oneOf: [
            { const: 'std', title: 'Standard' },
            { const: 'ste', title: 'Suite' },
          ],
        },
      },
      ['room'],
      'Which room type?',
    );
    if (plan.mode !== 'form') throw new Error();
    expect(plan.questions[0]?.message).toBe('Which room type? The options are Standard or Suite.');
    expect(plan.questions[0]?.choices).toEqual(['Standard', 'Suite']);
  });

  it('reports URL mode so the caller can decline it', () => {
    const plan = planElicitation({
      mode: 'url',
      elicitationId: 'e1',
      url: 'https://example.com/auth',
      message: 'Please sign in.',
    } as never);
    expect(plan).toEqual({
      mode: 'url',
      url: 'https://example.com/auth',
      message: 'Please sign in.',
    });
  });
});

describe('choices', () => {
  it('maps spoken labels back to values', () => {
    const titled = {
      type: 'string',
      oneOf: [
        { const: 'std', title: 'Standard' },
        { const: 'ste', title: 'Suite' },
      ],
    };
    expect(choicesFor(titled)).toEqual(['Standard', 'Suite']);
    expect(choiceValueFor(titled, 'suite')).toBe('ste');
    expect(choiceValueFor(titled, 'the suite please')).toBe('ste');
    const plain = { type: 'string', enum: ['red', 'green'], enumNames: ['Red', 'Green'] };
    expect(choiceValueFor(plain, 'Green')).toBe('green');
    expect(choiceValueFor(plain, 'blue')).toBeUndefined();
    const multi = { type: 'array', items: { type: 'string', enum: ['a', 'b'] } };
    expect(expectsFor(multi)).toBe('choice');
    expect(choiceValueFor(multi, 'b')).toBe('b');
  });
});

describe('voice rules for choices', () => {
  const elicit = (values: string[], message = 'Pick one.') =>
    planElicitation(
      {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: { pick: { type: 'string', enum: values } },
          required: ['pick'],
        },
      } as never,
      { maxChoicesSpoken: 3 },
    );

  it('reads a short list in full', () => {
    expect(spokenChoices(['hiking', 'fishing'], 3)).toBe('The options are hiking or fishing.');
    expect(spokenChoices(['a', 'b', 'c'], 3)).toBe('The options are a, b, or c.');
  });

  it('offers examples instead of reading a long list', () => {
    const eleven = ['hiking', 'wildlife watching', 'fishing', 'stargazing', 'paddling', 'biking'];
    expect(spokenChoices(eleven, 3)).toBe('For example hiking, wildlife watching, or fishing.');
  });

  it('says nothing extra for a set the listener already knows', () => {
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    expect(spokenChoices(months, 3)).toBe('');
    const plan = elicit(months, 'Which month are you thinking of?');
    if (plan.mode !== 'form') throw new Error('expected a form');
    expect(plan.questions[0]?.message).toBe('Which month are you thinking of?');
    // The value list is still there for the answer mapper, only the speech is shorter.
    expect(plan.questions[0]?.choices).toHaveLength(12);
  });

  it('cleans up a server message written for a screen', () => {
    const plan = elicit(['a', 'b'], 'Pick one. See **the guide** at https://example.com/help 🙂');
    if (plan.mode !== 'form') throw new Error('expected a form');
    expect(plan.questions[0]?.message).toBe(
      'Pick one. See the guide at a link The options are a or b.',
    );
  });
});
