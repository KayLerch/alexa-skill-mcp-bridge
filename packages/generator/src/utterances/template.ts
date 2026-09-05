import type { ManifestSlot, ManifestTool } from '@alexa-mcp-bridge/core';
import { spokenWords } from '../names.js';
import { dedupe, validUtterance } from './validate.js';

/**
 * Deterministic utterances from the tool name and slots. Two jobs: the floor under model-written
 * utterances when there are no credentials, and the coverage guarantee. Alexa matches a partly
 * filled request only when a sample utterance carries that exact slot combination, so every
 * combination appears here in more than one word order. Naturalness is the model's job; this is
 * about leaving no combination unmatchable.
 */
export const MIN_UTTERANCES = 8;
export const MAX_UTTERANCES = 60;

/** Beyond this many typed slots, generating every subset stops being worth the model size. */
const FULL_SUBSET_LIMIT = 4;

/**
 * Every combination of typed slots worth a sample utterance, smallest first. With more than
 * four typed slots, only singles, pairs and the full set: the rest add size without matches.
 */
export function slotCombinations(slots: ManifestSlot[]): ManifestSlot[][] {
  const typed = slots.filter((s) => s.slotType !== 'AMAZON.SearchQuery');
  const all: ManifestSlot[][] = [];
  for (let mask = 1; mask < 1 << typed.length; mask++) {
    all.push(typed.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  const wanted =
    typed.length <= FULL_SUBSET_LIMIT
      ? all
      : all.filter((c) => c.length <= 2 || c.length === typed.length);
  return wanted.sort(
    (a, b) =>
      a.length - b.length ||
      typed.indexOf(a[0] as ManifestSlot) - typed.indexOf(b[0] as ManifestSlot),
  );
}

export function templateUtterances(tool: ManifestTool): string[] {
  const action = spokenWords(tool.name) || 'do it';
  const query = tool.slots.find((s) => s.slotType === 'AMAZON.SearchQuery');
  const carriers = [action, `can you ${action}`, `i want to ${action}`];

  const out: string[] = [
    action,
    `${action} please`,
    `can you ${action}`,
    `i want to ${action}`,
    `please ${action}`,
    `help me ${action}`,
    `i'd like to ${action}`,
  ];

  slotCombinations(tool.slots).forEach((combination, index) => {
    const forward = combination.map(phrase).join(' ');
    out.push(`${action} ${forward}`);
    if (combination.length > 1) {
      // The same slots in the other order: Alexa matches word patterns, not bags of slots.
      out.push(`${action} ${[...combination].reverse().map(phrase).join(' ')}`);
      out.push(`${carriers[index % carriers.length] as string} ${forward}`);
    }
  });

  if (query) {
    const label = spokenWords(query.argument);
    out.push(
      `${action} ${label} {${query.slot}}`,
      `${action} for {${query.slot}}`,
      `${action} {${query.slot}}`,
    );
  }

  return dedupe(out.filter((u) => validUtterance(u, tool.slots))).slice(0, MAX_UTTERANCES);
}

/** "for {activity}", "in {month}", "on {checkIn}" — a connector beats naming the argument. */
function phrase(slot: ManifestSlot): string {
  return `${connector(slot)} {${slot.slot}}`.trim();
}

const IN_NAME = /(month|season|year|state|city|country|region|area|park|place|location|where)/i;
const FOR_NAME = /(activity|activities|type|kind|category|topic|subject|guests|people|person)/i;

function connector(slot: ManifestSlot): string {
  if (slot.slotType === 'AMAZON.DATE') return 'on';
  if (IN_NAME.test(slot.argument)) return 'in';
  if (FOR_NAME.test(slot.argument) || slot.slotType === 'AMAZON.NUMBER') return 'for';
  if (slot.slotType === 'YesNoType') return spokenWords(slot.argument);
  return spokenWords(slot.argument);
}
