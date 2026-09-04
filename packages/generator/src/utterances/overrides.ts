import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ManifestSlot } from '@alexa-mcp-bridge/core';
import { dedupe, normalizeUtterance, validUtterance } from './validate.js';

/**
 * Developer-authored utterances in skill-package/overrides/<locale>.utterances.json survive
 * regeneration. Shape: { "SearchHotelsIntent": ["find me a hotel in {destination}"], ... }.
 */
const overridesSchema = z.record(z.string(), z.array(z.string()));
export type UtteranceOverrides = z.infer<typeof overridesSchema>;

export function readOverrides(path: string): UtteranceOverrides {
  if (!existsSync(path)) return {};
  const parsed = overridesSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${path} must map intent names to arrays of utterances.`);
  }
  return parsed.data;
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
