import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { BridgeClient } from '../bridge.js';
import { render } from '../render.js';

const { getRequestType, getIntentName, getSlotValue } = askSdk;

const FREE_TEXT_INTENTS: Record<string, string> = {
  FreeTextIntent: 'query', // "ask {query}": AMAZON.SearchQuery behind a carrier phrase
  SpokenRequestIntent: 'request', // "{request}": the catch-all custom slot, no carrier needed
};

/** Whole phrases handed to the agent as text: the closest thing to how Alexa+ receives requests. */
export function freeTextHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input: HandlerInput) =>
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) in FREE_TEXT_INTENTS,
    handle: async (input: HandlerInput) => {
      const intent = getIntentName(input.requestEnvelope);
      const text = getSlotValue(input.requestEnvelope, FREE_TEXT_INTENTS[intent] as string) ?? '';
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: { intent, ...(text ? { text } : {}) },
      });
      return render(input, output);
    },
  };
}
