import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { AnswerHint } from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { slotValue } from '../manifest.js';
import { render } from '../render.js';
import { getPendingQuestion } from '../session-attrs.js';

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
      return (
        ANSWER_INTENTS.has(getIntentName(input.requestEnvelope)) &&
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
      // One word from any enum in any tool: the agent matches it against the pending question.
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
