import {
  SPOKEN,
  linkAccountOutput,
  type AgentInvocation,
  type AnswerHint,
  type Logger,
  type Question,
  type TurnOutput,
  type UtteranceHint,
  type Visual,
} from '@alexa-mcp-bridge/core';
import { renderPrompt } from './agent/prompt.js';
import { mapAnswer, spokenText } from './elicitation/answer-mapper.js';
import { mapAnswerWithModel } from './elicitation/answer-mapper-model.js';
import type { BridgeSession, SessionIdentity } from './session.js';
import { cleanSpeech, lastQuestion } from './speech.js';
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
/** A screen is rendered only when at least this much of the deadline is left (D54). */
const SCREEN_MIN_LEFT_MS = 1000;

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
  const deadlineAt = Date.now() + deadlineMs;
  const identity: SessionIdentity = {
    actorId: invocation.actorId,
    locale: invocation.locale,
    timeZone: invocation.timeZone,
  };
  session.updateTimeZone(invocation.timeZone);
  // With account linking, every MCP request from here on carries this invocation's token (D48).
  session.token.set(invocation.userToken);
  // No token means the user is no longer linked: whoever links next starts with a clean slate.
  if (session.accountLinking && !invocation.userToken) await unlinked(session, log);

  switch (turn.type) {
    case 'warmup':
      // Reply at once; connecting to the MCP server and hydrating memory continue in the background.
      session.resetWarmup();
      session.startWarmup(identity);
      return done('');

    case 'turn':
      return newRequest(session, invocation, identity, turn.utterance, deadlineMs, deadlineAt, log);

    case 'answer':
      return answer(
        session,
        invocation,
        identity,
        turn.questionId,
        turn.answer,
        deadlineMs,
        deadlineAt,
        log,
      );

    case 'poll':
      return poll(session, invocation, deadlineMs, deadlineAt, log);

    case 'tool':
      return directCall(session, invocation, identity, turn, deadlineAt, log);

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
  deadlineAt: number,
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
    const needsLink = session.warmupNeedsAccountLink;
    log.warn('request while the session failed to warm up', { needsLink });
    session.resetWarmup();
    if (needsLink) {
      session.forgetConversation();
      return linkAccountOutput();
    }
    return { status: 'error', speech: SPOKEN.error, endSession: true, visual: null };
  }
  if (readiness === 'warming') {
    log.info('request while still warming up; answering pending');
    return pending(session);
  }

  const run = session.startRun(userMessage(utterance), invocation.debug);
  return deliver(session, invocation, await run.waitForOutcome(deadlineMs), deadlineAt, log);
}

async function answer(
  session: BridgeSession,
  invocation: AgentInvocation,
  identity: SessionIdentity,
  questionId: string,
  hint: AnswerHint,
  deadlineMs: number,
  deadlineAt: number,
  log: Logger,
): Promise<TurnOutput> {
  const current = session.queue.current();
  const run = session.currentRun;
  if (!current || current.id !== questionId || !run) {
    // Stale or unknown question: never drop what the user said. Treat it as a new request.
    log.info('answer for a question that is not pending; treating it as a new request', {
      questionId,
    });
    return newRequest(
      session,
      invocation,
      identity,
      { text: spokenText(hint) },
      deadlineMs,
      deadlineAt,
      log,
    );
  }

  // "No" to anything but a yes/no question means the user declines to answer.
  if (hint.yesNo === false && current.expects !== 'yesNo') {
    log.info('user declined the question', { questionId });
    session.queue.decline(questionId);
    return deliver(session, invocation, await run.waitForOutcome(deadlineMs), deadlineAt, log);
  }

  let mapped = mapAnswer(hint, current);
  if (!mapped.ok && mapped.reason === 'needs-model') {
    mapped = await mapAnswerWithModel(session.model, current, spokenText(hint), log);
  }
  if (!mapped.ok) {
    log.info('answer not usable; asking again', { questionId, detail: mapped.detail });
    // The apology is spoken once; the question the frontend stores (and may repeat) stays plain.
    const again = session.queue.toQuestion(current);
    return { ...question(again), speech: `${SPOKEN.questionRepeat} ${again.message}` };
  }

  const { next } = session.queue.answer(questionId, mapped.value);
  if (next) {
    // More properties in the same elicitation: ask the next one without waking the tool.
    return question(session.queue.toQuestion(next));
  }
  return deliver(session, invocation, await run.waitForOutcome(deadlineMs), deadlineAt, log);
}

async function poll(
  session: BridgeSession,
  invocation: AgentInvocation,
  deadlineMs: number,
  deadlineAt: number,
  log: Logger,
): Promise<TurnOutput> {
  // Only an overrun has something to fetch (plan D9). Anything else has nothing to say.
  if (session.state !== 'overrun' || !session.currentRun) return done('');
  const outcome = await session.currentRun.waitForOutcome(deadlineMs);
  return deliver(session, invocation, outcome, deadlineAt, log);
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

/**
 * A tool the frontend asked for by name (D57): the launch tool or a mapped built-in intent. No
 * model: the bridge calls it, speaks its result field and shows its widget; the session ends only
 * when the result's end-session field is true. The user has moved on, so a pending question and a
 * running run are dropped first. Anything that leaves nothing to say (not ready in time, a failed
 * call, no result field) answers with empty speech and the frontend uses its own line.
 */
async function directCall(
  session: BridgeSession,
  invocation: AgentInvocation,
  identity: SessionIdentity,
  turn: Extract<AgentInvocation['turn'], { type: 'tool' }>,
  deadlineAt: number,
  log: Logger,
): Promise<TurnOutput> {
  session.queue.cancelAll('direct tool call');
  const running = session.currentRun;
  if (running?.isRunning) {
    running.cancel();
    await running.waitForOutcome(UNWIND_MS);
  }
  if (session.currentRun?.isRunning) {
    log.info('run still unwinding; skipping the direct call');
    return done('');
  }
  session.clearRun();

  const readiness = await session.ready(identity, Math.max(0, deadlineAt - Date.now()));
  if (readiness === 'failed') {
    const needsLink = session.warmupNeedsAccountLink;
    log.warn('direct call while the session failed to warm up', { needsLink });
    session.resetWarmup();
    if (needsLink) {
      session.forgetConversation();
      return linkAccountOutput();
    }
    return done('');
  }
  if (readiness === 'warming') {
    log.info('direct call while still warming up; nothing to say yet');
    return done('');
  }

  const started = Date.now();
  const outcome = await session.callDirect(
    turn.tool,
    turn.arguments ?? {},
    turn.intent,
    deadlineAt - Date.now(),
  );
  log.info('direct call finished', {
    tool: turn.tool,
    outcome: outcome.kind,
    elapsedMs: Date.now() - started,
  });
  if (outcome.kind === 'unauthorized') {
    session.forgetConversation();
    return linkAccountOutput();
  }
  const speech = outcome.kind === 'ok' ? cleanSpeech(outcome.speech ?? '') : '';
  if (outcome.kind !== 'ok' || !speech) return done('');
  const reprompt = lastQuestion(speech);
  const fallback = outcome.endsSession ? '' : cleanSpeech(outcome.fallback ?? '');
  const output: TurnOutput = {
    status: 'done',
    speech,
    ...(!outcome.endsSession && reprompt ? { reprompt } : {}),
    ...(fallback ? { fallback } : {}),
    endSession: outcome.endsSession,
    visual: null,
  };
  const visual = await screen(session, invocation, output, deadlineAt, log);
  return visual ? { ...output, visual } : output;
}

/** Stop whatever runs for the previous link, then forget the conversation (D48). */
async function unlinked(session: BridgeSession, log: Logger): Promise<void> {
  session.queue.cancelAll('account link lost');
  const run = session.currentRun;
  if (run?.isRunning) {
    run.cancel();
    await run.waitForOutcome(UNWIND_MS);
  }
  if (run?.isRunning) {
    // Still unwinding: its messages are in use. Forget as soon as it has stopped.
    log.warn('run still unwinding after the link was lost; forgetting once it stops');
    void run.finished.then(() => session.forgetConversation());
    return;
  }
  session.clearRun();
  session.forgetConversation();
}

/** Map a run outcome onto the state table and the TurnOutput the frontend renders. */
async function deliver(
  session: BridgeSession,
  invocation: AgentInvocation,
  outcome: RunOutcome,
  deadlineAt: number,
  log: Logger,
): Promise<TurnOutput> {
  switch (outcome.kind) {
    case 'done': {
      const run = session.currentRun;
      session.clearRun();
      if (
        run &&
        outcome.output.status === 'done' &&
        outcome.output.speech &&
        !outcome.output.linkAccount
      ) {
        void session.memory
          .record(invocation.actorId, invocation.sessionId, run.input, outcome.output.speech)
          .catch((err: unknown) => log.warn('memory record failed', { error: String(err) }));
      }
      const visual = await screen(session, invocation, outcome.output, deadlineAt, log);
      return visual ? { ...outcome.output, visual } : outcome.output;
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

/**
 * The screen after a finished run (D54): only for a device that sent `display`, a run that called
 * a tool with a widget, and a turn with a second of its deadline left. The render is cut off at
 * the deadline; whatever goes wrong, the speech goes out without a visual.
 */
async function screen(
  session: BridgeSession,
  invocation: AgentInvocation,
  output: TurnOutput,
  deadlineAt: number,
  log: Logger,
): Promise<Visual | undefined> {
  const { display } = invocation;
  if (!display || !session.screen || !session.widgets.latest) return undefined;
  if (output.status !== 'done' || output.linkAccount || !output.speech) return undefined;
  const leftMs = deadlineAt - Date.now();
  if (leftMs < SCREEN_MIN_LEFT_MS) {
    log.info('too little of the turn left for the screen; speech only', { leftMs });
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  const cutOff = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      log.warn('screen not ready by the deadline; speech only', { leftMs });
      resolve(undefined);
    }, leftMs);
  });
  try {
    return await Promise.race([session.renderScreen(display), cutOff]);
  } catch (err) {
    log.warn('screen failed; speech only', {
      errorName: err instanceof Error ? err.name : 'unknown',
    });
    return undefined;
  } finally {
    clearTimeout(timer);
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
