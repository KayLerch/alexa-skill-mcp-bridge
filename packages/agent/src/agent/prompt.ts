import { readFileSync } from 'node:fs';

/**
 * Prompts are markdown files in packages/agent/prompts with {{placeholders}}.
 * No prompt strings live in TypeScript. Files are read once and cached.
 */

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

export type PromptName =
  'system' | 'voice' | 'tool-result' | 'elicitation' | 'tool-hint' | 'fallback' | 'ask-user';

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
  today: string;
  /** "Known about this user" block from long-term memory. Empty string when there is none. */
  memoryContext: string;
  /** config.speech, so the voice rules carry the same numbers the renderers use. */
  maxSentences: number;
  maxChoicesSpoken: number;
}

/**
 * Persona, then the voice rules, then how to read a tool result. `voice.md` is its own file
 * because every model call that produces speech needs it, not only this one.
 */
export function buildSystemPrompt(vars: SystemPromptVars): string {
  const { maxSentences, maxChoicesSpoken, ...persona } = vars;
  const voice = renderPrompt('voice', {
    maxSentences: String(maxSentences),
    maxChoicesSpoken: String(maxChoicesSpoken),
  });
  return [renderPrompt('system', persona), voice, loadPrompt('tool-result').trim()].join('\n\n');
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
