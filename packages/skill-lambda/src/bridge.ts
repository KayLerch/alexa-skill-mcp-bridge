import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { HandlerInput } from 'ask-sdk-core';
import {
  SPOKEN,
  errorFields,
  hashId,
  isValidTimeZone,
  linkAccountOutput,
  turnOutputSchema,
  type AgentInvocationInput,
  type BridgeConfig,
  type Display,
  type Logger,
  type TurnInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { displayOf } from './apl/screen.js';
import { getTimeZone, isAwaitingResult, setTimeZone } from './session-attrs.js';

/**
 * The Alexa Skill's client for the agent. Hashes Alexa ids, builds the envelope, calls
 * InvokeAgentRuntime inside the turn budget, and turns an abort into 'pending'.
 * When a result is outstanding it polls first and speaks that result ahead of the new
 * input (plan D16); the poll's time comes out of the main call's budget.
 * With mcp.auth.type 'alexaAccountLinking' the user's account-linked token rides along on
 * every envelope; without one the user is asked to link, and the agent only hears a cancel
 * without a token, which makes it forget the conversation (D48).
 */
export interface BridgeClientOptions {
  config: BridgeConfig;
  runtimeArn: string;
  /** The runtime version this deploy runs (AGENT_RUNTIME_VERSION); see runtimeSessionFor. */
  runtimeVersion?: string;
  logger: Logger;
  client?: BedrockAgentCoreClient;
  /** Test seam: replaces the network call. */
  invoke?: (
    envelope: AgentInvocationInput,
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<TurnOutput>;
}

/** The UPS lookup of the device's time zone may take this long; then the turn goes without (D53). */
const TIME_ZONE_TIMEOUT_MS = 300;

/** Below this the main call is not worth attempting; answer pending instead. */
const MIN_BUDGET_MS = 800;

/**
 * The tokenless cancel on the no-token path waits at most this long (D48), so a user who has not
 * linked hears the link prompt quickly. A warm agent answers a cancel in milliseconds; a cold one
 * holds no conversation to forget.
 */
export const UNLINKED_CANCEL_BUDGET_MS = 800;

export class BridgeClient {
  private readonly invoke: NonNullable<BridgeClientOptions['invoke']>;

  constructor(private readonly options: BridgeClientOptions) {
    const client =
      options.client ?? new BedrockAgentCoreClient({ region: options.config.aws.region });
    this.invoke =
      options.invoke ??
      (async (envelope, sessionId, signal) => {
        const response = await client.send(
          new InvokeAgentRuntimeCommand({
            agentRuntimeArn: options.runtimeArn,
            runtimeSessionId: sessionId,
            contentType: 'application/json',
            accept: 'application/json',
            payload: Buffer.from(JSON.stringify(envelope)),
          }),
          { abortSignal: signal },
        );
        const body = await response.response?.transformToString();
        return turnOutputSchema.parse(JSON.parse(body ?? '{}'));
      });
  }

  async turn(input: HandlerInput, turn: TurnInput): Promise<TurnOutput> {
    const timer = this.startProgressive(input, turn);
    try {
      return await this.run(input, turn);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Progressive Response (D52): one "One moment." if the agent has not answered by
   * turn.progressiveAfterMs. Fire and forget; a failure never touches the answer. Not for
   * cancel turns; the no-token path returns before it matters (the timer is cleared with it).
   */
  private startProgressive(
    input: HandlerInput,
    turn: TurnInput,
  ): ReturnType<typeof setTimeout> | undefined {
    const { config, logger } = this.options;
    const after = config.turn.progressiveAfterMs;
    if (after <= 0 || turn.type === 'cancel') return undefined;
    const linking = config.mcp.auth.type === 'alexaAccountLinking';
    if (linking && !linkedToken(input)) return undefined;
    return setTimeout(() => {
      try {
        const service = input.serviceClientFactory?.getDirectiveServiceClient();
        if (!service) return;
        const requestId = input.requestEnvelope.request.requestId;
        service
          .enqueue({
            header: { requestId },
            directive: { type: 'VoicePlayer.Speak', speech: SPOKEN.oneMoment },
          })
          .catch((err: unknown) => logger.warn('progressive response failed', errorFields(err)));
      } catch (err) {
        logger.warn('progressive response failed', errorFields(err));
      }
    }, after);
  }

  private async run(input: HandlerInput, turn: TurnInput): Promise<TurnOutput> {
    const { config, logger } = this.options;
    const ids = identity(input);
    const log = logger.child({
      actorId: ids.actorId,
      sessionId: ids.sessionId,
      turnType: turn.type,
    });
    const linking = config.mcp.auth.type === 'alexaAccountLinking';
    const userToken = linking ? linkedToken(input) : undefined;
    if (linking && !userToken) {
      log.info('no account-linked token on the request; asking the user to link');
      // A cancel without a token tells the agent the link is gone, so it drops the conversation
      // before anyone links again (D48). Its answer never changes ours; send() never throws.
      // Its own short budget, not the turn's: the link prompt must not wait on a cold agent.
      await this.send(ids, { type: 'cancel' }, UNLINKED_CANCEL_BUDGET_MS, log);
      // Stop still just ends the session.
      return turn.type === 'cancel'
        ? { status: 'done', speech: '', endSession: true, visual: null }
        : linkAccountOutput();
    }
    const lookupStarted = Date.now();
    const timeZone = await this.deviceTimeZone(input, log);
    const display = displayOf(input);
    const call: Call = {
      ...ids,
      ...(userToken ? { userToken } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(display ? { display } : {}),
    };
    let budgetMs = config.turn.budgetMs - (Date.now() - lookupStarted);
    let prefix = '';

    if (isAwaitingResult(input) && turn.type !== 'poll' && turn.type !== 'cancel') {
      const started = Date.now();
      const polled = await this.send(call, { type: 'poll' }, budgetMs, log);
      budgetMs -= Date.now() - started;
      if (polled.status === 'pending') return polled;
      if (polled.status === 'question') return polled;
      prefix = polled.speech;
      if (budgetMs < MIN_BUDGET_MS) {
        return {
          ...polled,
          status: 'pending',
          speech: `${prefix} ${config.skill.stillWorkingMessage}`.trim(),
        };
      }
    }

    const output = await this.send(call, turn, budgetMs, log);
    return prefix ? { ...output, speech: `${prefix} ${output.speech}`.trim() } : output;
  }

  /**
   * The device's IANA time zone from Alexa's UPS service, read once per Alexa session and cached
   * in the session attributes (D53). Bounded by TIME_ZONE_TIMEOUT_MS; a failure, a timeout or a
   * zone the Intl API rejects means no zone and is never an error. The lookup needs no permission.
   * Only an answer is cached (a zone, or '' when the answer held no usable zone); after an error
   * or a timeout the next turn of the session asks again.
   */
  private async deviceTimeZone(input: HandlerInput, log: Logger): Promise<string | undefined> {
    const cached = getTimeZone(input);
    if (cached !== undefined) return cached || undefined;
    const deviceId = input.requestEnvelope.context.System.device?.deviceId;
    const ups = input.serviceClientFactory?.getUpsServiceClient();
    if (!deviceId || !ups) return undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const zone = await Promise.race([
        ups.getSystemTimeZone(deviceId),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), TIME_ZONE_TIMEOUT_MS);
        }),
      ]);
      const valid = typeof zone === 'string' && isValidTimeZone(zone) ? zone : '';
      setTimeZone(input, valid);
      return valid || undefined;
    } catch (err) {
      log.warn('device time zone unavailable; continuing without', errorFields(err));
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async send(
    call: Call,
    turn: TurnInput,
    budgetMs: number,
    log: Logger,
  ): Promise<TurnOutput> {
    const { config } = this.options;
    const envelope: AgentInvocationInput = {
      turn,
      actorId: call.actorId,
      sessionId: call.sessionId,
      locale: call.locale,
      budgetMs,
      debug: config.features.debug,
      ...(call.userToken ? { userToken: call.userToken } : {}),
      ...(call.timeZone ? { timeZone: call.timeZone } : {}),
      ...(call.display ? { display: call.display } : {}),
    };
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), budgetMs);
    const started = Date.now();
    try {
      const output = await this.invoke(
        envelope,
        runtimeSessionFor(call.actorId, this.options.runtimeVersion),
        aborter.signal,
      );
      log.info('agent answered', { status: output.status, elapsedMs: Date.now() - started });
      return output;
    } catch (err) {
      if (aborter.signal.aborted) {
        log.warn('agent call hit the budget', { budgetMs });
        return pending(config);
      }
      log.error('agent call failed', errorFields(err));
      return { status: 'error', speech: SPOKEN.error, endSession: true, visual: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The runtime session a user's turns go to: one per user, so a parked question or a long run
 * survives a new Alexa session. AgentCore keeps a session's microVM, and the code it started
 * with, until it idles out or reaches its max lifetime (8 hours), so a user who keeps talking
 * would keep the code from before a deploy for that long. Keying on the runtime version too
 * moves every user to the new code at the first turn after a deploy; memory is in AgentCore
 * Memory, not the microVM, so it carries over. Only an in-flight question is left behind.
 */
export function runtimeSessionFor(actorId: string, runtimeVersion?: string): string {
  return runtimeVersion ? hashId(`${actorId}:${runtimeVersion}`) : actorId;
}

interface Identity {
  actorId: string;
  sessionId: string;
  locale: string;
}

/** What one agent call needs: the hashed identity, the user's token with account linking, the device's zone. */
interface Call extends Identity {
  userToken?: string;
  timeZone?: string;
  display?: Display;
}

/** Raw Alexa ids are hashed here and never leave the Lambda. */
export function identity(input: HandlerInput): Identity {
  const envelope = input.requestEnvelope;
  const userId = envelope.context.System.user.userId;
  const sessionId = envelope.session?.sessionId ?? `${userId}:${envelope.request.requestId}`;
  const locale = (envelope.request as { locale?: string }).locale ?? 'en-US';
  return { actorId: hashId(userId), sessionId: hashId(sessionId), locale };
}

/** The token Alexa adds once the user has linked their account. Passed on, never logged. */
export function linkedToken(input: HandlerInput): string | undefined {
  const token = input.requestEnvelope.context.System.user.accessToken;
  return token ? token : undefined;
}

function pending(config: BridgeConfig): TurnOutput {
  const speech = config.skill.stillWorkingMessage;
  return { status: 'pending', speech, reprompt: speech, endSession: false, visual: null };
}
