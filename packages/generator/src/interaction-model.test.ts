import { describe, expect, it } from 'vitest';
import type { CustomSlotType, ToolManifest } from '@alexa-mcp-bridge/core';
import {
  CATCH_ALL_TYPE_NAME,
  answerIntentSlots,
  buildInteractionModel,
} from './interaction-model.js';

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

  it('keeps only the answer intents named in answerIntents (D69)', () => {
    const names = buildInteractionModel(manifest, utterances, types, 'bridge demo', {
      toolIntents: false,
      answerIntents: ['choice'],
    }).interactionModel.languageModel.intents.map((i) => i.name);
    expect(names).toContain('ChoiceAnswerIntent');
    // "yes" and "no" are not answer intents to drop: without them they fall to Fallback.
    expect(names).toEqual(expect.arrayContaining(['AMAZON.YesIntent', 'AMAZON.NoIntent']));
    expect(names).not.toContain('DateAnswerIntent');
    expect(names).not.toContain('NumberAnswerIntent');
    expect(names).not.toContain('FreeTextAnswerIntent');
  });

  it('trains the catch-all on every phrase, short ones and aliases too, when tool intents are off (D69)', () => {
    const many = {
      FindParkIntent: [
        'find park',
        ...Array.from({ length: 150 }, (_, n) => `find a park number ${'x'.repeat(n + 1)}`),
      ],
    };
    const tool = manifest.tools[0]!;
    const model = buildInteractionModel(manifest, many, types, 'bridge demo', {
      toolIntents: false,
      aliases: [{ name: 'WhereToGoIntent', tool, samples: ['where to go'] }],
    }).interactionModel.languageModel;
    const values = model.types
      .find((t) => t.name === CATCH_ALL_TYPE_NAME)!
      .values.map((v) => v.name.value);
    expect(values).toContain('find park');
    expect(values).toContain('where to go');
    expect(values.length).toBeGreaterThan(150);
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

  it('always ships Repeat and Next, and adds a mapped built-in once (D59)', () => {
    const model = buildInteractionModel(manifest, utterances, types, 'bridge demo', {
      builtIns: ['AMAZON.NextIntent', 'AMAZON.StartOverIntent', 'AMAZON.StopIntent'],
    }).interactionModel.languageModel;
    const names = model.intents.map((i) => i.name);
    expect(names).toContain('AMAZON.RepeatIntent');
    expect(names.filter((n) => n === 'AMAZON.NextIntent')).toHaveLength(1);
    expect(names.filter((n) => n === 'AMAZON.StopIntent')).toHaveLength(1);
    expect(names).toContain('AMAZON.StartOverIntent');
  });

  it('sets the fallback sensitivity only when configured (D60)', () => {
    expect(build(true).modelConfiguration).toBeUndefined();
    const model = buildInteractionModel(manifest, utterances, types, 'bridge demo', {
      fallbackSensitivity: 'LOW',
    }).interactionModel.languageModel;
    expect(model.modelConfiguration).toEqual({ fallbackIntentSensitivity: { level: 'LOW' } });
  });
});

describe('answer choices (answers.choices, D67)', () => {
  const choiceType = (options: Parameters<typeof buildInteractionModel>[4], t = types) =>
    buildInteractionModel(
      manifest,
      utterances,
      t,
      'bridge demo',
      options,
    ).interactionModel.languageModel.types.find((type) => type.name === 'AnswerChoiceType');

  it('adds each canonical choice with its synonyms, the canonical value as id and name', () => {
    const type = choiceType({ answerChoices: { b: ['bee', 'be', 'option b'], "c'est": [] } });
    expect(type?.values).toContainEqual({
      id: 'b',
      name: { value: 'b', synonyms: ['bee', 'be', 'option b'] },
    });
    expect(type?.values).toContainEqual({ id: 'c_est', name: { value: "c'est" } });
    expect(type?.values.map((v) => v.name.value)).toContain('fishing');
  });

  it('folds synonyms into a tool enum value that is already there', () => {
    const type = choiceType({ answerChoices: { fishing: ['angling'] } });
    expect(type?.values.filter((v) => v.name.value === 'fishing')).toEqual([
      { name: { value: 'fishing', synonyms: ['angling'] } },
    ]);
  });

  it('gives a server without enums the choice intent once choices are configured', () => {
    const noEnums = types.filter((t) => t.name === 'YesNoType');
    const without = buildInteractionModel(manifest, utterances, noEnums, 'bridge demo')
      .interactionModel.languageModel;
    expect(without.intents.map((i) => i.name)).not.toContain('ChoiceAnswerIntent');
    const model = buildInteractionModel(manifest, utterances, noEnums, 'bridge demo', {
      answerChoices: { a: ['ay'] },
    }).interactionModel.languageModel;
    expect(model.intents.map((i) => i.name)).toContain('ChoiceAnswerIntent');
    expect(model.types.find((t) => t.name === 'AnswerChoiceType')?.values).toEqual([
      { id: 'a', name: { value: 'a', synonyms: ['ay'] } },
    ]);
  });
});

describe('answer intent samples', () => {
  it('lets a choice be said inside a sentence', () => {
    const choice = build(true).intents.find((i) => i.name === 'ChoiceAnswerIntent');
    expect(choice?.samples).toEqual([
      '{choice}',
      'i think it is {choice}',
      "i think it's {choice}",
      "it's {choice}",
      'it is {choice}',
      'option {choice}',
      'answer {choice}',
      'letter {choice}',
      'the answer is {choice}',
      'go with {choice}',
      "i'll go with {choice}",
      'i choose {choice}',
      'i pick {choice}',
      '{choice} please',
      "i'd say {choice}",
      "let's say {choice}",
      'make it {choice}',
    ]);
  });

  // A quiz server whose answer argument is free text: its generated intent can say what the
  // bridge's FreeTextAnswerIntent says, and Alexa refuses one sample string in two intents.
  const quiz: ToolManifest = {
    ...manifest,
    tools: [
      ...manifest.tools,
      {
        name: 'submit_answer',
        intent: 'SubmitAnswerIntent',
        slots: [
          { argument: 'answer', slot: 'answer', slotType: 'AMAZON.SearchQuery', required: true },
        ],
        elicitedArguments: [],
        inputSchema: {},
      },
    ],
  };
  const quizUtterances = {
    ...utterances,
    SubmitAnswerIntent: ['submit answer {answer}', 'the answer is {answer}', "it's {answer}"],
  };

  it('never puts one sample string in two intents; the tool intent keeps it', () => {
    const model = buildInteractionModel(quiz, quizUtterances, types, 'bridge demo', {
      answerChoices: { b: ['bee'] },
    }).interactionModel.languageModel;
    const all = model.intents.flatMap((i) => i.samples ?? []);
    expect(new Set(all).size).toBe(all.length);
    const samples = (name: string) => model.intents.find((i) => i.name === name)?.samples ?? [];
    expect(samples('SubmitAnswerIntent')).toContain('the answer is {answer}');
    expect(samples('FreeTextAnswerIntent')).not.toContain('the answer is {answer}');
    expect(samples('FreeTextAnswerIntent')).toContain('my answer is {answer}');
    // Same carrier, different slot: allowed, and the choice keeps its own.
    expect(samples('ChoiceAnswerIntent')).toContain('the answer is {choice}');
  });

  it('puts extra samples for the answer intents first', () => {
    const model = buildInteractionModel(manifest, utterances, types, 'bridge demo', {
      answerSamples: {
        ChoiceAnswerIntent: ['my pick is {choice}', 'i think it is {choice}'],
        FreeTextAnswerIntent: ['my guess is {answer}'],
      },
    }).interactionModel.languageModel;
    const samples = (name: string) => model.intents.find((i) => i.name === name)?.samples ?? [];
    expect(samples('ChoiceAnswerIntent').slice(0, 3)).toEqual([
      'my pick is {choice}',
      'i think it is {choice}',
      '{choice}',
    ]);
    expect(
      samples('ChoiceAnswerIntent').filter((u) => u === 'i think it is {choice}'),
    ).toHaveLength(1);
    expect(samples('FreeTextAnswerIntent')[0]).toBe('my guess is {answer}');
  });

  it('names the slots of the answer intents an overrides file may extend', () => {
    expect(answerIntentSlots('ChoiceAnswerIntent')).toEqual([
      { argument: 'choice', slot: 'choice', slotType: 'AnswerChoiceType', required: false },
    ]);
    expect(answerIntentSlots('DateAnswerIntent')?.[0]?.slotType).toBe('AMAZON.DATE');
    expect(answerIntentSlots('FindParkIntent')).toBeUndefined();
    expect(answerIntentSlots('AMAZON.YesIntent')).toBeUndefined();
  });
});
