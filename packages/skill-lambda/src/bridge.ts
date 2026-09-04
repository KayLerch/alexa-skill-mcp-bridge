import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { HandlerInput } from 'ask-sdk-core';
import {
  SPOKEN,
  errorFields,
  hashId,
  turnOutputSchema,
  type AgentInvocationInput,
  type BridgeConfig,
  type Logger,
  type TurnInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { isAwaitingResult } from './session-attrs.js';

/**
 * The skill's client for the agent. Hashes Alexa ids, builds the envelope, calls
 * InvokeAgentRuntime inside the turn budget, and turns an abort into 'pending'.
 * When a result is outstanding it polls first and speaks that result ahead of the new
 * input (plan D16); the poll's time comes out of the main call's budget.
 */
export interface BridgeClientOptions {
  config: BridgeConfig;
  runtimeArn: string;
  logger: Logger;
  client?: BedrockAgentCoreClient;
  /** Test seam: replaces the network call. */
  invoke?: (
    envelope: AgentInvocationInput,
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<TurnOutput>;
}

/** Below this the main call is not worth attempting; answer pending instead. */
const MIN_BUDGET_MS = 800;

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
    const { config, logger } = this.options;
    const ids = identity(input);
    const log = logger.child({
      actorId: ids.actorId,
      sessionId: ids.sessionId,
      turnType: turn.type,
    });
    let budgetMs = config.turn.budgetMs;
    let prefix = '';

    if (isAwaitingResult(input) && turn.type !== 'poll' && turn.type !== 'cancel') {
      const started = Date.now();
      const polled = await this.send(ids, { type: 'poll' }, budgetMs, log);
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

    const output = await this.send(ids, turn, budgetMs, log);
    return prefix ? { ...output, speech: `${prefix} ${output.speech}`.trim() } : output;
  }

  private async send(
    ids: Identity,
    turn: TurnInput,
    budgetMs: number,
    log: Logger,
  ): Promise<TurnOutput> {
    const { config } = this.options;
    const envelope: AgentInvocationInput = {
      turn,
      actorId: ids.actorId,
      sessionId: ids.sessionId,
      locale: ids.locale,
      budgetMs,
      debug: config.features.debug,
    };
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), budgetMs);
    const started = Date.now();
    try {
      const output = await this.invoke(envelope, ids.actorId, aborter.signal);
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

interface Identity {
  actorId: string;
  sessionId: string;
  locale: string;
}

/** Raw Alexa ids are hashed here and never leave the Lambda. */
export function identity(input: HandlerInput): Identity {
  const envelope = input.requestEnvelope;
  const userId = envelope.context.System.user.userId;
  const sessionId = envelope.session?.sessionId ?? `${userId}:${envelope.request.requestId}`;
  const locale = (envelope.request as { locale?: string }).locale ?? 'en-US';
  return { actorId: hashId(userId), sessionId: hashId(sessionId), locale };
}

function pending(config: BridgeConfig): TurnOutput {
  const speech = config.skill.stillWorkingMessage;
  return { status: 'pending', speech, reprompt: speech, endSession: false, visual: null };
}
