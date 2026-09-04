import { describe, expect, it } from 'vitest';
import { escape, render } from '../src/render.js';
import { getPendingQuestion, isAwaitingResult } from '../src/session-attrs.js';
import { handlerInput } from './helpers.js';

describe('render', () => {
  it('wraps speech in SSML with escaping and sets a reprompt when the session stays open', () => {
    const input = handlerInput();
    const response = render(input, {
      status: 'done',
      speech: 'Fish & chips <cost> "ten" euros. Want more?',
      reprompt: 'Want more?',
      endSession: false,
      visual: null,
    });
    expect(response.outputSpeech).toEqual({
      type: 'SSML',
      ssml: '<speak>Fish &amp; chips &lt;cost&gt; &quot;ten&quot; euros. Want more?</speak>',
    });
    expect(response.reprompt?.outputSpeech).toEqual({
      type: 'SSML',
      ssml: '<speak>Want more?</speak>',
    });
    expect(response.shouldEndSession).toBe(false);
  });

  it('ends the session without a reprompt', () => {
    const response = render(handlerInput(), {
      status: 'done',
      speech: 'Bye.',
      endSession: true,
      visual: null,
    });
    expect(response.reprompt).toBeUndefined();
    expect(response.shouldEndSession).toBe(true);
  });

  it('stores the pending question and clears it on the next result', () => {
    const input = handlerInput();
    render(input, {
      status: 'question',
      speech: 'How many guests?',
      reprompt: 'How many guests?',
      question: { id: 'q1', source: 'elicitation', message: 'How many guests?', expects: 'number' },
      endSession: false,
      visual: null,
    });
    expect(getPendingQuestion(input)).toEqual({
      id: 'q1',
      source: 'elicitation',
      message: 'How many guests?',
      expects: 'number',
    });
    expect(isAwaitingResult(input)).toBe(false);

    render(input, { status: 'done', speech: 'Done.', endSession: true, visual: null });
    expect(getPendingQuestion(input)).toBeUndefined();
  });

  it('marks an outstanding result while pending', () => {
    const input = handlerInput();
    render(input, { status: 'pending', speech: 'Still working.', endSession: false, visual: null });
    expect(isAwaitingResult(input)).toBe(true);
  });

  it('applies prefix and speech overrides', () => {
    const response = render(
      handlerInput(),
      { status: 'done', speech: 'agent text', endSession: false, visual: null },
      { prefix: 'Earlier:', speech: 'Welcome.' },
    );
    expect(response.outputSpeech).toEqual({
      type: 'SSML',
      ssml: '<speak>Earlier: Welcome.</speak>',
    });
  });

  it('escapes the four SSML-sensitive characters only', () => {
    expect(escape(`it's 5 > 3 & "x" <y>`)).toBe(`it's 5 &gt; 3 &amp; &quot;x&quot; &lt;y&gt;`);
  });
});
