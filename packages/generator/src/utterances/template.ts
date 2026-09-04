import type { ManifestTool } from '@alexa-mcp-bridge/core';
import { spokenWords } from '../names.js';
import { dedupe, validUtterance } from './validate.js';

/**
 * Deterministic utterances from the tool name and slots. Used when no AWS credentials are
 * present and as the floor under model-written utterances. Between 8 and 15 per tool.
 */
export const MIN_UTTERANCES = 8;
export const MAX_UTTERANCES = 15;

export function templateUtterances(tool: ManifestTool): string[] {
  const action = spokenWords(tool.name) || 'do it';
  const typed = tool.slots.filter((s) => s.slotType !== 'AMAZON.SearchQuery');
  const query = tool.slots.find((s) => s.slotType === 'AMAZON.SearchQuery');

  const out: string[] = [
    action,
    `${action} please`,
    `can you ${action}`,
    `i want to ${action}`,
    `please ${action}`,
  ];
  for (const slot of typed) {
    const label = spokenWords(slot.argument);
    out.push(`${action} ${phraseFor(slot.slotType, label)} {${slot.slot}}`);
  }
  if (typed.length > 1) {
    out.push(
      `${action} ${typed.map((s) => `${phraseFor(s.slotType, spokenWords(s.argument))} {${s.slot}}`).join(' ')}`,
    );
  }
  if (query) {
    const label = spokenWords(query.argument);
    out.push(
      `${action} ${label} {${query.slot}}`,
      `${action} for {${query.slot}}`,
      `${action} {${query.slot}}`,
    );
  }
  out.push(`help me ${action}`, `${action} now`, `i'd like to ${action}`);

  return dedupe(out.filter((u) => validUtterance(u, tool.slots))).slice(0, MAX_UTTERANCES);
}

function phraseFor(slotType: string, label: string): string {
  switch (slotType) {
    case 'AMAZON.DATE':
      return `${label} on`;
    case 'AMAZON.NUMBER':
      return `${label}`;
    case 'YesNoType':
      return `${label}`;
    default:
      return `${label}`;
  }
}
