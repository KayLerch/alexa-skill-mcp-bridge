import type { ErrorHandler, HandlerInput, RequestHandler } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import {
  MAPPABLE_BUILT_IN_INTENTS,
  SESSION_ENDING_INTENTS,
  SPOKEN,
  errorFields,
  type BridgeConfig,
  type BuiltInAction,
  type Logger,
  type ToolManifest,
  type TurnInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import type { BridgeClient } from '../bridge.js';
import { REPROMPT, helpText } from '../greeting.js';
import { render, ssml } from '../render.js';
import {
  getLastOutput,
  getPendingQuestion,
  hasOpenTurn,
  isAwaitingResult,
} from '../session-attrs.js';

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
      // The help text is not what "repeat" should replay.
      return render(input, done(speech, false), { speech, endSession: false, remember: false });
    },
  };
}

/**
 * "Repeat" (D59): what the user heard last, from the session attributes, without asking the
 * agent. Everything else in the session stays as it was.
 */
export function repeatHandler(): RequestHandler {
  return {
    canHandle: (input) => isIntent(input, 'AMAZON.RepeatIntent'),
    handle: async (input) => {
      const last = getLastOutput(input);
      return input.responseBuilder
        .speak(ssml(last?.speech ?? REPROMPT))
        .reprompt(ssml(last?.reprompt ?? REPROMPT))
        .withShouldEndSession(false)
        .getResponse();
    },
  };
}

/**
 * Built-in intents that do not end the session ("next", "previous", "start over", "more"). Mapped
 * in intents.builtIns (D59): a direct tool call, or a text the agent hears. Unmapped: the agent
 * hears the word itself, so a built-in Alexa matched never dies in the error handler.
 */
export function builtInHandler(bridge: BridgeClient, config: BridgeConfig): RequestHandler {
  return {
    canHandle: (input) => {
      if (getRequestType(input.requestEnvelope) !== 'IntentRequest') return false;
      const name = getIntentName(input.requestEnvelope);
      return BUILT_IN_TURNS.has(name);
    },
    handle: async (input) => {
      const intent = getIntentName(input.requestEnvelope);
      const action = builtInAction(config, intent);
      if (action && 'tool' in action) {
        const output = await bridge.turn(input, toolTurn(action, intent));
        if (output.linkAccount || output.status !== 'done' || output.speech) {
          return render(input, output);
        }
        // The call left nothing to say: say so and ask the last question again.
        const reprompt = getLastOutput(input)?.reprompt ?? REPROMPT;
        const speech = `${SPOKEN.notDone} ${reprompt}`;
        return render(input, { ...done(speech, false), reprompt }, { remember: false });
      }
      const text = action?.text ?? spokenIntent(intent);
      const output = await bridge.turn(input, { type: 'turn', utterance: { intent, text } });
      return render(input, output);
    },
  };
}

/**
 * Stop, Cancel, NavigateHome: cancel whatever is pending, then goodbye. With a tool mapped in
 * intents.builtIns (D59) that tool is called instead (the direct call drops anything pending
 * too); whatever it answers, the goodbye follows and the session ends.
 */
export function stopHandler(bridge: BridgeClient, config: BridgeConfig): RequestHandler {
  return {
    canHandle: (input) => isIntent(input, ...SESSION_ENDING_INTENTS),
    handle: async (input) => {
      const intent = getIntentName(input.requestEnvelope);
      const action = builtInAction(config, intent);
      const turn: TurnInput =
        action && 'tool' in action ? toolTurn(action, intent) : { type: 'cancel' };
      try {
        await bridge.turn(input, turn);
      } catch {
        // Goodbye regardless: the user asked to leave.
      }
      return render(input, done('', true), { speech: SPOKEN.goodbye, endSession: true });
    },
  };
}

/**
 * Fallback: with a question pending, ask it again. With the session open for an answer (D60),
 * skill.fallbackWhileOpen and the last question again, never a generic "what would you like".
 * Otherwise the agent asks what was meant.
 */
export function fallbackHandler(bridge: BridgeClient, config: BridgeConfig): RequestHandler {
  return {
    canHandle: (input) => isIntent(input, 'AMAZON.FallbackIntent'),
    handle: async (input) => {
      const pending = getPendingQuestion(input);
      if (pending) {
        const speech = `${SPOKEN.questionRepeat} ${pending.message}`;
        return render(input, question(pending, speech), { remember: false });
      }
      // A result still being worked on is fetched by the agent turn below (poll first).
      if (hasOpenTurn(input) && !isAwaitingResult(input)) {
        const reprompt = getLastOutput(input)?.reprompt ?? REPROMPT;
        const speech = `${config.skill.fallbackWhileOpen} ${reprompt}`;
        return render(input, { ...done(speech, false), reprompt }, { remember: false });
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

/** Built-ins the bridge passes on as a turn or a mapped call; Stop and its kin end the session. */
const BUILT_IN_TURNS: ReadonlySet<string> = new Set(
  MAPPABLE_BUILT_IN_INTENTS.filter(
    (name) => !(SESSION_ENDING_INTENTS as readonly string[]).includes(name),
  ),
);

function builtInAction(config: BridgeConfig, intent: string): BuiltInAction | undefined {
  return (config.intents.builtIns as Record<string, BuiltInAction | undefined>)[intent];
}

function toolTurn(action: Extract<BuiltInAction, { tool: string }>, intent: string): TurnInput {
  return {
    type: 'tool',
    tool: action.tool,
    ...(action.arguments ? { arguments: action.arguments } : {}),
    intent,
  };
}

/** "AMAZON.StartOverIntent" → "start over": what the user said, near enough. */
function spokenIntent(intent: string): string {
  return intent
    .replace(/^AMAZON\./, '')
    .replace(/Intent$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
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
