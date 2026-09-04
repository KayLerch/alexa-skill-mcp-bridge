import askSdk from 'ask-sdk-core';
import type { HandlerInput } from 'ask-sdk-core';
import type { RequestEnvelope, Slot } from 'ask-sdk-model';
import { parseConfig, type ToolManifest } from '@alexa-mcp-bridge/core';

const { AttributesManagerFactory, ResponseFactory } = askSdk;

export const config = parseConfig({
  mcp: { url: 'https://example.com/mcp' },
  skill: { invocationName: 'hotel helper' },
});

export const manifest: ToolManifest = {
  _generated: { by: 'test', notice: 'test' },
  protocolVersion: '2025-11-25',
  server: { name: 'sample-hotel-and-weather' },
  tools: [
    {
      name: 'search_hotels',
      intent: 'SearchHotelsIntent',
      slots: [
        { argument: 'checkIn', slot: 'checkIn', slotType: 'AMAZON.DATE', required: true },
        { argument: 'guests', slot: 'guests', slotType: 'AMAZON.NUMBER', required: false },
        {
          argument: 'roomType',
          slot: 'roomType',
          slotType: 'SearchHotelsRoomTypeType',
          required: false,
        },
        {
          argument: 'destination',
          slot: 'destination',
          slotType: 'AMAZON.SearchQuery',
          required: true,
        },
      ],
      elicitedArguments: [],
      inputSchema: {},
    },
  ],
  examplePhrases: ['search hotels in Berlin', 'get weather for Hamburg'],
};

export interface FakeRequest {
  type?: 'LaunchRequest' | 'IntentRequest' | 'SessionEndedRequest';
  intent?: string;
  slots?: Record<string, Slot>;
  sessionAttributes?: Record<string, unknown>;
}

export function handlerInput(fake: FakeRequest = {}): HandlerInput {
  const type = fake.type ?? (fake.intent ? 'IntentRequest' : 'LaunchRequest');
  const request =
    type === 'IntentRequest'
      ? {
          type,
          requestId: 'r1',
          timestamp: '2026-09-03T00:00:00Z',
          locale: 'en-US',
          dialogState: 'COMPLETED',
          intent: {
            name: fake.intent as string,
            confirmationStatus: 'NONE',
            slots: fake.slots ?? {},
          },
        }
      : { type, requestId: 'r1', timestamp: '2026-09-03T00:00:00Z', locale: 'en-US' };
  const requestEnvelope = {
    version: '1.0',
    session: {
      new: type === 'LaunchRequest',
      sessionId: 'amzn1.echo-api.session.abc',
      application: { applicationId: 'amzn1.ask.skill.x' },
      user: { userId: 'amzn1.ask.account.USER' },
      attributes: fake.sessionAttributes ?? {},
    },
    context: {
      System: {
        application: { applicationId: 'amzn1.ask.skill.x' },
        user: { userId: 'amzn1.ask.account.USER' },
        apiEndpoint: 'https://api.amazonalexa.com',
      },
    },
    request,
  } as unknown as RequestEnvelope;
  return {
    requestEnvelope,
    attributesManager: AttributesManagerFactory.init({ requestEnvelope }),
    responseBuilder: ResponseFactory.init(),
    context: {},
  } as HandlerInput;
}

export function slot(name: string, value: string, resolved?: { name: string; id: string }): Slot {
  return {
    name,
    value,
    confirmationStatus: 'NONE',
    ...(resolved
      ? {
          resolutions: {
            resolutionsPerAuthority: [
              {
                authority: 'x',
                status: { code: 'ER_SUCCESS_MATCH' },
                values: [{ value: resolved }],
              },
            ],
          },
        }
      : {}),
  } as Slot;
}
