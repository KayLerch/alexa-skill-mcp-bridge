import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { BridgeConfig, ToolManifest } from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { greeting } from '../greeting.js';
import { render } from '../render.js';

const { getRequestType } = askSdk;

/**
 * LaunchRequest: send warmup and wait up to the budget. Warm runtime: greet and stay open.
 * Cold runtime: speak the cold-start line and end the session; provisioning continues.
 */
export function launchHandler(
  bridge: BridgeClient,
  config: BridgeConfig,
  manifest: ToolManifest,
): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => getRequestType(input.requestEnvelope) === 'LaunchRequest',
    handle: async (input: HandlerInput) => {
      const output = await bridge.turn(input, { type: 'warmup' });
      if (output.status === 'pending') {
        return render(input, output, { speech: config.skill.coldStartMessage, endSession: true });
      }
      if (output.status === 'error') {
        return render(input, output, { endSession: true });
      }
      return render(input, output, { speech: greeting(config, manifest), endSession: false });
    },
  };
}
