import type { HandlerInput } from 'ask-sdk-core';
import type { Response } from 'ask-sdk-model';
import type { TurnOutput } from '@alexa-mcp-bridge/core';
import { REPROMPT } from './greeting.js';
import { setAwaitingResult, setPendingQuestion } from './session-attrs.js';

/**
 * TurnOutput → Alexa response. Speech becomes SSML with light escaping, a reprompt keeps the
 * microphone open whenever the session stays open, and session attributes track a pending
 * question or an outstanding result for the next request.
 */
export interface RenderOptions {
  /** Spoken before the agent's speech (a fetched result, a greeting). */
  prefix?: string;
  /** Override the agent's speech entirely (cold-start, goodbye). */
  speech?: string;
  endSession?: boolean;
}

export function render(
  input: HandlerInput,
  output: TurnOutput,
  options: RenderOptions = {},
): Response {
  const speech = [options.prefix, options.speech ?? output.speech].filter(Boolean).join(' ').trim();
  const endSession = options.endSession ?? output.endSession;

  setPendingQuestion(input, output.status === 'question' ? output.question : undefined);
  setAwaitingResult(input, output.status === 'pending');

  const builder = input.responseBuilder;
  if (speech) builder.speak(ssml(speech));
  if (!endSession)
    builder.reprompt(ssml(output.reprompt ?? (output.status === 'question' ? speech : REPROMPT)));
  return builder.withShouldEndSession(endSession).getResponse();
}

export function ssml(text: string): string {
  return `<speak>${escape(text)}</speak>`;
}

export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
