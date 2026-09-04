import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@alexa-mcp-bridge/core';
import { QuestionQueue } from './queue.js';

const logger = createLogger({}, { write: () => undefined });
const guestsParams = {
  mode: 'form' as const,
  message: 'How many guests?',
  requestedSchema: {
    type: 'object' as const,
    properties: { guests: { type: 'integer' as const, minimum: 1, maximum: 6 } },
    required: ['guests'],
  },
};

describe('QuestionQueue', () => {
  it('parks an elicitation and resolves it with the accumulated answers', async () => {
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => 'q1' });
    const result = queue.elicit(guestsParams);
    const current = queue.current();
    expect(current).toMatchObject({
      id: 'q1',
      source: 'elicitation',
      expects: 'number',
      message: 'How many guests?',
    });
    expect(queue.answer('q1', 2)).toEqual({});
    await expect(result).resolves.toEqual({ action: 'accept', content: { guests: 2 } });
    expect(queue.current()).toBeUndefined();
  });

  it('asks multi-property forms one question at a time', async () => {
    let n = 0;
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => `q${++n}` });
    const result = queue.elicit({
      mode: 'form',
      message: 'Details please.',
      requestedSchema: {
        type: 'object',
        properties: { city: { type: 'string' }, nights: { type: 'integer' } },
        required: ['city', 'nights'],
      },
    });
    expect(queue.current()?.property).toBe('city');
    const { next } = queue.answer('q1', 'Berlin');
    expect(next?.property).toBe('nights');
    expect(queue.current()?.id).toBe('q2');
    queue.answer('q2', 3);
    await expect(result).resolves.toEqual({
      action: 'accept',
      content: { city: 'Berlin', nights: 3 },
    });
  });

  it('queues a second elicitation behind the first', async () => {
    let n = 0;
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => `q${++n}` });
    const first = queue.elicit(guestsParams);
    const second = queue.elicit({ ...guestsParams, message: 'Second?' });
    expect(queue.size).toBe(2);
    expect(queue.current()?.message).toBe('How many guests?');
    queue.answer('q1', 1);
    await first;
    expect(queue.current()?.message).toBe('Second?');
    queue.answer('q2', 4);
    await expect(second).resolves.toMatchObject({ action: 'accept' });
  });

  it('declines, cancels, and declines url mode', async () => {
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => 'q1' });
    const declined = queue.elicit(guestsParams);
    queue.decline('q1');
    await expect(declined).resolves.toEqual({ action: 'decline' });

    const cancelled = queue.elicit(guestsParams);
    queue.cancelAll('test');
    await expect(cancelled).resolves.toEqual({ action: 'cancel' });

    await expect(
      queue.elicit({ mode: 'url', elicitationId: 'e', url: 'https://x', message: 'sign in' }),
    ).resolves.toEqual({ action: 'decline' });
  });

  it('rejects answers for a question that is not current', () => {
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => 'q1' });
    void queue.elicit(guestsParams);
    expect(() => queue.answer('stale', 1)).toThrow(/not the current question/);
  });

  it('cancels on answer timeout', async () => {
    vi.useFakeTimers();
    try {
      const queue = new QuestionQueue({ answerTimeoutMs: 500, logger });
      const result = queue.elicit(guestsParams);
      vi.advanceTimersByTime(600);
      await expect(result).resolves.toEqual({ action: 'cancel' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves ask_user questions and wakes waiters', async () => {
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger, makeId: () => 'a1' });
    const waiter = queue.waitForQuestion(new AbortController().signal);
    const answer = queue.askUser({ message: 'Which city?', expects: 'text' });
    const q = await waiter;
    expect(q).toMatchObject({ id: 'a1', source: 'agent', expects: 'text' });
    expect(queue.toQuestion(q)).toEqual({
      id: 'a1',
      source: 'agent',
      message: 'Which city?',
      schema: { type: 'string' },
      expects: 'text',
    });
    queue.answer('a1', 'Berlin');
    await expect(answer).resolves.toEqual({ answered: true, text: 'Berlin' });
  });

  it('aborts a waiter', async () => {
    const queue = new QuestionQueue({ answerTimeoutMs: 10_000, logger });
    const ac = new AbortController();
    const waiter = queue.waitForQuestion(ac.signal);
    ac.abort(new Error('deadline'));
    await expect(waiter).rejects.toThrow('deadline');
  });
});
