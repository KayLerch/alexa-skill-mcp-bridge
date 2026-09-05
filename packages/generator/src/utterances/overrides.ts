import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ManifestSlot } from '@alexa-mcp-bridge/core';
import { dedupe, normalizeUtterance, validUtterance } from './validate.js';

/**
 * Everything a developer adds to the interaction model by hand lives in
 * skill-package/overrides/<locale>.utterances.json and survives `npm run generate`. The
 * generated files are never the place to edit; this one is.
 *
 *   {
 *     "FindParkIntent": ["which park is good for {activity}"],     extra samples for a generated intent
 *     "catchAll": ["somewhere warm in winter"],                      training phrases for the catch-all slot
 *     "slotSynonyms": { "ActivityType": { "wildlife watching": ["animals", "seeing wildlife"] } },
 *     "intents": [{ "name": "WhereToGoIntent", "tool": "find_park", "samples": ["where should i go in {month}"] }]
 *   }
 *
 * An entry under "intents" is an extra intent for an existing tool: its slots are the tool's, so
 * samples use the tool's slot names, and the Lambda routes it through the manifest with no code.
 * Keys starting with an underscore are comments.
 */
const aliasIntentSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Z][A-Za-z0-9]*Intent$/, 'intent names are PascalCase and end in Intent'),
  tool: z.string().min(1),
  samples: z.array(z.string()).min(1),
});
export type AliasIntent = z.infer<typeof aliasIntentSchema>;

const overridesSchema = z.record(
  z.string(),
  z.union([
    z.array(z.string()),
    z.string(),
    z.record(z.string(), z.record(z.string(), z.array(z.string()))),
    z.array(aliasIntentSchema),
  ]),
);

export interface Overrides {
  /** Intent name → extra samples. */
  utterances: Record<string, string[]>;
  /** Training phrases for the catch-all request slot. */
  catchAll: string[];
  /** Slot type name → value → spoken synonyms. */
  slotSynonyms: Record<string, Record<string, string[]>>;
  /** Extra intents that route to an existing tool. */
  intents: AliasIntent[];
}

export type UtteranceOverrides = Overrides['utterances'];

const RESERVED = new Set(['catchAll', 'slotSynonyms', 'intents']);

export function readOverrides(path: string): Overrides {
  const empty: Overrides = { utterances: {}, catchAll: [], slotSynonyms: {}, intents: [] };
  if (!existsSync(path)) return empty;
  const parsed = overridesSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `${path}: intent names map to arrays of utterances; "catchAll" is an array; ` +
        `"slotSynonyms" maps type → value → synonyms; "intents" is an array of {name, tool, samples}.`,
    );
  }
  const out: Overrides = { ...empty, utterances: {}, slotSynonyms: {}, intents: [], catchAll: [] };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key.startsWith('_')) continue;
    if (key === 'catchAll' && Array.isArray(value)) {
      out.catchAll = value.filter((v): v is string => typeof v === 'string');
    } else if (
      key === 'slotSynonyms' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out.slotSynonyms = value as Overrides['slotSynonyms'];
    } else if (key === 'intents' && Array.isArray(value)) {
      out.intents = value.filter((v): v is AliasIntent => typeof v === 'object');
    } else if (!RESERVED.has(key) && Array.isArray(value)) {
      out.utterances[key] = value.filter((v): v is string => typeof v === 'string');
    }
  }
  return out;
}

export interface MergeReport {
  utterances: string[];
  rejected: string[];
}

export function mergeOverrides(
  generated: string[],
  overrides: string[] | undefined,
  slots: ManifestSlot[],
): MergeReport {
  const rejected: string[] = [];
  const accepted: string[] = [];
  for (const raw of overrides ?? []) {
    const u = normalizeUtterance(raw);
    if (validUtterance(u, slots)) accepted.push(u);
    else rejected.push(raw);
  }
  // Overrides come first so they survive the cap.
  return { utterances: dedupe([...accepted, ...generated]), rejected };
}
