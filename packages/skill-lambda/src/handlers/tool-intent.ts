import type { HandlerInput, RequestHandler } from 'ask-sdk-core';
import type { ToolManifest } from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { intentNameOf, slotValuesFor, toolForIntent } from '../manifest.js';
import { render } from '../render.js';

/** One handler for every generated intent: manifest lookup, slots, then a turn with the hint. */
export function toolIntentHandler(bridge: BridgeClient, manifest: ToolManifest): RequestHandler {
  return {
    canHandle: (input: HandlerInput) => {
      const intent = intentNameOf(input);
      return intent !== undefined && toolForIntent(manifest, intent) !== undefined;
    },
    handle: async (input: HandlerInput) => {
      const intent = intentNameOf(input) as string;
      const tool = toolForIntent(manifest, intent);
      const output = await bridge.turn(input, {
        type: 'turn',
        utterance: {
          intent,
          ...(tool ? { tool: tool.name, slots: slotValuesFor(tool, input) } : {}),
        },
      });
      return render(input, output);
    },
  };
}
