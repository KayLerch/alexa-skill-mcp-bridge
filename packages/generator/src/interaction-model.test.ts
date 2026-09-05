import { describe, expect, it } from 'vitest';
import type { CustomSlotType, ToolManifest } from '@alexa-mcp-bridge/core';
import { CATCH_ALL_TYPE_NAME, buildInteractionModel } from './interaction-model.js';

const manifest: ToolManifest = {
  _generated: { by: 'test', notice: 'test' },
  protocolVersion: '2025-11-25',
  server: { name: 'parks' },
  tools: [
    {
      name: 'find_park',
      intent: 'FindParkIntent',
      slots: [
        {
          argument: 'activity',
          slot: 'activity',
          slotType: 'FindParkActivityType',
          required: false,
        },
      ],
      elicitedArguments: [],
      inputSchema: {},
    },
  ],
  examplePhrases: [],
};

const utterances = {
  FindParkIntent: ['find park', 'find park for {activity}', 'what is the best park for {activity}'],
};

const types: CustomSlotType[] = [
  { name: 'FindParkActivityType', values: [{ value: 'fishing' }] },
  { name: 'YesNoType', values: [{ value: 'yes' }] },
];

const build = (toolIntents: boolean) =>
  buildInteractionModel(manifest, utterances, types, 'bridge demo', { toolIntents })
    .interactionModel.languageModel;

describe('buildInteractionModel', () => {
  it('generates one intent per tool by default, with the tool slot types', () => {
    const model = build(true);
    expect(model.intents.map((i) => i.name)).toContain('FindParkIntent');
    expect(model.types.map((t) => t.name)).toContain('FindParkActivityType');
    const freeText = model.intents.find((i) => i.name === 'FreeTextIntent');
    expect(freeText?.slots?.[0]?.type).toBe('AMAZON.SearchQuery');
  });

  it('adds a catch-all request intent beside the tool intents by default', () => {
    const model = build(true);
    const catchAll = model.intents.find((i) => i.name === 'SpokenRequestIntent');
    expect(catchAll?.slots?.[0]?.type).toBe(CATCH_ALL_TYPE_NAME);
    // A bare slot sample is what makes an utterance without a carrier phrase match at all, and
    // the slot has its own name because Alexa binds a slot name to one type model-wide.
    expect(catchAll?.samples?.[0]).toBe('{request}');
    const freeText = model.intents.find((i) => i.name === 'FreeTextIntent');
    expect(freeText?.slots?.[0]?.type).toBe('AMAZON.SearchQuery');
    // The generated utterances are reused as training phrases, slots replaced by a word.
    const type = model.types.find((t) => t.name === CATCH_ALL_TYPE_NAME);
    expect(type?.values.map((v) => v.name.value)).toContain('find park for something');
  });

  it('gives one-word answers to any choice question a home', () => {
    const model = build(true);
    const choice = model.intents.find((i) => i.name === 'ChoiceAnswerIntent');
    expect(choice?.samples?.[0]).toBe('{choice}');
    const type = model.types.find((t) => t.name === 'AnswerChoiceType');
    expect(type?.values.map((v) => v.name.value)).toContain('fishing');
  });

  it('drops tool intents and their types when toolIntents is off, keeping the catch-all', () => {
    const model = build(false);
    expect(model.intents.map((i) => i.name)).not.toContain('FindParkIntent');
    expect(model.types.map((t) => t.name)).not.toContain('FindParkActivityType');
    expect(model.intents.map((i) => i.name)).toContain('SpokenRequestIntent');
  });

  it('keeps the answer and standard intents in both modes', () => {
    for (const toolIntents of [true, false]) {
      const names = build(toolIntents).intents.map((i) => i.name);
      // Single words fall to AMAZON.FallbackIntent, which carries no text, so spoken answers
      // need their own intents whichever way the tool intents are configured.
      expect(names).toEqual(
        expect.arrayContaining([
          'AMAZON.YesIntent',
          'AMAZON.NoIntent',
          'DateAnswerIntent',
          'NumberAnswerIntent',
          'AMAZON.StopIntent',
          'AMAZON.FallbackIntent',
        ]),
      );
    }
  });
});
