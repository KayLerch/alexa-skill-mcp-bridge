import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { BridgeClient } from '../bridge.js';
import { render } from '../render.js';

const { getRequestType, getIntentName, getSlotValue } = askSdk;

/** "ask {query}", "tell {query}": the closest thing to how Alexa+ receives requests. */
export function freeTextHandler(bridge: BridgeClient): RequestHandler {
  return {
    canHandle: (input: HandlerInput) =>
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'FreeTextIntent',
    handle: async (input: HandlerInput) => {
      const text = getSlotValue(input.requestEnvelope, 'query') ?? '';
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: { intent: 'FreeTextIntent', ...(text ? { text } : {}) },
      });
      return render(input, output);
    },
  };
}
