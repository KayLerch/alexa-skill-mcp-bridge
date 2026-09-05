import {
  GENERATED_BY,
  GENERATED_NOTICE,
  type CustomSlotType,
  type ManifestTool,
  type ToolManifest,
} from '@alexa-mcp-bridge/core';
import { intentNameFor, pascalCase } from './names.js';
import type { ScanResult } from './scan.js';
import { planSlots } from './slots.js';

/** The manifest plus the custom types the interaction model needs. */
export interface ManifestBuild {
  manifest: ToolManifest;
  customTypes: CustomSlotType[];
}

export function buildManifest(scan: ScanResult, examplePhrases: string[]): ManifestBuild {
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

  const shared = shareSlotTypes(tools, types);

  return {
    manifest: {
      _generated: { by: GENERATED_BY, notice: GENERATED_NOTICE },
      protocolVersion: scan.protocolVersion,
      server: scan.server,
      tools,
      examplePhrases,
    },
    customTypes: [...shared.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Alexa binds a slot name to exactly one type across the whole model, so two tools that both
 * take `month` must agree. When their value sets match, they share one `MonthType`; when they
 * differ, the second tool's slot is renamed (`monthFindPark`) and keeps its own type. The
 * manifest maps slot names back to arguments, so the Lambda is unaffected either way.
 */
function shareSlotTypes(
  tools: ManifestTool[],
  types: Map<string, CustomSlotType>,
): Map<string, CustomSlotType> {
  const shared = new Map<string, CustomSlotType>();
  const byArgument = new Map<string, CustomSlotType>();
  const fingerprint = (t: CustomSlotType) =>
    JSON.stringify(t.values.map((v) => v.id ?? v.value).sort());
  for (const tool of tools) {
    for (const slot of tool.slots) {
      if (!slot.customType || slot.customType.name === 'YesNoType') continue;
      const argumentType = `${pascalCase(slot.argument)}Type`;
      const existing = byArgument.get(slot.argument);
      if (!existing) {
        const renamed = { ...slot.customType, name: argumentType };
        byArgument.set(slot.argument, renamed);
        shared.set(renamed.name, renamed);
        slot.customType = renamed;
        slot.slotType = renamed.name;
      } else if (fingerprint(existing) === fingerprint(slot.customType)) {
        slot.customType = existing;
        slot.slotType = existing.name;
      } else {
        // Same argument name, different values: this tool keeps its own type and slot name.
        shared.set(slot.customType.name, slot.customType);
        slot.slot = `${slot.slot}${pascalCase(tool.name)}`;
      }
    }
  }
  for (const t of types.values()) if (t.name === 'YesNoType') shared.set(t.name, t);
  return shared;
}
