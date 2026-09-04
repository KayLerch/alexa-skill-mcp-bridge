import {
  SPOKEN,
  type AgentInvocation,
  type AnswerHint,
  type Logger,
  type Question,
  type TurnOutput,
  type UtteranceHint,
} from '@alexa-mcp-bridge/core';
import { renderPrompt } from './agent/prompt.js';
import { mapAnswer, spokenText } from './elicitation/answer-mapper.js';
import { mapAnswerWithModel } from './elicitation/answer-mapper-model.js';
import type { BridgeSession, SessionIdentity } from './session.js';
import type { RunOutcome } from './turn-run.js';

/**
 * The story of one turn, top to bottom. Every frontend request lands here with a budget;
 * this file decides what the agent does and what the frontend gets back. The mechanics
 * (MCP session, question parking, agent loop) live in the modules it calls.
 *
 * States: cold → warming → ready ⇄ running → overrun | awaiting-answer (plan 6.2).
 */

/** The agent answers 'pending' this much before the frontend's own abort (plan D8). */
const DEADLINE_MARGIN_MS = 500;
/** How long a cancelled tool call gets to unwind before the next request starts (plan D7). */
const UNWIND_MS = 2000;

export async function runTurn(
  session: BridgeSession,
  invocation: AgentInvocation,
): Promise<TurnOutput> {
  const { turn } = invocation;
  const log = session.logger.child({
    actorId: invocation.actorId,
    sessionId: invocation.sessionId,
    turnType: turn.type,
    stateBefore: session.state,
  });
  const deadlineMs = Math.max(250, invocation.budgetMs - DEADLINE_MARGIN_MS);
  const identity: SessionIdentity = { actorId: invocation.actorId, locale: invocation.locale };

  switch (turn.type) {
    case 'warmup':
      // Reply at once; connecting to the MCP server and hydrating memory continue in the background.
      session.resetWarmup();
      session.startWarmup(identity);
      return done('');

    case 'turn':
      return newRequest(session, invocation, identity, turn.utterance, deadlineMs, log);

    case 'answer':
      return answer(session, invocation, identity, turn.questionId, turn.answer, deadlineMs, log);

    case 'poll':
      return poll(session, invocation, deadlineMs, log);

    case 'cancel':
      return cancel(session, log);
  }
}

async function newRequest(
  session: BridgeSession,
  invocation: AgentInvocation,
  identity: SessionIdentity,
  utterance: UtteranceHint,
  deadlineMs: number,
  log: Logger,
): Promise<TurnOutput> {
  // A pending question means the user changed topic: cancel it, let the tool call unwind, discard.
  if (session.queue.current()) {
    log.info('new request while a question was pending; cancelling it');
    session.queue.cancelAll('new request');
    await session.currentRun?.waitForOutcome(UNWIND_MS);
    session.clearRun();
  }

  // A run still working past its deadline: do not start another. The frontend polls first.
  if (session.currentRun?.isRunning) {
    log.info('new request while a run is still working; answering pending');
    return pending(session);
  }
  session.clearRun();

  const readiness = await session.ready(identity, deadlineMs);
  if (readiness === 'failed') {
    log.warn('request while the session failed to warm up');
    session.resetWarmup();
    return { status: 'error', speech: SPOKEN.error, endSession: true, visual: null };
  }
  if (readiness === 'warming') {
    log.info('request while still warming up; answering pending');
    return pending(session);
  }

  const run = session.startRun(userMessage(utterance), invocation.debug);
  return deliver(session, invocation, await run.waitForOutcome(deadlineMs), log);
}

async function answer(
  session: BridgeSession,
  invocation: AgentInvocation,
  identity: SessionIdentity,
  questionId: string,
  hint: AnswerHint,
  deadlineMs: number,
  log: Logger,
): Promise<TurnOutput> {
  const current = session.queue.current();
  const run = session.currentRun;
  if (!current || current.id !== questionId || !run) {
    // Stale or unknown question: never drop what the user said. Treat it as a new request.
    log.info('answer for a question that is not pending; treating it as a new request', {
      questionId,
    });
    return newRequest(session, invocation, identity, { text: spokenText(hint) }, deadlineMs, log);
  }

  // "No" to anything but a yes/no question means the user declines to answer.
  if (hint.yesNo === false && current.expects !== 'yesNo') {
    log.info('user declined the question', { questionId });
    session.queue.decline(questionId);
    return deliver(session, invocation, await run.waitForOutcome(deadlineMs), log);
  }

  let mapped = mapAnswer(hint, current);
  if (!mapped.ok && mapped.reason === 'needs-model') {
    mapped = await mapAnswerWithModel(session.model, current, spokenText(hint), log);
  }
  if (!mapped.ok) {
    log.info('answer not usable; asking again', { questionId, detail: mapped.detail });
    const again = session.queue.toQuestion(current);
    return question({ ...again, message: `${SPOKEN.questionRepeat} ${again.message}` });
  }

  const { next } = session.queue.answer(questionId, mapped.value);
  if (next) {
    // More properties in the same elicitation: ask the next one without waking the tool.
    return question(session.queue.toQuestion(next));
  }
  return deliver(session, invocation, await run.waitForOutcome(deadlineMs), log);
}

async function poll(
  session: BridgeSession,
  invocation: AgentInvocation,
  deadlineMs: number,
  log: Logger,
): Promise<TurnOutput> {
  // Only an overrun has something to fetch (plan D9). Anything else has nothing to say.
  if (session.state !== 'overrun' || !session.currentRun) return done('');
  return deliver(session, invocation, await session.currentRun.waitForOutcome(deadlineMs), log);
}

async function cancel(session: BridgeSession, log: Logger): Promise<TurnOutput> {
  session.queue.cancelAll('cancel');
  const run = session.currentRun;
  if (run?.isRunning) {
    run.cancel();
    await run.waitForOutcome(UNWIND_MS);
  }
  session.clearRun();
  log.info('cancelled');
  return done('');
}

/** Map a run outcome onto the state table and the TurnOutput the frontend renders. */
function deliver(
  session: BridgeSession,
  invocation: AgentInvocation,
  outcome: RunOutcome,
  log: Logger,
): TurnOutput {
  switch (outcome.kind) {
    case 'done': {
      const run = session.currentRun;
      session.clearRun();
      if (run && outcome.output.status === 'done' && outcome.output.speech) {
        void session.memory
          .record(invocation.actorId, invocation.sessionId, run.input, outcome.output.speech)
          .catch((err: unknown) => log.warn('memory record failed', { error: String(err) }));
      }
      return outcome.output;
    }
    case 'question':
      session.state = 'awaiting-answer';
      return question(outcome.question);
    case 'deadline':
      session.state = 'overrun';
      log.info('deadline passed; the run continues in the background');
      return pending(session);
  }
}

/** What the agent hears. Alexa's intent match arrives as a hint, never as a command. */
function userMessage(utterance: UtteranceHint): string {
  const text = utterance.text?.trim();
  if (utterance.tool) {
    const slots = Object.entries(utterance.slots ?? {})
      .map(([argument, slot]) => `${argument} = ${slot.resolvedValue ?? slot.value}`)
      .join(', ');
    return renderPrompt('tool-hint', {
      request:
        text || `(no transcript; the frontend matched intent ${utterance.intent ?? 'unknown'})`,
      tool: utterance.tool,
      slots: slots ? ` and the values ${slots}` : '',
    });
  }
  return text || renderPrompt('fallback', {});
}

function done(speech: string): TurnOutput {
  return {
    status: 'done',
    speech,
    endSession: speech === '' ? false : !/\?\s*$/.test(speech),
    visual: null,
  };
}

function question(q: Question): TurnOutput {
  return {
    status: 'question',
    speech: q.message,
    reprompt: q.message,
    question: q,
    endSession: false,
    visual: null,
  };
}

function pending(session: BridgeSession): TurnOutput {
  const speech = session.config.skill.stillWorkingMessage;
  return { status: 'pending', speech, reprompt: speech, endSession: false, visual: null };
}
