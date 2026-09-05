import {
  GENERATED_BY,
  GENERATED_NOTICE,
  type CustomSlotType,
  type GeneratedMarker,
  type ManifestTool,
  type ToolManifest,
} from '@alexa-mcp-bridge/core';

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
 * "stargazing", "january", "yosemite": one word in reply to a question with choices. Without this
 * intent a bare enum value lands in AMAZON.FallbackIntent, which carries no text, and the Lambda
 * can only repeat the question. The answer handler only accepts it while a question is pending.
 */
export function choiceAnswerIntent(): AlexaIntent {
  return {
    name: 'ChoiceAnswerIntent',
    slots: [{ name: 'choice', type: ANSWER_CHOICE_TYPE_NAME }],
    samples: [
      '{choice}',
      '{choice} please',
      "i'd say {choice}",
      "let's say {choice}",
      'make it {choice}',
    ],
  };
}

/** Union of every enum value across tools, deduplicated by id. */
export function answerChoiceType(types: CustomSlotType[]): CustomSlotType | undefined {
  const values = new Map<string, CustomSlotType['values'][number]>();
  for (const type of types) {
    if (type.name === 'YesNoType') continue;
    for (const v of type.values) if (!values.has(v.id ?? v.value)) values.set(v.id ?? v.value, v);
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

/** Slot-free versions of the generated utterances, as phrases a person might actually say. */
function catchAllTraining(utterances: string[]): string[] {
  const phrases = utterances
    .map((u) =>
      u
        .replace(/\{[^{}]*\}/g, 'something')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((u) => u.split(' ').length > 2);
  return [...new Set(phrases)].sort().slice(0, 100);
}

export const STANDARD_INTENTS: AlexaIntent[] = [
  { name: 'AMAZON.HelpIntent' },
  { name: 'AMAZON.StopIntent' },
  { name: 'AMAZON.CancelIntent' },
  { name: 'AMAZON.FallbackIntent' },
  { name: 'AMAZON.NavigateHomeIntent' },
];

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
  const generatedUtterances = manifest.tools.flatMap((t) => utterancesByIntent[t.intent] ?? []);

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
    ? [...new Set([...catchAllTraining(generatedUtterances), ...(options.catchAllPhrases ?? [])])]
    : [];
  const requestIntents: AlexaIntent[] = [
    FREE_TEXT_INTENT,
    ...(withCatchAll ? [catchAllIntent()] : []),
  ];

  const toolTypes = withToolIntents
    ? customTypes
    : customTypes.filter((t) => t.name === 'YesNoType');
  const choices = answerChoiceType(customTypes);
  const answerIntents = choices ? [...ANSWER_INTENTS, choiceAnswerIntent()] : ANSWER_INTENTS;
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
        intents: [
          ...toolIntents,
          ...aliasIntents,
          ...answerIntents,
          ...requestIntents,
          ...STANDARD_INTENTS,
        ],
        types: types.map((t) => ({
          name: t.name,
          values: t.values.map((v) => ({
            ...(v.id ? { id: v.id } : {}),
            name: { value: v.value, ...(v.synonyms?.length ? { synonyms: v.synonyms } : {}) },
          })),
        })),
      },
    },
  };
}
