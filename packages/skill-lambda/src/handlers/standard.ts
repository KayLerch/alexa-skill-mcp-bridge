import type { ErrorHandler, HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import {
  SPOKEN,
  errorFields,
  type BridgeConfig,
  type Logger,
  type ToolManifest,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { helpText } from '../greeting.js';
import { render, ssml } from '../render.js';
import { getPendingQuestion } from '../session-attrs.js';

const { getRequestType, getIntentName } = askSdk;

const isIntent = (input: HandlerInput, ...names: string[]) =>
  getRequestType(input.requestEnvelope) === 'IntentRequest' &&
  names.includes(getIntentName(input.requestEnvelope));

export function helpHandler(config: BridgeConfig, manifest: ToolManifest): RequestHandler {
  return {
    canHandle: (input) => isIntent(input, 'AMAZON.HelpIntent'),
    handle: async (input) => {
      const pending = getPendingQuestion(input);
      const speech = pending
        ? `${helpText(config, manifest)} Right now I am waiting for an answer: ${pending.message}`
        : helpText(config, manifest);
      return render(input, done(speech, false), { speech, endSession: false });
    },
  };
}

/** Stop, Cancel, NavigateHome: cancel whatever is pending, then goodbye. */
export function stopHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input) =>
      isIntent(input, 'AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'),
    handle: async (input) => {
      const output = await bridge.turn(input, { type: 'cancel' });
      return render(input, output, { speech: SPOKEN.goodbye, endSession: true });
    },
  };
}

/** Fallback: with a question pending, ask it again; otherwise let the agent ask what was meant. */
export function fallbackHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input) => isIntent(input, 'AMAZON.FallbackIntent'),
    handle: async (input) => {
      const pending = getPendingQuestion(input);
      if (pending) {
        const speech = `${SPOKEN.questionRepeat} ${pending.message}`;
        return render(input, question(pending, speech));
      }
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: { intent: 'AMAZON.FallbackIntent' },
      });
      return render(input, output);
    },
  };
}

export function sessionEndedHandler(bridge: BridgeClient, logger: Logger): RequestHandler {
  return {
    canHandle: (input) => getRequestType(input.requestEnvelope) === 'SessionEndedRequest',
    handle: async (input) => {
      const reason = (input.requestEnvelope.request as { reason?: string }).reason;
      logger.info('session ended', { reason });
      await bridge.turn(input, { type: 'cancel' });
      return input.responseBuilder.getResponse();
    },
  };
}

/** Anything unhandled: log the cause, speak a short apology, end the session. */
export function errorHandler(logger: Logger): ErrorHandler {
  return {
    canHandle: () => true,
    handle: async (input, error) => {
      logger.error('unhandled error', errorFields(error));
      return input.responseBuilder
        .speak(ssml(SPOKEN.error))
        .withShouldEndSession(true)
        .getResponse();
    },
  };
}

function done(speech: string, endSession: boolean): TurnOutput {
  return { status: 'done', speech, endSession, visual: null };
}

function question(
  pending: {
    id: string;
    expects: TurnOutput['question'] extends infer Q
      ? Q extends { expects: infer E }
        ? E
        : never
      : never;
    source: 'elicitation' | 'agent';
    message: string;
  },
  speech: string,
): TurnOutput {
  return {
    status: 'question',
    speech,
    reprompt: pending.message,
    question: {
      id: pending.id,
      expects: pending.expects,
      source: pending.source,
      message: pending.message,
    },
    endSession: false,
    visual: null,
  };
}
