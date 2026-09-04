import { join } from 'node:path';
import type { BridgeConfig, ManifestTool, ToolManifest } from '@alexa-mcp-bridge/core';
import { buildInteractionModel, type InteractionModel } from './interaction-model.js';
import { buildManifest } from './manifest.js';
import { spokenWords } from './names.js';
import { scanServer, type ScanResult } from './scan.js';
import { modelUtterances } from './utterances/model.js';
import { mergeOverrides, readOverrides } from './utterances/overrides.js';
import { templateUtterances } from './utterances/template.js';
import { writeGeneratedJson } from './write.js';

/**
 * The generate pipeline: scan → manifest → utterances per locale → interaction model → files.
 * Deterministic except for model-written utterances (off with useModel: false).
 */

export interface GeneratePaths {
  manifest: string;
  interactionModelDir: string;
  overridesDir: string;
}

export function defaultPaths(repoRoot: string): GeneratePaths {
  return {
    manifest: join(repoRoot, 'packages/skill-lambda/generated/tool-manifest.json'),
    interactionModelDir: join(repoRoot, 'skill-package/interactionModels/custom'),
    overridesDir: join(repoRoot, 'skill-package/overrides'),
  };
}

export interface GenerateOptions {
  config: BridgeConfig;
  paths: GeneratePaths;
  useModel: boolean;
  scan?: ScanResult;
  log?: (line: string) => void;
}

export interface GenerateResult {
  manifest: ToolManifest;
  models: Record<string, InteractionModel>;
  files: string[];
  notes: string[];
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { config, paths } = options;
  const log = options.log ?? (() => undefined);
  const notes: string[] = [];

  const scan = options.scan ?? (await scanServer(config));
  log(
    `Scanned ${scan.server.name} (MCP ${scan.protocolVersion}): ${scan.tools.map((t) => t.name).join(', ')}`,
  );

  const { manifest: draft, customTypes } = buildManifest(scan, config, []);
  const models: Record<string, InteractionModel> = {};
  const files: string[] = [];
  let examplePhrases: string[] = [];

  for (const locale of config.skill.locales) {
    const overrides = readOverrides(join(paths.overridesDir, `${locale}.utterances.json`));
    const utterancesByIntent: Record<string, string[]> = {};
    for (const tool of draft.tools) {
      const generated = options.useModel
        ? await modelUtterances(tool, config, locale)
        : { utterances: templateUtterances(tool), source: 'template' as const };
      if (generated.source === 'template' && options.useModel) {
        notes.push(
          `${tool.name}: template utterances used (${generated.note ?? 'model unavailable'})`,
        );
      }
      const merged = mergeOverrides(generated.utterances, overrides[tool.intent], tool.slots);
      for (const r of merged.rejected)
        notes.push(`${locale} override for ${tool.intent} rejected: "${r}"`);
      utterancesByIntent[tool.intent] = merged.utterances;
    }
    for (const [intent, extra] of Object.entries(overrides)) {
      if (!utterancesByIntent[intent] && !draft.tools.some((t) => t.intent === intent)) {
        notes.push(
          `${locale} override for unknown intent ${intent} ignored (${extra.length} utterances)`,
        );
      }
    }
    if (examplePhrases.length === 0) {
      examplePhrases = draft.tools
        .slice(0, 2)
        .map((tool) => examplePhrase(tool, utterancesByIntent[tool.intent] ?? []));
    }
    const model = buildInteractionModel(
      draft,
      utterancesByIntent,
      customTypes,
      config.skill.invocationName,
    );
    models[locale] = model;
    const file = join(paths.interactionModelDir, `${locale}.json`);
    writeGeneratedJson(file, model as unknown as Record<string, unknown>);
    files.push(file);
  }

  const manifest: ToolManifest = { ...draft, examplePhrases };
  writeGeneratedJson(paths.manifest, manifest);
  files.push(paths.manifest);

  return { manifest, models, files, notes };
}

/** The first utterance with its slots filled with spoken placeholders, for the greeting (plan D3). */
export function examplePhrase(tool: ManifestTool, utterances: string[]): string {
  const withSlots =
    utterances.find((u) => u.includes('{')) ?? utterances[0] ?? spokenWords(tool.name);
  return withSlots.replace(/\{([^{}]*)\}/g, (_m, slotName: string) => {
    const slot = tool.slots.find((s) => s.slot === slotName);
    switch (slot?.slotType) {
      case 'AMAZON.DATE':
        return 'tomorrow';
      case 'AMAZON.NUMBER':
        return 'two';
      case 'YesNoType':
        return 'yes';
      case 'AMAZON.SearchQuery':
        return `some ${spokenWords(slot.argument)}`;
      default:
        return slot?.customType?.values[0]?.value ?? spokenWords(slot?.argument ?? slotName);
    }
  });
}
