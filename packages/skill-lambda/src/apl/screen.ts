import type { HandlerInput, RequestInterceptor } from 'ask-sdk-core';
import type { Directive } from 'ask-sdk-model';
import {
  SCREEN_IDLE_TIMEOUT_MS,
  type BridgeConfig,
  type Display,
  type Visual,
} from '@alexa-mcp-bridge/core';

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

const IDLE_TIMEOUT_ATTRIBUTE = 'screenIdleTimeoutMs';

/** Hands visual.idleTimeoutMs to render() for this request, which knows no config (D68). */
export function screenSettingsInterceptor(config: BridgeConfig): RequestInterceptor {
  return {
    process: (input: HandlerInput) => {
      const attributes = input.attributesManager.getRequestAttributes();
      attributes[IDLE_TIMEOUT_ATTRIBUTE] = config.visual.idleTimeoutMs;
      input.attributesManager.setRequestAttributes(attributes);
    },
  };
}

/** The screen's idle timeout for this request: the config's, else the default. */
export function screenIdleTimeoutMs(input: HandlerInput): number {
  const value: unknown = input.attributesManager.getRequestAttributes()[IDLE_TIMEOUT_ATTRIBUTE];
  return typeof value === 'number' ? value : SCREEN_IDLE_TIMEOUT_MS;
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

/**
 * One RenderDocument: a black screen with the picture best-fit and centred. `settings.idleTimeout`
 * (document level, milliseconds) asks the device to keep it up that long without activity; the
 * device's own default took it down too early (D68). A recommendation the device may bound.
 */
export function screenDirective(
  visual: Visual,
  idleTimeoutMs: number = SCREEN_IDLE_TIMEOUT_MS,
): Directive {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: SCREEN_TOKEN,
    document: {
      type: 'APL',
      version: APL_VERSION,
      settings: { idleTimeout: idleTimeoutMs },
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
