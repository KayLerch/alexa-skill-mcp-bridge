import {
  GENERATED_BY,
  GENERATED_NOTICE,
  type BridgeConfig,
  type CustomSlotType,
  type ManifestTool,
  type ToolManifest,
} from '@alexa-mcp-bridge/core';
import { intentNameFor } from './names.js';
import type { ScanResult } from './scan.js';
import { planSlots } from './slots.js';

/** The manifest plus the custom types the interaction model needs. */
export interface ManifestBuild {
  manifest: ToolManifest;
  customTypes: CustomSlotType[];
}

export function buildManifest(
  scan: ScanResult,
  config: BridgeConfig,
  examplePhrases: string[],
): ManifestBuild {
  const types = new Map<string, CustomSlotType>();
  const tools: ManifestTool[] = scan.tools.map((tool) => {
    const plan = planSlots(tool.name, tool.inputSchema);
    for (const t of plan.customTypes) types.set(t.name, t);
    return {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      intent: intentNameFor(tool.name),
      slots: plan.slots,
      elicitedArguments: plan.elicitedArguments,
      inputSchema: tool.inputSchema,
    };
  });

  return {
    manifest: {
      _generated: { by: GENERATED_BY, notice: GENERATED_NOTICE, source: config.mcp.url },
      protocolVersion: scan.protocolVersion,
      server: scan.server,
      tools,
      examplePhrases,
    },
    customTypes: [...types.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
