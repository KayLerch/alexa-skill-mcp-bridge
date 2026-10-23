import {
  GENERATED_BY,
  GENERATED_NOTICE,
  spelledLetterIntentName,
  type CustomSlotType,
  type GeneratedMarker,
  type ManifestSlot,
  type ManifestTool,
  type ToolManifest,
} from '@alexa-mcp-bridge/core';
import { slotValueId } from './slots.js';

/**
 * The Alexa interaction model for one locale: generated tool intents, the answer intents the
 * Lambda needs for pending questions, FreeTextIntent, the standard intents, and custom types.
 */

export interface AlexaSlot {
  name: string;
  type: string;
}
export interface AlexaIntent {
  name: string;
  slots?: AlexaSlot[];
  samples?: string[];
}
export interface AlexaType {
  name: string;
  values: { id?: string; name: { value: string; synonyms?: string[] } }[];
}
export interface InteractionModel {
  _generated: GeneratedMarker;
  interactionModel: {
    languageModel: {
      invocationName: string;
      intents: AlexaIntent[];
      types: AlexaType[];
      modelConfiguration?: { fallbackIntentSensitivity: { level: 'LOW' | 'MEDIUM' | 'HIGH' } };
    };
  };
}

/** Answer intents: they only fire while a question is pending (brief 5.5). */
export const ANSWER_INTENTS: AlexaIntent[] = [
  { name: 'AMAZON.YesIntent' },
  { name: 'AMAZON.NoIntent' },
  {
    name: 'DateAnswerIntent',
    slots: [{ name: 'date', type: 'AMAZON.DATE' }],
    samples: [
      '{date}',
      'on {date}',
      'the {date}',
      "it's {date}",
      'from {date}',
      'starting {date}',
      'make it {date}',
    ],
  },
  {
    name: 'NumberAnswerIntent',
    slots: [{ name: 'number', type: 'AMAZON.NUMBER' }],
    samples: [
      '{number}',
      '{number} people',
      '{number} of them',
      'make it {number}',
      'the number is {number}',
      'just {number}',
      '{number} please',
    ],
  },
  {
    name: 'FreeTextAnswerIntent',
    slots: [{ name: 'answer', type: 'AMAZON.SearchQuery' }],
    samples: [
      'the answer is {answer}',
      "i'd say {answer}",
      "it's {answer}",
      'answer {answer}',
      'my answer is {answer}',
      'i mean {answer}',
    ],
  },
];

/** The closest thing to how Alexa+ receives requests: free text with a carrier phrase. */
export const FREE_TEXT_INTENT: AlexaIntent = {
  name: 'FreeTextIntent',
  slots: [{ name: 'query', type: 'AMAZON.SearchQuery' }],
  samples: [
    'ask {query}',
    'tell {query}',
    'i want to {query}',
    'please {query}',
    'can you {query}',
    'i need {query}',
    'help me {query}',
  ],
};

/** Training values, not a closed list: Alexa passes through phrases that are not in it. */
export const CATCH_ALL_TYPE_NAME = 'SpokenRequestType';
/** Every enum value of every tool, so a one-word answer to any choice question has a home. */
export const ANSWER_CHOICE_TYPE_NAME = 'AnswerChoiceType';

/**
 * The catch-all form of the free-text intent, used when features.toolIntents is off.
 *
 * `AMAZON.SearchQuery` cannot stand alone in a sample utterance: the model build fails with
 * MissingCarrierPhraseWithPhraseSlot (measured 2026-09-05). A custom slot type has no such rule,
 * builds with a bare `{query}` sample, and passes untrained phrases through, so this catches a
 * whole spoken request with or without a carrier phrase. Built-in intents still win their own
 * words: "yes", "no", "stop", "help" and "cancel" resolve to AMAZON.* , not here. Single words
 * fall to AMAZON.FallbackIntent, which is why the answer intents above stay either way.
 */
export function catchAllIntent(): AlexaIntent {
  // Its own slot name: Alexa binds a slot name to one type model-wide, and `query` is SearchQuery.
  return {
    name: 'SpokenRequestIntent',
    slots: [{ name: 'request', type: CATCH_ALL_TYPE_NAME }],
    samples: ['{request}', 'ask {request}', 'tell me {request}', 'i want {request}'],
  };
}

/**
 * "stargazing", "january", "yosemite", "b": a choice in reply to a question, alone or inside a
 * sentence ("i think it's b", "option b"). Without this intent a bare enum value lands in
 * AMAZON.FallbackIntent, which carries no text, and the Lambda can only repeat the question.
 * The carriers repeat FreeTextAnswerIntent's on purpose: a different slot makes them different
 * samples to Alexa, and the custom slot wins when the words are one of its values.
 */
export function choiceAnswerIntent(): AlexaIntent {
  return {
    name: 'ChoiceAnswerIntent',
    slots: [{ name: 'choice', type: ANSWER_CHOICE_TYPE_NAME }],
    samples: [
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
    ],
  };
}

/**
 * The slots of one of the bridge's own answer intents, in the manifest's shape, so an overrides
 * file can add samples to it and have them checked like a tool's. Undefined for any other intent.
 */
export function answerIntentSlots(intent: string): ManifestSlot[] | undefined {
  const found = [...ANSWER_INTENTS, choiceAnswerIntent()].find(
    (i) => i.name === intent && i.slots?.length,
  );
  return found?.slots?.map((s) => ({
    argument: s.name,
    slot: s.name,
    slotType: s.type,
    required: false,
  }));
}

/** Alexa refuses one sample string in two intents: the first intent that has it keeps it. */
function uniqueSamples(intents: AlexaIntent[]): AlexaIntent[] {
  const seen = new Set<string>();
  return intents.map((intent) => {
    if (!intent.samples) return intent;
    const samples = intent.samples.filter((u) => !seen.has(u));
    for (const u of samples) seen.add(u);
    return { ...intent, samples };
  });
}

/**
 * Union of every enum value across tools, deduplicated by id, plus `answers.choices` (D67): each
 * canonical choice is a value (its slugged id, its name as written) with the spoken synonyms that
 * resolve to it, folded into a tool value of the same name when there is one.
 */
export function answerChoiceType(
  types: CustomSlotType[],
  choices: Record<string, string[]> = {},
): CustomSlotType | undefined {
  const values = new Map<string, CustomSlotType['values'][number]>();
  for (const type of types) {
    if (type.name === 'YesNoType') continue;
    for (const v of type.values) if (!values.has(v.id ?? v.value)) values.set(v.id ?? v.value, v);
  }
  for (const [choice, synonyms] of Object.entries(choices)) {
    const id = slotValueId(choice);
    const key = [...values.keys()].find((k) => k === id || values.get(k)?.value === choice) ?? id;
    const existing = values.get(key);
    const merged = [...new Set([...(existing?.synonyms ?? []), ...synonyms])];
    values.set(key, {
      ...(existing ?? { value: choice, id }),
      ...(merged.length ? { synonyms: merged } : {}),
    });
  }
  return values.size ? { name: ANSWER_CHOICE_TYPE_NAME, values: [...values.values()] } : undefined;
}

/** Developer synonyms from overrides, folded into the generated types. */
export function withSynonyms(
  types: CustomSlotType[],
  synonyms: Record<string, Record<string, string[]>>,
): CustomSlotType[] {
  return types.map((type) => {
    const extra = synonyms[type.name];
    if (!extra) return type;
    return {
      ...type,
      values: type.values.map((v) => {
        const more = extra[v.value] ?? extra[v.id ?? ''] ?? [];
        return more.length ? { ...v, synonyms: [...new Set([...(v.synonyms ?? []), ...more])] } : v;
      }),
    };
  });
}

/**
 * Slot-free versions of the generated utterances, as phrases a person might actually say. Beside
 * tool intents, a sample: phrases of three words or more, at most 100. As the only route to the
 * agent (tool intents off, D69), all of them, short ones included ("quiz me", "skip"), because a
 * phrase missing here falls to AMAZON.FallbackIntent and loses its words.
 */
function catchAllTraining(utterances: string[], all = false): string[] {
  const phrases = utterances
    .map((u) =>
      u
        .replace(/\{[^{}]*\}/g, 'something')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((u) => u && (all || u.split(' ').length > 2));
  return [...new Set(phrases)].sort().slice(0, all ? CATCH_ALL_MAX_VALUES : 100);
}

/** Well under Alexa's limit on values per custom slot type. */
const CATCH_ALL_MAX_VALUES = 1000;

/** The bridge's own answer intents, by the short name `answers.intents` uses (D69). */
export const ANSWER_INTENT_NAMES = {
  date: 'DateAnswerIntent',
  number: 'NumberAnswerIntent',
  freeText: 'FreeTextAnswerIntent',
  choice: 'ChoiceAnswerIntent',
} as const;
export type AnswerIntentKey = keyof typeof ANSWER_INTENT_NAMES;

/** Repeat replays the last output and Next is a common "skip" (D59); both always ship. */
export const STANDARD_INTENTS: AlexaIntent[] = [
  { name: 'AMAZON.HelpIntent' },
  { name: 'AMAZON.StopIntent' },
  { name: 'AMAZON.CancelIntent' },
  { name: 'AMAZON.FallbackIntent' },
  { name: 'AMAZON.NavigateHomeIntent' },
  { name: 'AMAZON.RepeatIntent' },
  { name: 'AMAZON.NextIntent' },
];

function extraBuiltIns(names: string[]): AlexaIntent[] {
  const standard = new Set(STANDARD_INTENTS.map((i) => i.name));
  return [...new Set(names)].filter((n) => !standard.has(n)).map((name) => ({ name }));
}

export interface InteractionModelOptions {
  /** features.toolIntents: one intent per tool with typed slots. */
  toolIntents?: boolean;
  /** features.catchAll: a bare-phrase intent beside them, so nothing dies in Fallback. */
  catchAll?: boolean;
  /** Extra phrases for the catch-all slot: developer overrides and what chat recorded. */
  catchAllPhrases?: string[];
  /** Extra intents routing to existing tools, from overrides; their samples are pre-merged. */
  aliases?: { name: string; tool: ManifestTool; samples: string[] }[];
  /** Type name → value → synonyms, from overrides. */
  slotSynonyms?: Record<string, Record<string, string[]>>;
  /** Built-in intents mapped in intents.builtIns; added when not standard already (D59). */
  builtIns?: string[];
  /**
   * Intent name → extra samples for the bridge's own answer intents, from overrides, already
   * checked against answerIntentSlots. They come first.
   */
  answerSamples?: Record<string, string[]>;
  /** answers.choices: canonical answer choice → spoken synonyms, for AnswerChoiceType (D67). */
  answerChoices?: Record<string, string[]>;
  /**
   * answers.intents: which of the bridge's own answer intents ship (D69). Unset: all of them. A
   * date or number intent rewrites the words ("on friday" becomes an ISO date), which a server
   * that grades spoken answers may not want; the catch-all then carries them as said.
   */
  answerIntents?: AnswerIntentKey[] | undefined;
  /** skill.fallbackSensitivity: the model's fallbackIntentSensitivity (D60). Unset: Alexa's default. */
  fallbackSensitivity?: 'LOW' | 'MEDIUM' | 'HIGH' | undefined;
}

export function buildInteractionModel(
  manifest: ToolManifest,
  utterancesByIntent: Record<string, string[]>,
  customTypes: CustomSlotType[],
  invocationName: string,
  options: InteractionModelOptions = {},
): InteractionModel {
  const withToolIntents = options.toolIntents ?? true;
  // With tool intents off, the catch-all is the only way a request reaches the agent.
  const withCatchAll = (options.catchAll ?? true) || !withToolIntents;
  const generatedUtterances = [
    ...manifest.tools.flatMap((t) => utterancesByIntent[t.intent] ?? []),
    // Without tool intents an alias has no intent of its own: its phrases train the catch-all.
    ...(withToolIntents ? [] : (options.aliases ?? []).flatMap((a) => a.samples)),
  ];

  const toolIntents: AlexaIntent[] = withToolIntents
    ? manifest.tools
        .filter((tool) => !tool.aliasOf)
        .map((tool) => ({
          name: tool.intent,
          slots: tool.slots.map((s) => ({ name: s.slot, type: s.slotType })),
          samples: utterancesByIntent[tool.intent] ?? [],
        }))
    : [];
  const aliasIntents: AlexaIntent[] = withToolIntents
    ? (options.aliases ?? []).map((alias) => ({
        name: alias.name,
        slots: alias.tool.slots.map((s) => ({ name: s.slot, type: s.slotType })),
        samples: alias.samples,
      }))
    : [];

  // Generated utterances double as training phrases for the catch-all slot: a closed list to
  // Alexa's eye, but it passes through phrases that are not in it, which is the whole point.
  const trainingPhrases = withCatchAll
    ? [
        ...new Set([
          ...catchAllTraining(generatedUtterances, !withToolIntents),
          ...(options.catchAllPhrases ?? []),
        ]),
      ]
    : [];
  const requestIntents: AlexaIntent[] = [
    FREE_TEXT_INTENT,
    ...(withCatchAll ? [catchAllIntent()] : []),
  ];

  const toolTypes = withToolIntents
    ? customTypes
    : customTypes.filter((t) => t.name === 'YesNoType');
  const choices = answerChoiceType(customTypes, options.answerChoices);
  const keep = options.answerIntents
    ? new Set<string>(options.answerIntents.map((k) => ANSWER_INTENT_NAMES[k]))
    : undefined;
  const answerIntents = (choices ? [...ANSWER_INTENTS, choiceAnswerIntent()] : ANSWER_INTENTS)
    // Only the four named intents are optional; AMAZON.YesIntent and NoIntent always ship.
    .filter(
      (intent) =>
        !keep ||
        keep.has(intent.name) ||
        !(Object.values(ANSWER_INTENT_NAMES) as string[]).includes(intent.name),
    )
    .map((intent) => {
      const extra = options.answerSamples?.[intent.name];
      return extra?.length && intent.samples
        ? { ...intent, samples: [...new Set([...extra, ...intent.samples])] }
        : intent;
    });
  // One slot-free intent per single-letter choice, for the spelled form a lone letter arrives in (D74).
  const spelledLetterIntents: AlexaIntent[] =
    choices && (!keep || keep.has('ChoiceAnswerIntent'))
      ? Object.keys(options.answerChoices ?? {})
          .filter((choice) => /^[a-z]$/.test(choice))
          .map((letter) => ({ name: spelledLetterIntentName(letter), samples: [`${letter}.`] }))
      : [];
  const types: CustomSlotType[] = withSynonyms(
    [
      ...toolTypes,
      ...(choices ? [choices] : []),
      ...(withCatchAll
        ? [{ name: CATCH_ALL_TYPE_NAME, values: trainingPhrases.map((value) => ({ value })) }]
        : []),
    ],
    options.slotSynonyms ?? {},
  );

  return {
    _generated: { by: GENERATED_BY, notice: GENERATED_NOTICE },
    interactionModel: {
      languageModel: {
        invocationName,
        // Tool intents first: they keep a sample an answer intent would repeat.
        intents: uniqueSamples([
          ...toolIntents,
          ...aliasIntents,
          ...answerIntents,
          ...spelledLetterIntents,
          ...requestIntents,
          ...STANDARD_INTENTS,
          ...extraBuiltIns(options.builtIns ?? []),
        ]),
        types: types.map((t) => ({
          name: t.name,
          values: t.values.map((v) => ({
            ...(v.id ? { id: v.id } : {}),
            name: { value: v.value, ...(v.synonyms?.length ? { synonyms: v.synonyms } : {}) },
          })),
        })),
        ...(options.fallbackSensitivity
          ? {
              modelConfiguration: {
                fallbackIntentSensitivity: { level: options.fallbackSensitivity },
              },
            }
          : {}),
      },
    },
  };
}
