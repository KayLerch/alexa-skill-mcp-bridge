import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { BridgeConfig, ToolManifest, TurnInput } from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { greeting } from '../greeting.js';
import { render } from '../render.js';

const { getRequestType } = askSdk;

/**
 * LaunchRequest. With skill.launch the agent warms up and calls that tool directly (D57): its
 * spoken line and screen open the session, and its end-session field may close it. Without it,
 * or when the call gives nothing to say, a warm-up and the greeting. Cold runtime: the cold-start
 * line, and the session ends while provisioning continues. Not linked yet (account linking on,
 * no token): the link prompt.
 */
export function launchHandler(
  bridge: BridgeClient,
  config: BridgeConfig,
  manifest: ToolManifest,
): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => getRequestType(input.requestEnvelope) === 'LaunchRequest',
    handle: async (input: HandlerInput) => {
      const launch = config.skill.launch;
      const turn: TurnInput = launch
        ? {
            type: 'tool',
            tool: launch.tool,
            ...(launch.arguments ? { arguments: launch.arguments } : {}),
            intent: 'LaunchRequest',
          }
        : { type: 'warmup' };
      const output = await bridge.turn(input, turn);
      if (output.linkAccount) return render(input, output);
      if (output.status === 'pending') {
        return render(input, output, { speech: config.skill.coldStartMessage, endSession: true });
      }
      if (output.status === 'error') {
        return render(input, output, { endSession: true });
      }
      if (output.speech) return render(input, output);
      return render(input, output, { speech: greeting(config, manifest), endSession: false });
    },
  };
}
