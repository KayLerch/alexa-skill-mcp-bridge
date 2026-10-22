import type { Agent, Model } from '@strands-agents/sdk';
import { errorFields, type BridgeConfig, type Logger } from '@alexa-mcp-bridge/core';
import { buildAgent } from './agent/build-agent.js';
import { buildSystemPrompt, formatToolList, type SystemPromptVars } from './agent/prompt.js';
import { HiddenArguments, ResultField, askUserTool, mcpTools } from './agent/tools.js';
import { QuestionQueue } from './elicitation/queue.js';
import { isUnauthorized, resolveMcpAuth, type SecretResolver } from './mcp/auth.js';
import { BridgeMcpClient } from './mcp/client.js';
import { sigV4Fetch } from './mcp/gateway.js';
import { TokenHolder } from './mcp/token.js';
import type { MemoryAdapter } from './memory/store.js';
import { TurnRun } from './turn-run.js';

/**
 * One BridgeSession per container, one container per user. Holds the MCP client, the agent,
 * the question queue, and the run in progress. State names follow the table in docs/architecture.md.
 */

export type SessionState =
  'cold' | 'warming' | 'ready' | 'running' | 'overrun' | 'awaiting-answer' | 'failed';

export interface SessionIdentity {
  actorId: string;
  locale: string;
}

export interface BridgeSessionOptions {
  config: BridgeConfig;
  model: Model;
  memory: MemoryAdapter;
  logger: Logger;
  secretResolver?: SecretResolver;
  now?: () => Date;
  /** Set by the stack when features.gateway is on: the Gateway URL, called with SigV4. */
  gatewayUrl?: string;
}

/** A tools/call may sit parked on several spoken answers; the queue enforces the per-answer timeout. */
const TOOL_CALL_TIMEOUT_MS = 10 * 60 * 1000;

export class BridgeSession {
  state: SessionState = 'cold';
  readonly queue: QuestionQueue;
  readonly logger: Logger;
  readonly config: BridgeConfig;
  readonly model: Model;
  readonly memory: MemoryAdapter;
  /** The user's account-linked token, set from every invocation (D48). */
  readonly token = new TokenHolder();
  currentRun?: TurnRun;
  private mcp?: BridgeMcpClient;
  private hiddenArguments?: HiddenArguments;
  private resultField?: ResultField;
  private agent?: Agent;
  private warmup?: Promise<void>;
  private identity?: SessionIdentity;
  /** Why the last warm-up failed, for frontends that can show it (the CLI). */
  warmupError?: Error;
  /** The system prompt's inputs, kept so a lost link can rebuild it without the memory context. */
  private promptInputs?: SystemPromptVars;
  /** Set once the link was lost: this container no longer hydrates from memory (D48). */
  private forgotten = false;

  constructor(private readonly options: BridgeSessionOptions) {
    this.config = options.config;
    this.model = options.model;
    this.memory = options.memory;
    this.logger = options.logger;
    this.queue = new QuestionQueue({
      answerTimeoutMs: options.config.elicitation.answerTimeoutSeconds * 1000,
      speech: { maxChoicesSpoken: options.config.speech.maxChoicesSpoken },
      logger: options.logger,
    });
  }

  /** Connect to the MCP server, list tools, hydrate memory. Idempotent; runs in the background. */
  startWarmup(identity: SessionIdentity): void {
    if (this.warmup) return;
    this.identity = identity;
    this.state = 'warming';
    const startedAt = Date.now();
    this.warmup = this.connect(identity).then(
      () => {
        this.state = 'ready';
        this.logger.info('warm-up complete', { elapsedMs: Date.now() - startedAt });
      },
      (err: unknown) => {
        this.state = 'failed';
        this.warmupError = err instanceof Error ? err : new Error(String(err));
        this.logger.error('warm-up failed', errorFields(err));
      },
    );
  }

  /** Wait for warm-up, bounded by the caller's deadline. */
  async ready(
    identity: SessionIdentity,
    deadlineMs: number,
  ): Promise<'ready' | 'warming' | 'failed'> {
    this.startWarmup(identity);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'warming'>((resolve) => {
      timer = setTimeout(() => resolve('warming'), deadlineMs);
    });
    try {
      const outcome = await Promise.race([this.warmup as Promise<void>, timeout]);
      if (outcome === 'warming') return 'warming';
      return this.state === 'failed' ? 'failed' : 'ready';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Try warm-up again after a failure (for example the MCP server was down). */
  resetWarmup(): void {
    if (this.state !== 'failed') return;
    this.warmup = undefined;
    this.warmupError = undefined;
    this.state = 'cold';
  }

  startRun(input: string, debug: boolean): TurnRun {
    this.resultField?.begin();
    const run = new TurnRun({
      agent: this.agent as Agent,
      queue: this.queue,
      input,
      ...(this.resultField ? { resultField: this.resultField } : {}),
      logger: this.logger,
      ...(debug ? { debug: { toolCalls: [], modelCalls: 0 } } : {}),
    });
    this.currentRun = run;
    this.state = 'running';
    return run;
  }

  clearRun(): void {
    this.currentRun = undefined;
    this.state = this.agent ? 'ready' : this.state;
  }

  /** HealthyBusy only while a run works past its deadline; a parked question stays Healthy. */
  ping(): 'Healthy' | 'HealthyBusy' {
    return this.state === 'overrun' ? 'HealthyBusy' : 'Healthy';
  }

  /** With account linking: the MCP server refused the user's token at warm-up. */
  get warmupNeedsAccountLink(): boolean {
    return this.accountLinking && isUnauthorized(this.warmupError);
  }

  get accountLinking(): boolean {
    return this.config.mcp.auth.type === 'alexaAccountLinking';
  }

  /**
   * The account link went away (an invocation without a token, or a 401). Memory is keyed by the
   * Alexa user, not the linked account, so whoever links next must not inherit this conversation:
   * drop the agent's messages and the long-term context in its system prompt, and skip hydration
   * on any later warm-up in this container. Call it only while no run is working.
   */
  forgetConversation(): void {
    this.forgotten = true;
    this.hiddenArguments?.clear();
    if (this.agent) {
      this.agent.messages.splice(0);
      if (this.promptInputs) {
        this.agent.systemPrompt = buildSystemPrompt({ ...this.promptInputs, memoryContext: '' });
      }
    }
    this.logger.info('account link lost; conversation history dropped');
  }

  get serverName(): string | undefined {
    return this.mcp?.serverInfo?.name;
  }

  async close(): Promise<void> {
    this.queue.cancelAll('session closed');
    this.currentRun?.cancel();
    await this.mcp?.close();
  }

  /** A tool call got a 401: end the run with the link prompt, then forget once it has stopped. */
  private onUnauthorized(): void {
    const run = this.currentRun;
    if (!run) return;
    run.requireAccountLink();
    void run.finished.then(() => this.forgetConversation());
  }

  private async connect(identity: SessionIdentity): Promise<void> {
    const { config, logger, memory } = this.options;
    // Through the Gateway the server's own auth is the Gateway's job; the agent signs with SigV4.
    const gatewayUrl = this.options.gatewayUrl;
    const auth = gatewayUrl
      ? { headers: {} }
      : await resolveMcpAuth(config, this.options.secretResolver, this.token);
    const fetch = gatewayUrl ? sigV4Fetch(config.aws.region) : auth.fetch;
    const mcp = new BridgeMcpClient({
      url: gatewayUrl ?? config.mcp.url,
      auth,
      ...(fetch ? { fetch } : {}),
      callTimeoutMs: TOOL_CALL_TIMEOUT_MS,
      onElicitation: (params) => this.queue.elicit(params),
      logger,
    });
    const [info, definitions, history, memoryContext] = await Promise.all([
      mcp.connect(),
      mcp.connect().then(() => mcp.listTools()),
      this.forgotten
        ? []
        : memory.hydrate(identity.actorId).catch((err: unknown) => {
            logger.warn('memory hydration failed; starting without history', errorFields(err));
            return [];
          }),
      this.forgotten ? '' : memory.longTermContext(identity.actorId).catch(() => ''),
    ]);
    const today = (this.options.now ?? (() => new Date()))().toISOString().slice(0, 10);
    this.promptInputs = {
      serverName: info.name,
      serverInstructions: info.instructions ?? '(the server gave no instructions)',
      toolList: formatToolList(definitions),
      locale: identity.locale,
      today,
      memoryContext,
      maxSentences: config.speech.maxSentences,
      maxChoicesSpoken: config.speech.maxChoicesSpoken,
    };
    const systemPrompt = buildSystemPrompt(this.promptInputs);
    this.mcp = mcp;
    this.hiddenArguments = new HiddenArguments(config.tools.hiddenArguments);
    this.resultField = config.speech.resultField
      ? new ResultField(config.speech.resultField)
      : undefined;
    this.agent = buildAgent({
      model: this.model,
      tools: [
        ...mcpTools(
          definitions,
          mcp,
          logger,
          this.accountLinking ? () => this.onUnauthorized() : undefined,
          this.hiddenArguments,
          this.resultField,
        ),
        askUserTool(this.queue),
      ],
      systemPrompt,
      messages: history,
      debugSink: () => this.currentRun?.debug,
      logToolArguments: config.features.debug,
      logger,
    });
    logger.info('mcp session ready', {
      server: info.name,
      protocolVersion: info.protocolVersion,
      tools: definitions.map((d) => d.name),
      hydratedMessages: history.length,
    });
  }
}
