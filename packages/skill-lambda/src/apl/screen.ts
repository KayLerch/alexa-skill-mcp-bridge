import type { HandlerInput } from 'ask-sdk-core';
import type { Directive } from 'ask-sdk-model';
import type { Display, Visual } from '@alexa-mcp-bridge/core';

/**
 * The screen of an Alexa+ device (D55). The agent returns the MCP server's widget as a JPEG; the
 * Alexa Skill shows it as one full-screen APL Image. Nothing is drawn here and nothing on it can be tapped.
 */
export const APL_INTERFACE = 'Alexa.Presentation.APL';
export const SCREEN_TOKEN = 'bridge-screen';

/** Alexa caps a response at 120 KB; the whole response stays under this, speech included. */
export const MAX_RESPONSE_BYTES = 115 * 1024;

/** APL 2023.3: the first version every current screen device runs; an Image-only document needs no more. */
const APL_VERSION = '2023.3';

interface Viewport {
  pixelWidth?: number;
  pixelHeight?: number;
  currentPixelWidth?: number;
  currentPixelHeight?: number;
  theme?: string;
}

export function supportsApl(input: HandlerInput): boolean {
  const interfaces = input.requestEnvelope.context?.System?.device?.supportedInterfaces as
    Record<string, unknown> | undefined;
  return Boolean(interfaces && interfaces[APL_INTERFACE]);
}

/**
 * The envelope's display for a device with APL: the pixels currently available, else the maximum;
 * theme from the viewport, else dark. Undefined for a speaker or a viewport without a usable size.
 */
export function displayOf(input: HandlerInput): Display | undefined {
  if (!supportsApl(input)) return undefined;
  const viewport = (input.requestEnvelope.context as { Viewport?: Viewport }).Viewport;
  const width = positive(viewport?.currentPixelWidth) ?? positive(viewport?.pixelWidth);
  const height = positive(viewport?.currentPixelHeight) ?? positive(viewport?.pixelHeight);
  if (!width || !height) return undefined;
  return { width, height, theme: viewport?.theme === 'light' ? 'light' : 'dark' };
}

function positive(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** One RenderDocument: a black screen with the picture best-fit and centred. */
export function screenDirective(visual: Visual): Directive {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: SCREEN_TOKEN,
    document: {
      type: 'APL',
      version: APL_VERSION,
      mainTemplate: {
        items: [
          {
            type: 'Image',
            width: '100vw',
            height: '100vh',
            source: visual.dataUrl,
            scale: 'best-fit',
            align: 'center',
            backgroundColor: 'black',
          },
        ],
      },
    },
  } as unknown as Directive;
}
