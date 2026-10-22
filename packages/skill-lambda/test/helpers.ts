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
  server: { name: 'hotels-and-weather' },
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
  sessionId?: string;
  /** The account-linked token Alexa puts on the request once the user has linked. */
  accessToken?: string;
  /** Test seam for ASK's directive service (Progressive Response). */
  enqueue?: (request: unknown) => Promise<void>;
  /** Test seam for ASK's UPS service (the device's time zone). */
  timeZone?: (deviceId: string) => Promise<string>;
  /** A device with a screen: the APL interface and a viewport (D55). Omit for a speaker. */
  screen?: {
    pixelWidth: number;
    pixelHeight: number;
    currentPixelWidth?: number;
    currentPixelHeight?: number;
    theme?: string;
  };
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
      sessionId: fake.sessionId ?? 'amzn1.echo-api.session.abc',
      application: { applicationId: 'amzn1.ask.skill.x' },
      user: { userId: 'amzn1.ask.account.USER' },
      attributes: fake.sessionAttributes ?? {},
    },
    context: {
      System: {
        application: { applicationId: 'amzn1.ask.skill.x' },
        user: {
          userId: 'amzn1.ask.account.USER',
          ...(fake.accessToken ? { accessToken: fake.accessToken } : {}),
        },
        apiEndpoint: 'https://api.amazonalexa.com',
        device: {
          deviceId: 'amzn1.ask.device.D1',
          supportedInterfaces: fake.screen
            ? { 'Alexa.Presentation.APL': { runtime: { maxVersion: '2024.3' } } }
            : {},
        },
      },
      ...(fake.screen ? { Viewport: fake.screen } : {}),
    },
    request,
  } as unknown as RequestEnvelope;
  return {
    requestEnvelope,
    attributesManager: AttributesManagerFactory.init({ requestEnvelope }),
    responseBuilder: ResponseFactory.init(),
    context: {},
    ...(fake.enqueue || fake.timeZone
      ? {
          serviceClientFactory: {
            getDirectiveServiceClient: () => ({ enqueue: fake.enqueue }),
            getUpsServiceClient: () => ({ getSystemTimeZone: fake.timeZone }),
          },
        }
      : {}),
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
