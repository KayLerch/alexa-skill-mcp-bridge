import {
  GENERATED_BY,
  GENERATED_NOTICE,
  type CustomSlotType,
  type GeneratedMarker,
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

export const STANDARD_INTENTS: AlexaIntent[] = [
  { name: 'AMAZON.HelpIntent' },
  { name: 'AMAZON.StopIntent' },
  { name: 'AMAZON.CancelIntent' },
  { name: 'AMAZON.FallbackIntent' },
  { name: 'AMAZON.NavigateHomeIntent' },
];

export function buildInteractionModel(
  manifest: ToolManifest,
  utterancesByIntent: Record<string, string[]>,
  customTypes: CustomSlotType[],
  invocationName: string,
): InteractionModel {
  const toolIntents: AlexaIntent[] = manifest.tools.map((tool) => ({
    name: tool.intent,
    slots: tool.slots.map((s) => ({ name: s.slot, type: s.slotType })),
    samples: utterancesByIntent[tool.intent] ?? [],
  }));

  return {
    _generated: { by: GENERATED_BY, notice: GENERATED_NOTICE, source: manifest._generated.source },
    interactionModel: {
      languageModel: {
        invocationName,
        intents: [...toolIntents, ...ANSWER_INTENTS, FREE_TEXT_INTENT, ...STANDARD_INTENTS],
        types: customTypes.map((t) => ({
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
