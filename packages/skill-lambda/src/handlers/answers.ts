import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import { spelledLetterOf, type AnswerHint } from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { slotValue } from '../manifest.js';
import { render } from '../render.js';
import { getPendingQuestion, hasOpenTurn } from '../session-attrs.js';

const { getRequestType, getIntentName, getSlot } = askSdk;

const ANSWER_INTENTS = new Set([
  'AMAZON.YesIntent',
  'AMAZON.NoIntent',
  'DateAnswerIntent',
  'NumberAnswerIntent',
  'ChoiceAnswerIntent',
  'FreeTextAnswerIntent',
]);

/**
 * Answer intents fire only while a question is pending. Without one, Yes and No fall through
 * to the agent as a turn and the other answer intents never match (Alexa routes elsewhere).
 */
export function answerHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => {
      if (getRequestType(input.requestEnvelope) !== 'IntentRequest') return false;
      const name = getIntentName(input.requestEnvelope);
      return (
        (ANSWER_INTENTS.has(name) || spelledLetterOf(name) !== undefined) &&
        getPendingQuestion(input) !== undefined
      );
    },
    handle: async (input: HandlerInput) => {
      const pending = getPendingQuestion(input);
      if (!pending) throw new Error('answer handler without a pending question');
      const output = await bridge.turn(input, {
        type: 'answer',
        questionId: pending.id,
        answer: answerHintFor(input, getIntentName(input.requestEnvelope)),
      });
      return render(input, output);
    },
  };
}

export function answerHintFor(input: HandlerInput, intentName: string): AnswerHint {
  const letter = spelledLetterOf(intentName);
  if (letter) return { text: letter };
  switch (intentName) {
    case 'AMAZON.YesIntent':
      return { yesNo: true };
    case 'AMAZON.NoIntent':
      return { yesNo: false };
    case 'DateAnswerIntent': {
      const value = slotValue(getSlot(input.requestEnvelope, 'date'), 'AMAZON.DATE');
      return value ? { slots: { date: value } } : {};
    }
    case 'NumberAnswerIntent': {
      const value = slotValue(getSlot(input.requestEnvelope, 'number'), 'AMAZON.NUMBER');
      return value ? { slots: { number: value } } : {};
    }
    case 'ChoiceAnswerIntent': {
      // A value of any tool enum or answers.choices: the canonical value when entity resolution
      // matched ("b" for "bee", D67), and the agent matches it against the pending question.
      const value = slotValue(getSlot(input.requestEnvelope, 'choice'), 'AnswerChoiceType');
      return value ? { slots: { choice: value }, text: value.resolvedValue ?? value.value } : {};
    }
    default: {
      const value = slotValue(getSlot(input.requestEnvelope, 'answer'), 'AMAZON.SearchQuery');
      return value ? { text: value.value } : {};
    }
  }
}

/** Yes and No without a pending question are ordinary turns for the agent. */
export function yesNoTurnHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => {
      if (getRequestType(input.requestEnvelope) !== 'IntentRequest') return false;
      const name = getIntentName(input.requestEnvelope);
      return (
        (name === 'AMAZON.YesIntent' || name === 'AMAZON.NoIntent') &&
        getPendingQuestion(input) === undefined
      );
    },
    handle: async (input: HandlerInput) => {
      const yes = getIntentName(input.requestEnvelope) === 'AMAZON.YesIntent';
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: { intent: getIntentName(input.requestEnvelope), text: yes ? 'yes' : 'no' },
      });
      return render(input, output);
    },
  };
}

const SPOKEN_SLOT: Record<string, { name: string; type: string }> = {
  DateAnswerIntent: { name: 'date', type: 'AMAZON.DATE' },
  NumberAnswerIntent: { name: 'number', type: 'AMAZON.NUMBER' },
  ChoiceAnswerIntent: { name: 'choice', type: 'AnswerChoiceType' },
  FreeTextAnswerIntent: { name: 'answer', type: 'AMAZON.SearchQuery' },
};

/**
 * A quiz's question is the agent's own speech, not a parked elicitation (D49). An answer intent
 * with no pending question while the session is open is an ordinary turn carrying what the user
 * said, as Alexa gives it:
 * - a custom slot (ChoiceAnswerIntent): the canonical value when entity resolution matched
 *   ("b" for "bee", "blue" for "the blue one", D67), else the words as heard;
 * - free text (AMAZON.SearchQuery): the words as heard;
 * - AMAZON.DATE and AMAZON.NUMBER: only their resolved value ("2026-10-14" for "the fourteenth",
 *   "14"), so a server that grades spoken answers should accept ISO dates and digits (D64).
 */
export function openAnswerHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => {
      if (getRequestType(input.requestEnvelope) !== 'IntentRequest') return false;
      const name = getIntentName(input.requestEnvelope);
      return (
        (name in SPOKEN_SLOT || spelledLetterOf(name) !== undefined) &&
        getPendingQuestion(input) === undefined &&
        hasOpenTurn(input)
      );
    },
    handle: async (input: HandlerInput) => {
      const intent = getIntentName(input.requestEnvelope);
      const mapping = SPOKEN_SLOT[intent];
      const value = mapping
        ? slotValue(getSlot(input.requestEnvelope, mapping.name), mapping.type)
        : undefined;
      // A spelled-letter intent carries no slot: its name is the answer (D74).
      const text = spelledLetterOf(intent) ?? value?.resolvedValue ?? value?.value;
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: { ...(text ? { text } : {}) },
      });
      return render(input, output);
    },
  };
}
