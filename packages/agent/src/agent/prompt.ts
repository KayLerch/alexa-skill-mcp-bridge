import { readFileSync } from 'node:fs';

/**
 * Prompts are markdown files in packages/agent/prompts with {{placeholders}}.
 * No prompt strings live in TypeScript. Files are read once and cached.
 */

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

export type PromptName =
  | 'system'
  | 'time-zone'
  | 'voice'
  | 'tool-result'
  | 'elicitation'
  | 'tool-hint'
  | 'fallback'
  | 'ask-user';

const cache = new Map<PromptName, string>();

export function loadPrompt(name: PromptName): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL(`${name}.md`, PROMPTS_DIR), 'utf8');
    cache.set(name, text);
  }
  return text;
}

/** Fill {{placeholders}}. Every placeholder in the file must have a value; typos fail loudly. */
export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const text = loadPrompt(name).replace(/\{\{([\w-]+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Prompt "${name}" has no value for {{${key}}}`);
    }
    return value;
  });
  return text.trim();
}

export interface SystemPromptVars {
  serverName: string;
  serverInstructions: string;
  toolList: string;
  locale: string;
  /** The date in the user's zone (or UTC), YYYY-MM-DD. */
  today: string;
  /** The user's IANA time zone (D53), when the frontend knows it. */
  timeZone?: string | undefined;
  /** "Known about this user" block from long-term memory. Empty string when there is none. */
  memoryContext: string;
  /** config.speech, so the voice rules carry the same numbers the renderers use. */
  maxSentences: number;
  maxChoicesSpoken: number;
  /** config.agent.promptAddendum (D56): the consumer's own guidance for this server. */
  promptAddendum?: string | undefined;
}

/** The date in a time zone as YYYY-MM-DD; UTC when none is given. */
export function todayIn(now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Persona, then the voice rules, then how to read a tool result. `voice.md` is its own file
 * because every model call that produces speech needs it, not only this one.
 */
export function buildSystemPrompt(vars: SystemPromptVars): string {
  const { maxSentences, maxChoicesSpoken, timeZone, promptAddendum, ...persona } = vars;
  const voice = renderPrompt('voice', {
    maxSentences: String(maxSentences),
    maxChoicesSpoken: String(maxChoicesSpoken),
  });
  const timeZoneRule = timeZone ? renderPrompt('time-zone', { timeZone }) : '';
  const addendum = promptAddendum?.trim();
  return [
    renderPrompt('system', { ...persona, timeZoneRule }),
    voice,
    loadPrompt('tool-result').trim(),
    ...(addendum ? [`## Server-specific guidance\n\n${addendum}`] : []),
  ].join('\n\n');
}

/** One line per tool: name, then the description's first sentence. Keeps the prompt small. */
export function formatToolList(
  tools: ReadonlyArray<{ name: string; description?: string | undefined }>,
): string {
  if (tools.length === 0) return '(the server exposes no tools)';
  return tools
    .map((t) => {
      const first = (t.description ?? '').split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
      return first ? `- ${t.name}: ${first}` : `- ${t.name}`;
    })
    .join('\n');
}
