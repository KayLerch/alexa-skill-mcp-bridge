import type { HandlerInput } from 'ask-sdk-core';
import type { Question } from '@alexa-mcp-bridge/core';

/**
 * Typed accessors for the two things the skill keeps in Alexa session attributes:
 * the question the user is answering, and whether a result is still being worked on.
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
