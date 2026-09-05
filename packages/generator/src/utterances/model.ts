import { readFileSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { BridgeConfig, ManifestTool } from '@alexa-mcp-bridge/core';
import {
  MAX_UTTERANCES,
  MIN_UTTERANCES,
  slotCombinations,
  templateUtterances,
} from './template.js';
import { dedupe, normalizeUtterance, slotKey, validUtterance } from './validate.js';

/**
 * Model-written utterances from Nova 2 Lite via Converse, validated and topped up from the
 * templates. Any failure (no credentials, no model access, bad output) falls back to templates
 * and reports why, so `npm run generate` always finishes.
 */
const PROMPT = new URL('../../prompts/utterances.md', import.meta.url);
const outputSchema = z.array(z.string()).min(1);

export interface ModelUtteranceResult {
  utterances: string[];
  source: 'model' | 'template';
  note?: string;
}

export async function modelUtterances(
  tool: ManifestTool,
  config: BridgeConfig,
  locale: string,
  client: BedrockRuntimeClient = new BedrockRuntimeClient({ region: config.aws.region }),
): Promise<ModelUtteranceResult> {
  const fallback = templateUtterances(tool);
  try {
    const prompt = renderPrompt(tool, locale);
    const response = await client.send(
      new ConverseCommand({
        modelId: config.agent.modelId,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        // Room for the whole array: a three-slot tool is asked for about thirty utterances.
        inferenceConfig: { maxTokens: 2500, temperature: 0.7 },
      }),
    );
    const text = response.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const parsed = outputSchema.parse(JSON.parse(json));
    const valid = dedupe(
      parsed.map(normalizeUtterance).filter((u) => validUtterance(u, tool.slots)),
    );
    const merged = topUp(valid, fallback, tool);
    if (valid.length < MIN_UTTERANCES / 2) {
      return {
        utterances: merged,
        source: 'template',
        note: `model returned ${valid.length} valid utterances`,
      };
    }
    return { utterances: merged, source: 'model' };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { utterances: fallback, source: 'template', note: reason };
  }
}

/**
 * Model utterances first, then template utterances for any slot combination the model missed,
 * then whatever else fits. Alexa cannot match a combination that no sample utterance carries,
 * so coverage outranks naturalness when the two compete for the last slots in the list.
 */
export function topUp(valid: string[], fallback: string[], tool: ManifestTool): string[] {
  const covered = new Set(valid.map(slotKey));
  const missing = new Set(
    slotCombinations(tool.slots)
      .map((c) =>
        c
          .map((s) => s.slot)
          .sort()
          .join('+'),
      )
      .filter((key) => !covered.has(key)),
  );
  const repairs = fallback.filter((u) => missing.has(slotKey(u)));
  return dedupe([...valid, ...repairs, ...fallback]).slice(0, MAX_UTTERANCES);
}

/** Combinations the model is asked to cover, as a checklist it can work through. */
function combinationList(tool: ManifestTool): string {
  const combinations = slotCombinations(tool.slots);
  if (combinations.length === 0) return '- (no typed slots)';
  return combinations.map((c) => `- ${c.map((s) => `{${s.slot}}`).join(' and ')}`).join('\n');
}

function renderPrompt(tool: ManifestTool, locale: string): string {
  const searchQuery = tool.slots.find((s) => s.slotType === 'AMAZON.SearchQuery');
  const combinations = slotCombinations(tool.slots);
  const vars: Record<string, string> = {
    toolName: tool.name,
    description: tool.description ?? '(no description)',
    slotList: tool.slots.length
      ? tool.slots
          .map((s) => `- {${s.slot}} (${s.slotType}) for the argument "${s.argument}"`)
          .join('\n')
      : '- (none)',
    combinationList: combinationList(tool),
    targetCount: String(Math.min(MAX_UTTERANCES, Math.max(12, combinations.length * 3 + 6))),
    locale,
    searchQuerySlot: searchQuery ? `{${searchQuery.slot}}` : '{none}',
  };
  return readFileSync(PROMPT, 'utf8').replace(
    /\{\{([\w-]+)\}\}/g,
    (_m, key: string) => vars[key] ?? '',
  );
}
