import { join } from 'node:path';
import {
  alexaPlusVersionWarning,
  type BridgeConfig,
  type ManifestTool,
  type ToolManifest,
} from '@alexa-mcp-bridge/core';
import { buildInteractionModel, type InteractionModel } from './interaction-model.js';
import { buildManifest } from './manifest.js';
import { spokenWords } from './names.js';
import { scanServer, type ScanResult } from './scan.js';
import { modelUtterances } from './utterances/model.js';
import { combineOverrides, mergeOverrides, readOverrides } from './utterances/overrides.js';
import { templateUtterances } from './utterances/template.js';
import { importTraining, readTraining } from './training.js';
import { writeGeneratedJson } from './write.js';

/**
 * The generate pipeline: scan → manifest → utterances per locale → interaction model → files.
 * Deterministic except for model-written utterances (off with useModel: false).
 */

export interface GeneratePaths {
  manifest: string;
  interactionModelDir: string;
  overridesDir: string;
  /** A profile folder's overrides, read after overridesDir so they win (D56). */
  profileOverridesDir?: string | undefined;
  /** Where `npm run chat -- --record` writes what developers actually said. */
  trainingDir: string;
}

export function defaultPaths(repoRoot: string, profileDir?: string): GeneratePaths {
  return {
    profileOverridesDir: profileDir ? join(profileDir, 'overrides') : undefined,
    manifest: join(repoRoot, 'packages/skill-lambda/generated/tool-manifest.json'),
    interactionModelDir: join(repoRoot, 'skill-package/interactionModels/custom'),
    overridesDir: join(repoRoot, 'skill-package/overrides'),
    trainingDir: join(repoRoot, 'skill-package/training'),
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
  const versionWarning = alexaPlusVersionWarning(scan.protocolVersion);
  if (versionWarning) log(`warning: ${versionWarning}`);

  const { manifest: draft, customTypes } = buildManifest(scan, [], config.tools.hiddenArguments);
  for (const [field, tool] of directCalls(config)) {
    if (!scan.tools.some((t) => t.name === tool)) {
      notes.push(`${field} names the tool ${tool}, which the server does not list`);
    }
  }
  const models: Record<string, InteractionModel> = {};
  const files: string[] = [];
  let examplePhrases: string[] = [];

  for (const locale of config.skill.locales) {
    const overridesFile = `${locale}.utterances.json`;
    const repoOverrides = readOverrides(join(paths.overridesDir, overridesFile));
    const overrides = paths.profileOverridesDir
      ? combineOverrides(
          repoOverrides,
          readOverrides(join(paths.profileOverridesDir, overridesFile)),
        )
      : repoOverrides;
    const training = importTraining(
      readTraining(join(paths.trainingDir, `${locale}.chat.jsonl`)),
      draft.tools,
    );
    const learned = Object.values(training.utterances).flat().length;
    if (learned || training.catchAll.length) {
      log(
        `Learned from chat: ${learned} utterances, ${training.catchAll.length} catch-all phrases`,
      );
    }
    for (const s of training.skipped) notes.push(`${locale} chat training skipped ${s}`);
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
      const merged = mergeOverrides(
        generated.utterances,
        [...(overrides.utterances[tool.intent] ?? []), ...(training.utterances[tool.intent] ?? [])],
        tool.slots,
      );
      for (const r of merged.rejected)
        notes.push(`${locale} override for ${tool.intent} rejected: "${r}"`);
      utterancesByIntent[tool.intent] = merged.utterances;
    }
    for (const [intent, extra] of Object.entries(overrides.utterances)) {
      if (!utterancesByIntent[intent] && !draft.tools.some((t) => t.intent === intent)) {
        notes.push(
          `${locale} override for unknown intent ${intent} ignored (${extra.length} utterances)`,
        );
      }
    }
    // Alias intents from overrides: a second route to an existing tool, no handler needed.
    const aliases = overrides.intents.flatMap((alias) => {
      const tool = draft.tools.find((t) => t.name === alias.tool && !t.aliasOf);
      if (!tool) {
        notes.push(`${locale} override intent ${alias.name} names unknown tool ${alias.tool}`);
        return [];
      }
      const merged = mergeOverrides([], alias.samples, tool.slots);
      for (const r of merged.rejected)
        notes.push(`${locale} override intent ${alias.name} rejected: "${r}"`);
      if (merged.utterances.length === 0) return [];
      if (!draft.tools.some((t) => t.intent === alias.name)) {
        draft.tools.push({ ...tool, intent: alias.name, aliasOf: tool.name });
      }
      return [{ name: alias.name, tool, samples: merged.utterances }];
    });
    if (examplePhrases.length === 0) {
      examplePhrases = draft.tools
        .filter((tool) => !tool.aliasOf)
        .slice(0, 2)
        .map((tool) => examplePhrase(tool, utterancesByIntent[tool.intent] ?? []));
    }
    const model = buildInteractionModel(
      draft,
      utterancesByIntent,
      customTypes,
      config.skill.invocationName,
      {
        toolIntents: config.features.toolIntents,
        catchAll: config.features.catchAll,
        catchAllPhrases: [...overrides.catchAll, ...training.catchAll],
        aliases,
        slotSynonyms: overrides.slotSynonyms,
        builtIns: Object.keys(config.intents.builtIns),
        fallbackSensitivity: config.skill.fallbackSensitivity,
        answerChoices: config.answers.choices,
      },
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

/** The tools the bridge calls itself (D57, D59), with the config field that names each. */
function directCalls(config: BridgeConfig): [string, string][] {
  const calls: [string, string][] = [];
  if (config.skill.launch) calls.push(['skill.launch', config.skill.launch.tool]);
  for (const [intent, action] of Object.entries(config.intents.builtIns)) {
    if (action && 'tool' in action) calls.push([`intents.builtIns.${intent}`, action.tool]);
  }
  return calls;
}

/**
 * A phrase for the greeting and help (plan D3): the first utterance whose slots all have a
 * value a listener would say, else the first one without slots, else the tool's name. A free-text
 * slot is filled only from the argument's JSON Schema `examples` or `default`, never with a
 * placeholder such as "some destination" (D61).
 */
export function examplePhrase(tool: ManifestTool, utterances: string[]): string {
  const fill = (utterance: string): string | undefined => {
    let complete = true;
    const phrase = utterance.replace(/\{([^{}]*)\}/g, (_m, slotName: string) => {
      const value = exampleValue(tool, slotName);
      if (value === undefined) complete = false;
      return value ?? '';
    });
    return complete ? phrase : undefined;
  };
  for (const utterance of utterances.filter((u) => u.includes('{'))) {
    const phrase = fill(utterance);
    if (phrase) return phrase;
  }
  return utterances.find((u) => !u.includes('{')) ?? spokenWords(tool.name);
}

function exampleValue(tool: ManifestTool, slotName: string): string | undefined {
  const slot = tool.slots.find((s) => s.slot === slotName);
  if (!slot) return undefined;
  switch (slot.slotType) {
    case 'AMAZON.DATE':
      return 'tomorrow';
    case 'AMAZON.NUMBER':
      return 'two';
    case 'YesNoType':
      return 'yes';
    case 'AMAZON.SearchQuery':
      return schemaExample(tool.inputSchema, slot.argument);
    default:
      return slot.customType?.values[0]?.value;
  }
}

/** The argument's own example, as the server's schema states it: `examples[0]`, else `default`. */
function schemaExample(inputSchema: Record<string, unknown>, argument: string): string | undefined {
  const properties = inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
  const property = properties?.[argument];
  const examples = property?.examples;
  const candidate = Array.isArray(examples) ? examples[0] : property?.default;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim().toLowerCase()
    : undefined;
}
