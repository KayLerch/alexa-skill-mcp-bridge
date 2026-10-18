import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptVars } from './prompt.js';

const vars: SystemPromptVars = {
  serverName: 'quiz',
  serverInstructions: 'A quiz.',
  toolList: '- start_quiz',
  locale: 'en-US',
  today: '2026-10-18',
  memoryContext: '',
  maxSentences: 3,
  maxChoicesSpoken: 3,
};

describe('buildSystemPrompt', () => {
  it('ends with the prompt addendum under its own heading', () => {
    const prompt = buildSystemPrompt({ ...vars, promptAddendum: 'Ask one question at a time.\n' });
    expect(prompt.endsWith('## Server-specific guidance\n\nAsk one question at a time.')).toBe(
      true,
    );
  });

  it('is unchanged without an addendum', () => {
    const prompt = buildSystemPrompt(vars);
    expect(prompt).not.toContain('Server-specific guidance');
    expect(buildSystemPrompt({ ...vars, promptAddendum: '  ' })).toBe(prompt);
  });
});
