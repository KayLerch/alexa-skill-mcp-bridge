import askSdk from 'ask-sdk-core';
import { screenSettingsInterceptor } from './apl/screen.js';
import { BridgeClient } from './bridge.js';
import { config, logger, manifest, runtimeArn, runtimeVersion } from './config.js';
import { answerHandler, openAnswerHandler, yesNoTurnHandler } from './handlers/answers.js';
import { freeTextHandler } from './handlers/free-text.js';
import { launchHandler } from './handlers/launch.js';
import {
  builtInHandler,
  errorHandler,
  fallbackHandler,
  helpHandler,
  repeatHandler,
  sessionEndedHandler,
  stopHandler,
} from './handlers/standard.js';
import { toolIntentHandler } from './handlers/tool-intent.js';

/**
 * The Alexa endpoint. Every handler reads the same way: build a TurnInput, call the bridge,
 * render the TurnOutput. No MCP or model logic lives here.
 */
const bridge = new BridgeClient({ config, runtimeArn, runtimeVersion, logger });

const builder = askSdk.SkillBuilders.custom()
  .addRequestHandlers(
    launchHandler(bridge, config, manifest),
    answerHandler(bridge),
    openAnswerHandler(bridge),
    toolIntentHandler(bridge, manifest),
    freeTextHandler(bridge),
    yesNoTurnHandler(bridge),
    helpHandler(config, manifest),
    repeatHandler(bridge),
    builtInHandler(bridge, config),
    stopHandler(bridge, config),
    fallbackHandler(bridge, config),
    sessionEndedHandler(bridge, logger),
  )
  .addRequestInterceptors(screenSettingsInterceptor(config))
  .addErrorHandlers(errorHandler(logger))
  .withApiClient(new askSdk.DefaultApiClient())
  .withCustomUserAgent('alexa-skill-mcp-bridge');

// Defense in depth while the Lambda permission is open (plan D15).
if (config.skill.id) builder.withSkillId(config.skill.id);

export const handler = builder.lambda();
