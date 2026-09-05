import { randomUUID } from 'node:crypto';
import type { ElicitRequestParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger, Question, QuestionExpects } from '@alexa-mcp-bridge/core';
import { planElicitation, type QuestionSpec, type SpeechStyle } from './question.js';

/**
 * The parking lot. An elicitation (or an ask_user call) arrives while a tool call is in
 * flight; its promise is held here until the user answers on a later turn.
 * One question is current at a time; further items wait in FIFO order.
 */

export interface PendingQuestion extends QuestionSpec {
  id: string;
  source: Question['source'];
}

interface ElicitationItem {
  kind: 'elicitation';
  questions: PendingQuestion[];
  index: number;
  answers: Record<string, string | number | boolean | string[]>;
  resolve: (result: ElicitResult) => void;
}

interface AgentQuestionItem {
  kind: 'agent';
  question: PendingQuestion;
  resolve: (answer: AgentAnswer) => void;
}

type Item = ElicitationItem | AgentQuestionItem;

export type AgentAnswer = { answered: true; text: string } | { answered: false };

export interface AskUserSpec {
  message: string;
  expects: QuestionExpects;
  choices?: string[];
}

export interface QueueOptions {
  answerTimeoutMs: number;
  /** Voice rules from config.speech; the renderer decides how many options to read aloud. */
  speech?: SpeechStyle;
  logger: Logger;
  makeId?: () => string;
}

export class QuestionQueue {
  private readonly items: Item[] = [];
  private readonly listeners = new Set<(q: PendingQuestion) => void>();
  private timer: NodeJS.Timeout | undefined;
  private readonly makeId: () => string;

  constructor(private readonly options: QueueOptions) {
    this.makeId = options.makeId ?? (() => randomUUID());
  }

  /** The question the user should be answering right now, if any. */
  current(): PendingQuestion | undefined {
    const head = this.items[0];
    if (!head) return undefined;
    return head.kind === 'agent' ? head.question : head.questions[head.index];
  }

  get size(): number {
    return this.items.length;
  }

  /** Entry point for the MCP elicitation callback. Resolves when the user has answered every property. */
  elicit(params: ElicitRequestParams): Promise<ElicitResult> {
    const plan = planElicitation(params, this.options.speech);
    if (plan.mode === 'url') {
      // Voice cannot open a link. Decline so the tool call ends cleanly; a web frontend would open it.
      this.options.logger.warn('url-mode elicitation declined', { url: plan.url });
      return Promise.resolve({ action: 'decline' });
    }
    if (plan.questions.length === 0) {
      return Promise.resolve({ action: 'accept', content: {} });
    }
    return new Promise<ElicitResult>((resolve) => {
      const questions = plan.questions.map((q) => ({
        ...q,
        id: this.makeId(),
        source: 'elicitation' as const,
      }));
      this.push({ kind: 'elicitation', questions, index: 0, answers: {}, resolve });
    });
  }

  /** Entry point for the ask_user tool. */
  askUser(spec: AskUserSpec): Promise<AgentAnswer> {
    return new Promise<AgentAnswer>((resolve) => {
      const question: PendingQuestion = {
        id: this.makeId(),
        source: 'agent',
        property: 'answer',
        schema: { type: 'string' },
        message: spec.message,
        expects: spec.expects,
        ...(spec.choices ? { choices: spec.choices } : {}),
        required: true,
      };
      this.push({ kind: 'agent', question, resolve });
    });
  }

  /** Record an answer for the current question. Returns the next question in the same item, if any. */
  answer(
    questionId: string,
    value: string | number | boolean | string[],
  ): { next?: PendingQuestion } {
    const head = this.requireCurrent(questionId);
    if (head.kind === 'agent') {
      this.finishHead();
      head.resolve({ answered: true, text: String(value) });
      return {};
    }
    const question = head.questions[head.index] as PendingQuestion;
    head.answers[question.property] = value;
    head.index += 1;
    const next = head.questions[head.index];
    if (next) {
      this.armTimeout();
      return { next };
    }
    this.finishHead();
    head.resolve({ action: 'accept', content: head.answers });
    return {};
  }

  /** The user declined to answer the current question. */
  decline(questionId: string): void {
    const head = this.requireCurrent(questionId);
    this.finishHead();
    if (head.kind === 'agent') head.resolve({ answered: false });
    else head.resolve({ action: 'decline' });
  }

  /** Cancel every pending item (user said stop, session ended, or a new request arrived). */
  cancelAll(reason: string): void {
    if (this.items.length === 0) return;
    this.options.logger.info('cancelling pending questions', { count: this.items.length, reason });
    this.clearTimeout();
    for (const item of this.items.splice(0)) {
      if (item.kind === 'agent') item.resolve({ answered: false });
      else item.resolve({ action: 'cancel' });
    }
  }

  /** Resolves with the current question as soon as there is one. Aborts with the signal. */
  waitForQuestion(signal: AbortSignal): Promise<PendingQuestion> {
    const now = this.current();
    if (now) return Promise.resolve(now);
    return new Promise<PendingQuestion>((resolve, reject) => {
      const listener = (q: PendingQuestion) => {
        cleanup();
        resolve(q);
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new Error('aborted'));
      };
      const cleanup = () => {
        this.listeners.delete(listener);
        signal.removeEventListener('abort', onAbort);
      };
      this.listeners.add(listener);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** The frontend-facing shape of a pending question. */
  toQuestion(pending: PendingQuestion): Question {
    return {
      id: pending.id,
      source: pending.source,
      message: pending.message,
      schema: pending.schema,
      expects: pending.expects,
      ...(pending.choices ? { choices: pending.choices } : {}),
    };
  }

  private push(item: Item): void {
    this.items.push(item);
    if (this.items.length === 1) this.becameCurrent();
  }

  private finishHead(): void {
    this.clearTimeout();
    this.items.shift();
    if (this.items.length > 0) this.becameCurrent();
  }

  private becameCurrent(): void {
    this.armTimeout();
    const q = this.current();
    if (!q) return;
    this.options.logger.info('question pending', {
      questionId: q.id,
      source: q.source,
      expects: q.expects,
    });
    for (const listener of [...this.listeners]) listener(q);
  }

  private requireCurrent(questionId: string): Item {
    const head = this.items[0];
    const current = this.current();
    if (!head || !current || current.id !== questionId) {
      throw new Error(`Question ${questionId} is not the current question`);
    }
    return head;
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timer = setTimeout(() => {
      const q = this.current();
      this.options.logger.warn('answer timeout; cancelling pending question', {
        questionId: q?.id,
      });
      this.cancelAll('answer timeout');
    }, this.options.answerTimeoutMs);
    this.timer.unref();
  }

  private clearTimeout(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
