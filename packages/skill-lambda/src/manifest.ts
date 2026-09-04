import type { HandlerInput } from 'ask-sdk-core';
import askSdk from 'ask-sdk-core';
import type { IntentRequest, Slot } from 'ask-sdk-model';
import type { ManifestTool, SlotValue, ToolManifest } from '@alexa-mcp-bridge/core';

const { getRequestType, getIntentName } = askSdk;

/** Intent → tool and slot → argument, from the generated manifest. */
export function toolForIntent(
  manifest: ToolManifest,
  intentName: string,
): ManifestTool | undefined {
  return manifest.tools.find((t) => t.intent === intentName);
}

export function intentNameOf(input: HandlerInput): string | undefined {
  if (getRequestType(input.requestEnvelope) !== 'IntentRequest') return undefined;
  return getIntentName(input.requestEnvelope);
}

/** Filled slots keyed by tool argument name, with entity resolution where Alexa provides it. */
export function slotValuesFor(tool: ManifestTool, input: HandlerInput): Record<string, SlotValue> {
  const request = input.requestEnvelope.request as IntentRequest;
  const slots = request.intent?.slots ?? {};
  const out: Record<string, SlotValue> = {};
  for (const mapping of tool.slots) {
    const slot = slots[mapping.slot];
    const value = slotValue(slot, mapping.slotType);
    if (value) out[mapping.argument] = value;
  }
  return out;
}

export function slotValue(slot: Slot | undefined, slotType: string): SlotValue | undefined {
  if (!slot?.value) return undefined;
  const match = slot.resolutions?.resolutionsPerAuthority?.find(
    (r) => r.status?.code === 'ER_SUCCESS_MATCH' && r.values?.length,
  );
  const resolved = match?.values?.[0]?.value;
  return {
    value: slot.value,
    ...(resolved?.name ? { resolvedValue: resolved.name } : {}),
    ...(resolved?.id ? { resolvedId: resolved.id } : {}),
    slotType,
  };
}
