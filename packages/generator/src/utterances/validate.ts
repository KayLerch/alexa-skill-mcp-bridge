import type { ManifestSlot } from '@alexa-mcp-bridge/core';

/**
 * Alexa's rules for sample utterances, applied to model output and overrides alike:
 * lowercase words, no digits or punctuation (apostrophes and hyphens allowed), only known slots,
 * and a SearchQuery slot alone with a carrier phrase.
 */
export function normalizeUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z'{}\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validUtterance(utterance: string, slots: ManifestSlot[]): boolean {
  if (!utterance || /[0-9]/.test(utterance)) return false;
  const used = [...utterance.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] as string);
  if ((utterance.match(/\{/g) ?? []).length !== used.length) return false;
  const known = new Map(slots.map((s) => [s.slot, s]));
  if (used.some((u) => !known.has(u))) return false;
  if (new Set(used).size !== used.length) return false;
  const searchQuery = used.filter((u) => known.get(u)?.slotType === 'AMAZON.SearchQuery');
  if (searchQuery.length > 0) {
    if (used.length > 1) return false;
    const carrier = utterance.replace(/\{[^{}]*\}/, '').trim();
    if (!carrier) return false;
  }
  const bare = utterance.replace(/\{[^{}]*\}/g, '').trim();
  return bare.length > 0 || used.length > 0;
}

export function dedupe(utterances: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of utterances) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
