import { readFileSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { BridgeConfig, ManifestTool } from '@alexa-mcp-bridge/core';
import { MAX_UTTERANCES, MIN_UTTERANCES, templateUtterances } from './template.js';
import { dedupe, normalizeUtterance, validUtterance } from './validate.js';

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
        inferenceConfig: { maxTokens: 800, temperature: 0.7 },
      }),
    );
    const text = response.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const parsed = outputSchema.parse(JSON.parse(json));
    const valid = dedupe(
      parsed.map(normalizeUtterance).filter((u) => validUtterance(u, tool.slots)),
    );
    const merged = dedupe([...valid, ...fallback]).slice(0, MAX_UTTERANCES);
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

function renderPrompt(tool: ManifestTool, locale: string): string {
  const searchQuery = tool.slots.find((s) => s.slotType === 'AMAZON.SearchQuery');
  const vars: Record<string, string> = {
    toolName: tool.name,
    description: tool.description ?? '(no description)',
    slotList: tool.slots.length
      ? tool.slots
          .map((s) => `- {${s.slot}} (${s.slotType}) for the argument "${s.argument}"`)
          .join('\n')
      : '- (none)',
    locale,
    searchQuerySlot: searchQuery ? `{${searchQuery.slot}}` : '{none}',
  };
  return readFileSync(PROMPT, 'utf8').replace(
    /\{\{([\w-]+)\}\}/g,
    (_m, key: string) => vars[key] ?? '',
  );
}
