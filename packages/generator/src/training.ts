import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ManifestTool } from '@alexa-mcp-bridge/core';
import { normalizeUtterance, validUtterance } from './utterances/validate.js';

/**
 * What developers say to `npm run chat -- --record` is the best guess anyone has at what they
 * will say to the device. Each line of skill-package/training/<locale>.chat.jsonl is one turn:
 * the text, and the tool the agent chose for it. Here that becomes sample utterances: enum
 * values in the text turn into the tool's slots, the rest stays literal, and anything that will
 * not shape into a valid sample still trains the catch-all slot as a phrase.
 */
export const trainingRecordSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(['turn', 'answer']),
  tool: z.string().optional(),
  expects: z.string().optional(),
  at: z.string().optional(),
});
export type TrainingRecord = z.infer<typeof trainingRecordSchema>;

export interface TrainingImport {
  /** Intent name → samples learned from chat. */
  utterances: Record<string, string[]>;
  /** Phrases that did not fit a tool's slots but are worth the catch-all knowing. */
  catchAll: string[];
  /** Lines that could not be used, with the reason, for the generate report. */
  skipped: string[];
}

export function readTraining(path: string): TrainingRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = trainingRecordSchema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
}

export function importTraining(records: TrainingRecord[], tools: ManifestTool[]): TrainingImport {
  const utterances: Record<string, string[]> = {};
  const catchAll = new Set<string>();
  const skipped: string[] = [];

  for (const record of records) {
    if (record.kind !== 'turn') continue; // answers are covered by the answer intents
    const text = normalizeUtterance(record.text);
    if (!text || /[0-9]/.test(text)) {
      skipped.push(`"${record.text}": digits or empty`);
      continue;
    }
    const tool = tools.find((t) => t.name === record.tool);
    if (!tool) {
      // No tool was called: still a real phrasing of a request, so the catch-all learns it.
      if (text.split(' ').length > 2) catchAll.add(text);
      continue;
    }
    const sample = withSlots(text, tool);
    if (validUtterance(sample, tool.slots)) {
      (utterances[tool.intent] ??= []).push(sample);
    } else if (text.split(' ').length > 2) {
      catchAll.add(text);
    } else {
      skipped.push(`"${record.text}": too short for a sample`);
    }
  }
  for (const key of Object.keys(utterances)) utterances[key] = [...new Set(utterances[key])];
  return { utterances, catchAll: [...catchAll], skipped };
}

/** Replace spoken enum values with the tool's slot for that argument, longest values first. */
function withSlots(text: string, tool: ManifestTool): string {
  let out = text;
  const replacements: { spoken: string; slot: string }[] = [];
  for (const slot of tool.slots) {
    for (const value of slot.customType?.values ?? []) {
      for (const spoken of [value.value, ...(value.synonyms ?? [])]) {
        replacements.push({ spoken: spoken.toLowerCase(), slot: slot.slot });
      }
    }
  }
  replacements.sort((a, b) => b.spoken.length - a.spoken.length);
  for (const { spoken, slot } of replacements) {
    if (out.includes(`{${slot}}`)) continue;
    const pattern = new RegExp(`\\b${spoken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (pattern.test(out)) out = out.replace(pattern, `{${slot}}`);
  }
  return out;
}
