import type { CustomSlotType, ManifestSlot } from '@alexa-mcp-bridge/core';
import { pascalCase, slotNameFor, spokenWords } from './names.js';

/**
 * JSON Schema properties → Alexa slots (brief 5.6 step 3). Rules that Alexa enforces are
 * enforced here: at most one AMAZON.SearchQuery slot per intent; extra free-text arguments
 * get no slot and are left to the agent to elicit.
 */

export const YES_NO_TYPE: CustomSlotType = {
  name: 'YesNoType',
  values: [
    { value: 'yes', id: 'yes', synonyms: ['yeah', 'yep', 'sure', 'correct', 'right', 'okay'] },
    { value: 'no', id: 'no', synonyms: ['nope', 'nah', 'negative', 'not really'] },
  ],
};

export interface SlotPlan {
  slots: ManifestSlot[];
  elicitedArguments: string[];
  /** Custom types this intent needs (enum types and YesNoType), deduplicated by the caller. */
  customTypes: CustomSlotType[];
}

type Property = Record<string, unknown> & { type?: string | string[] };

const DATE_NAME =
  /(^|[^a-z])(date|day|when|check_?in|check_?out|arrival|departure|from|until|till|start|end)($|[^a-z])/i;

export function planSlots(toolName: string, inputSchema: Record<string, unknown>): SlotPlan {
  const properties = (inputSchema.properties ?? {}) as Record<string, Property>;
  const required = new Set((inputSchema.required as string[] | undefined) ?? []);
  const slots: ManifestSlot[] = [];
  const customTypes: CustomSlotType[] = [];
  const freeText: string[] = [];

  for (const [argument, schema] of Object.entries(properties)) {
    const kind = classify(argument, schema);
    if (kind === 'searchQuery') {
      freeText.push(argument);
      continue;
    }
    const slot: ManifestSlot = {
      argument,
      slot: slotNameFor(argument),
      slotType:
        kind === 'yesNo'
          ? YES_NO_TYPE.name
          : kind === 'enum'
            ? enumTypeName(toolName, argument)
            : kind,
      required: required.has(argument),
    };
    if (kind === 'yesNo') {
      slot.customType = YES_NO_TYPE;
      customTypes.push(YES_NO_TYPE);
    } else if (kind === 'enum') {
      const type = enumType(toolName, argument, schema);
      slot.customType = type;
      customTypes.push(type);
    }
    slots.push(slot);
  }

  // One AMAZON.SearchQuery per intent: the first required free-text argument, else the first one.
  const primary = freeText.find((a) => required.has(a)) ?? freeText[0];
  if (primary !== undefined) {
    slots.push({
      argument: primary,
      slot: slotNameFor(primary),
      slotType: 'AMAZON.SearchQuery',
      required: required.has(primary),
    });
  }
  const elicitedArguments = freeText.filter((a) => a !== primary);

  return { slots, elicitedArguments, customTypes };
}

type SlotKind = 'AMAZON.DATE' | 'AMAZON.NUMBER' | 'yesNo' | 'enum' | 'searchQuery';

export function classify(argument: string, schema: Property): SlotKind {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'boolean') return 'yesNo';
  if (type === 'integer' || type === 'number') return 'AMAZON.NUMBER';
  if (enumValues(schema).length > 0) return 'enum';
  if (schema.format === 'date' || schema.format === 'date-time' || DATE_NAME.test(argument)) {
    return 'AMAZON.DATE';
  }
  return 'searchQuery';
}

export function enumValues(schema: Property): { value: string; id: string }[] {
  const titled = (schema.oneOf ?? schema.anyOf) as
    Array<{ const?: unknown; title?: string }> | undefined;
  if (Array.isArray(titled)) {
    return titled
      .filter((o) => o.const !== undefined)
      .map((o) => ({ value: o.title ?? String(o.const), id: String(o.const) }));
  }
  const values = schema.enum as unknown[] | undefined;
  if (Array.isArray(values)) {
    const names = schema.enumNames as string[] | undefined;
    return values.map((v, i) => ({ value: names?.[i] ?? String(v), id: String(v) }));
  }
  return [];
}

export function enumTypeName(toolName: string, argument: string): string {
  return `${pascalCase(toolName)}${pascalCase(argument)}Type`;
}

/** Alexa rejects an entity-resolution id with whitespace; the spoken value stays as written. */
export function slotValueId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function enumType(toolName: string, argument: string, schema: Property): CustomSlotType {
  return {
    name: enumTypeName(toolName, argument),
    values: enumValues(schema).map(({ value, id }) => {
      const spoken = spokenWords(value) || value.toLowerCase();
      const safeId = slotValueId(id);
      return spoken === value
        ? { value, id: safeId }
        : { value: spoken, id: safeId, synonyms: [value] };
    }),
  };
}
