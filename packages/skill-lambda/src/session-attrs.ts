import type { HandlerInput } from 'ask-sdk-core';
import type { Question } from '@alexa-mcp-bridge/core';

/**
 * Typed accessors for what the Alexa Skill keeps in Alexa session attributes: the question the
 * user is answering, whether a result is still being worked on, whether the session is open for an
 * ordinary turn (the agent asked in its own speech, no question parked), the device's zone, and
 * the last thing the user heard.
 */
export interface PendingQuestion {
  id: string;
  expects: Question['expects'];
  source: Question['source'];
  message: string;
}

interface Attributes {
  pendingQuestion?: PendingQuestion;
  awaitingResult?: boolean;
  openTurn?: boolean;
  /** The device's IANA time zone, or '' once the lookup was tried and gave nothing (D53). */
  timeZone?: string;
  /** What the user heard last and its reprompt, for "repeat" and a missed answer (D59, D60). */
  lastSpeech?: string;
  lastReprompt?: string;
  /** The server's hint for a missed reply that came with the last output (D70). */
  lastFallback?: string;
}

function read(input: HandlerInput): Attributes {
  return input.attributesManager.getSessionAttributes() as Attributes;
}

function write(input: HandlerInput, attrs: Attributes): void {
  input.attributesManager.setSessionAttributes(attrs);
}

export function getPendingQuestion(input: HandlerInput): PendingQuestion | undefined {
  return read(input).pendingQuestion;
}

export function setPendingQuestion(input: HandlerInput, question: Question | undefined): void {
  const attrs = read(input);
  if (question) {
    attrs.pendingQuestion = {
      id: question.id,
      expects: question.expects,
      source: question.source,
      message: question.message,
    };
  } else {
    delete attrs.pendingQuestion;
  }
  write(input, attrs);
}

export function isAwaitingResult(input: HandlerInput): boolean {
  return read(input).awaitingResult === true;
}

export function setAwaitingResult(input: HandlerInput, awaiting: boolean): void {
  const attrs = read(input);
  if (awaiting) attrs.awaitingResult = true;
  else delete attrs.awaitingResult;
  write(input, attrs);
}

export function hasOpenTurn(input: HandlerInput): boolean {
  return read(input).openTurn === true;
}

export function setOpenTurn(input: HandlerInput, open: boolean): void {
  const attrs = read(input);
  if (open) attrs.openTurn = true;
  else delete attrs.openTurn;
  write(input, attrs);
}

/** undefined: not looked up yet in this session. '': looked up, no zone. Otherwise the zone. */
export function getTimeZone(input: HandlerInput): string | undefined {
  return read(input).timeZone;
}

export function setTimeZone(input: HandlerInput, timeZone: string): void {
  const attrs = read(input);
  attrs.timeZone = timeZone;
  write(input, attrs);
}

export interface LastOutput {
  speech: string;
  reprompt: string;
  fallback?: string;
}

/** The last spoken output of an open session, or undefined before the first one. */
export function getLastOutput(input: HandlerInput): LastOutput | undefined {
  const { lastSpeech, lastReprompt, lastFallback } = read(input);
  if (!lastSpeech) return undefined;
  return {
    speech: lastSpeech,
    reprompt: lastReprompt ?? lastSpeech,
    ...(lastFallback ? { fallback: lastFallback } : {}),
  };
}

/** A new output replaces all three; one without a hint drops the earlier hint. */
export function setLastOutput(input: HandlerInput, output: LastOutput): void {
  const attrs = read(input);
  attrs.lastSpeech = output.speech;
  attrs.lastReprompt = output.reprompt;
  if (output.fallback) attrs.lastFallback = output.fallback;
  else delete attrs.lastFallback;
  write(input, attrs);
}
