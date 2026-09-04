import { TextBlock, type Agent } from '@strands-agents/sdk';
import {
  SPOKEN,
  errorFields,
  type Logger,
  type Question,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import type { DebugSink } from './agent/build-agent.js';
import type { QuestionQueue } from './elicitation/queue.js';
import { cleanSpeech, endsWithQuestion } from './speech.js';

/**
 * One execution of the agent loop. It keeps running across frontend turns: a question parks
 * it, a deadline leaves it working in the background. waitForOutcome() is the one primitive
 * turn.ts needs: whichever comes first of finished, question pending, or deadline.
 */

export type RunOutcome =
  | { kind: 'done'; output: TurnOutput }
  | { kind: 'question'; question: Question }
  | { kind: 'deadline' };

export interface TurnRunOptions {
  agent: Agent;
  queue: QuestionQueue;
  /** The user message handed to the agent. */
  input: string;
  logger: Logger;
  debug?: DebugSink;
}

export class TurnRun {
  readonly startedAt = Date.now();
  readonly input: string;
  readonly debug?: DebugSink;
  private readonly aborter = new AbortController();
  private readonly finished: Promise<TurnOutput>;
  private settled?: TurnOutput;

  constructor(private readonly options: TurnRunOptions) {
    this.input = options.input;
    this.debug = options.debug;
    this.finished = this.execute();
  }

  get isRunning(): boolean {
    return this.settled === undefined;
  }

  get result(): TurnOutput | undefined {
    return this.settled;
  }

  async waitForOutcome(deadlineMs: number): Promise<RunOutcome> {
    if (this.settled) return { kind: 'done', output: this.settled };
    const stop = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<RunOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'deadline' }), deadlineMs);
    });
    const question = this.options.queue.waitForQuestion(stop.signal).then(
      (q): RunOutcome => ({ kind: 'question', question: this.options.queue.toQuestion(q) }),
      () => new Promise<never>(() => undefined),
    );
    const done = this.finished.then((output): RunOutcome => ({ kind: 'done', output }));
    try {
      return await Promise.race([done, question, deadline]);
    } finally {
      stop.abort();
      if (timer) clearTimeout(timer);
    }
  }

  /** Stop the agent loop. Any tool call in flight is cancelled through its signal. */
  cancel(): void {
    this.aborter.abort(new Error('cancelled'));
  }

  private async execute(): Promise<TurnOutput> {
    const { agent, logger } = this.options;
    try {
      const result = await agent.invoke(this.input, { cancelSignal: this.aborter.signal });
      logger.debug('agent result', {
        stopReason: result.stopReason,
        lastMessage: result.lastMessage.toJSON(),
        messages: agent.messages.length,
      });
      if (result.stopReason === 'cancelled') return this.finish(silent());
      const text = result.lastMessage.content
        .filter((block): block is TextBlock => block instanceof TextBlock)
        .map((block) => block.text)
        .join(' ');
      const speech = cleanSpeech(text) || SPOKEN.notUnderstood;
      const open = endsWithQuestion(speech);
      return this.finish({
        status: 'done',
        speech,
        ...(open ? { reprompt: speech } : {}),
        endSession: !open,
        visual: null,
      });
    } catch (err) {
      if (this.aborter.signal.aborted) return this.finish(silent());
      logger.error('agent loop failed', errorFields(err));
      return this.finish({
        status: 'error',
        speech: SPOKEN.error,
        endSession: false,
        visual: null,
      });
    }
  }

  private finish(output: TurnOutput): TurnOutput {
    this.settled = this.debug
      ? { ...output, debug: { ...this.debug, elapsedMs: Date.now() - this.startedAt } }
      : output;
    this.options.logger.info('run finished', {
      status: this.settled.status,
      elapsedMs: Date.now() - this.startedAt,
    });
    return this.settled;
  }
}

function silent(): TurnOutput {
  return { status: 'done', speech: '', endSession: true, visual: null };
}
