import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest.js';
import type { ScannedTool } from './scan.js';

const build = (tools: ScannedTool[]) =>
  buildManifest({ server: { name: 'test' }, protocolVersion: '2025-11-25', tools }, []).manifest;

/** Every slot name across the model with the one type Alexa allows it. */
function slotTypes(tools: ReturnType<typeof build>['tools']): Map<string, Set<string>> {
  const types = new Map<string, Set<string>>();
  for (const tool of tools)
    for (const slot of tool.slots)
      types.set(slot.slot, (types.get(slot.slot) ?? new Set()).add(slot.slotType));
  return types;
}

describe('buildManifest slot names', () => {
  it('renames a slot that is custom-typed in one tool and built-in-typed in another', () => {
    const tools = build([
      {
        name: 'list_items',
        inputSchema: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['task', 'note'] } },
        },
      },
      {
        name: 'search_items',
        inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
      },
    ]).tools;

    for (const [slot, types] of slotTypes(tools)) expect([slot, types.size]).toEqual([slot, 1]);
    expect(tools[0]?.slots.map((s) => [s.slot, s.slotType])).toEqual([['kind', 'KindType']]);
    expect(tools[1]?.slots.map((s) => [s.slot, s.argument, s.slotType])).toEqual([
      ['kindSearchItems', 'kind', 'AMAZON.SearchQuery'],
    ]);
  });

  it('leaves a slot name alone when every tool gives it the same type', () => {
    const tools = build([
      {
        name: 'find_park',
        inputSchema: { type: 'object', properties: { park: { type: 'string' } } },
      },
      {
        name: 'plan_visit',
        inputSchema: { type: 'object', properties: { park: { type: 'string' } } },
      },
    ]).tools;

    expect(tools.flatMap((t) => t.slots.map((s) => s.slot))).toEqual(['park', 'park']);
  });
});
