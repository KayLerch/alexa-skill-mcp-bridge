import type { HandlerInput } from 'ask-sdk-core';
import type { Response } from 'ask-sdk-model';
import type { TurnOutput } from '@alexa-mcp-bridge/core';
import { MAX_RESPONSE_BYTES, screenDirective, supportsApl } from './apl/screen.js';
import { REPROMPT } from './greeting.js';
import {
  setAwaitingResult,
  setLastOutput,
  setOpenTurn,
  setPendingQuestion,
} from './session-attrs.js';

/**
 * TurnOutput → Alexa response. Speech becomes SSML with light escaping, a reprompt keeps the
 * microphone open whenever the session stays open, and session attributes track a pending
 * question or an outstanding result for the next request. An output that asks the user to link
 * their account adds the LinkAccount card. A visual on an APL device adds one RenderDocument (D55).
 */
export interface RenderOptions {
  /** Spoken before the agent's speech (a fetched result, a greeting). */
  prefix?: string;
  /** Override the agent's speech entirely (cold-start, goodbye). */
  speech?: string;
  endSession?: boolean;
  /**
   * Keep this response out of "repeat" (D59): a re-ask after a missed answer or a help text
   * leaves the last real output in place. Default true.
   */
  remember?: boolean;
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
  // Open for a spoken answer as an ordinary turn (D49) unless the session ends or a question is parked.
  setOpenTurn(input, !endSession && output.status !== 'question');

  const reprompt = output.reprompt ?? (output.status === 'question' ? speech : REPROMPT);
  // "Still working on it" is not worth repeating; the last real answer is.
  if (!endSession && speech && output.status !== 'pending' && options.remember !== false) {
    setLastOutput(input, { speech, reprompt });
  }

  const builder = input.responseBuilder;
  if (speech) builder.speak(ssml(speech));
  if (!endSession) builder.reprompt(ssml(reprompt));
  // The card in the Alexa app is where the user links their account (D48).
  if (output.linkAccount) builder.withLinkAccountCard();
  const response = builder.withShouldEndSession(endSession).getResponse();
  if (output.visual && supportsApl(input)) {
    const directive = screenDirective(output.visual);
    // Alexa refuses a response over 120 KB; the picture goes, the speech stays (D55).
    const sessionAttributes = input.attributesManager.getSessionAttributes();
    const size = Buffer.byteLength(
      JSON.stringify({ response: { ...response, directives: [directive] }, sessionAttributes }),
    );
    if (size <= MAX_RESPONSE_BYTES) response.directives = [directive];
  }
  return response;
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
