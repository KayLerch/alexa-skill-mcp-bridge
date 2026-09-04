import { describe, expect, it } from 'vitest';
import { turnInputSchema, turnOutputSchema } from './turn.js';
import { agentInvocationSchema } from './invocation.js';

describe('turn contract', () => {
  it('round-trips every TurnInput variant', () => {
    const inputs = [
      { type: 'warmup' },
      { type: 'turn', utterance: { text: 'find hotels in Berlin' } },
      {
        type: 'turn',
        utterance: {
          intent: 'SearchHotelsIntent',
          tool: 'search_hotels',
          slots: { destination: { value: 'Berlin', slotType: 'AMAZON.SearchQuery' } },
        },
      },
      { type: 'answer', questionId: 'q1', answer: { text: 'two', slots: {} } },
      { type: 'answer', questionId: 'q1', answer: { yesNo: false } },
      { type: 'poll' },
      { type: 'cancel' },
    ];
    for (const input of inputs) {
      expect(turnInputSchema.parse(input)).toEqual(input);
    }
  });

  it('rejects unknown turn types', () => {
    expect(() => turnInputSchema.parse({ type: 'nope' })).toThrow();
  });

  it('keeps visual pinned to null', () => {
    const base = { status: 'done', speech: 'hi', endSession: false };
    expect(turnOutputSchema.parse({ ...base, visual: null }).visual).toBeNull();
    expect(() => turnOutputSchema.parse({ ...base, visual: {} })).toThrow();
  });

  it('parses a question output', () => {
    const out = turnOutputSchema.parse({
      status: 'question',
      speech: 'How many guests?',
      reprompt: 'How many guests?',
      question: { id: 'q', source: 'elicitation', message: 'How many guests?', expects: 'number' },
      endSession: false,
      visual: null,
    });
    expect(out.question?.expects).toBe('number');
  });
});

describe('agent invocation envelope', () => {
  it('defaults debug to false', () => {
    const inv = agentInvocationSchema.parse({
      turn: { type: 'poll' },
      actorId: 'a'.repeat(64),
      sessionId: 'b'.repeat(64),
      locale: 'en-US',
      budgetMs: 6500,
    });
    expect(inv.debug).toBe(false);
  });
});
