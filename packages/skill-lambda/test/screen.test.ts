import { describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  parseConfig,
  type AgentInvocationInput,
  type TurnOutput,
  type Visual,
} from '@alexa-mcp-bridge/core';
import { BridgeClient } from '../src/bridge.js';
import { screenSettingsInterceptor } from '../src/apl/screen.js';
import { render } from '../src/render.js';
import { handlerInput } from './helpers.js';

/** The screen, Alexa Skill side (D55): the envelope's display and the APL directive. */
const done: TurnOutput = { status: 'done', speech: 'Hi.', endSession: false, visual: null };
const turn = { type: 'turn', utterance: { text: 'hi' } } as const;

function visual(bytes: number): Visual {
  return {
    kind: 'image',
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${'A'.repeat(bytes)}`,
    width: 1280,
    height: 800,
  };
}

async function envelopeFor(fake: Parameters<typeof handlerInput>[0]) {
  const config = parseConfig({
    mcp: { url: 'https://example.com/mcp' },
    skill: { invocationName: 'hotel helper' },
  });
  const envelopes: AgentInvocationInput[] = [];
  const invoke = vi.fn(async (e: AgentInvocationInput) => {
    envelopes.push(e);
    return done;
  });
  const logger = createLogger({}, { level: 'debug', write: () => undefined });
  const bridge = new BridgeClient({ config, runtimeArn: 'arn:test', logger, invoke });
  await bridge.turn(handlerInput(fake), turn);
  return envelopes[0] as AgentInvocationInput;
}

describe('envelope display', () => {
  it('carries the viewport of a device with APL, dark by default', async () => {
    const e = await envelopeFor({
      intent: 'X',
      screen: { pixelWidth: 1280, pixelHeight: 800 },
    });
    expect(e.display).toEqual({ width: 1280, height: 800, theme: 'dark' });
  });

  it('prefers the current pixel size and the viewport theme', async () => {
    const e = await envelopeFor({
      intent: 'X',
      screen: {
        pixelWidth: 1280,
        pixelHeight: 800,
        currentPixelWidth: 960,
        currentPixelHeight: 600,
        theme: 'light',
      },
    });
    expect(e.display).toEqual({ width: 960, height: 600, theme: 'light' });
  });

  it('is absent on a speaker', async () => {
    const e = await envelopeFor({ intent: 'X' });
    expect(e.display).toBeUndefined();
  });
});

describe('APL screen', () => {
  const screen = { pixelWidth: 1280, pixelHeight: 800 };

  it('adds one RenderDocument with a full-screen best-fit Image', () => {
    const v = visual(1000);
    const response = render(handlerInput({ intent: 'X', screen }), { ...done, visual: v });
    expect(response.directives).toHaveLength(1);
    const d = response.directives?.[0] as unknown as {
      type: string;
      token: string;
      document: { version: string; mainTemplate: { items: Array<Record<string, unknown>> } };
    };
    expect(d.type).toBe('Alexa.Presentation.APL.RenderDocument');
    expect(d.token).toBe('bridge-screen');
    const image = d.document.mainTemplate.items[0];
    expect(image).toMatchObject({
      type: 'Image',
      source: v.dataUrl,
      scale: 'best-fit',
      align: 'center',
      width: '100vw',
      height: '100vh',
    });
    expect(response.outputSpeech).toBeDefined();
  });

  it('adds no directive without a visual or on a speaker', () => {
    expect(render(handlerInput({ intent: 'X', screen }), done).directives).toBeUndefined();
    expect(
      render(handlerInput({ intent: 'X' }), { ...done, visual: visual(10) }).directives,
    ).toBeUndefined();
  });

  it('drops the directive above 115 KB and keeps speech and reprompt', () => {
    const response = render(handlerInput({ intent: 'X', screen }), {
      ...done,
      reprompt: 'More?',
      visual: visual(116 * 1024),
    });
    expect(response.directives).toBeUndefined();
    expect(response.outputSpeech).toBeDefined();
    expect(response.reprompt).toBeDefined();
  });

  it('keeps a visual just under the cap', () => {
    const response = render(handlerInput({ intent: 'X', screen }), {
      ...done,
      visual: visual(110 * 1024),
    });
    expect(response.directives).toHaveLength(1);
  });

  it('coexists with the LinkAccount card', () => {
    const response = render(handlerInput({ intent: 'X', screen }), {
      ...done,
      linkAccount: true,
      visual: visual(100),
    });
    expect(response.card?.type).toBe('LinkAccount');
    expect(response.directives).toHaveLength(1);
  });

  const idleTimeoutOf = (response: ReturnType<typeof render>) =>
    (response.directives?.[0] as unknown as { document: { settings?: { idleTimeout?: number } } })
      .document.settings?.idleTimeout;

  it('asks the device to keep the screen up for a minute by default (D68)', () => {
    const response = render(handlerInput({ intent: 'X', screen }), { ...done, visual: visual(10) });
    expect(idleTimeoutOf(response)).toBe(60000);
  });

  it('takes visual.idleTimeoutMs from config through a request interceptor', async () => {
    const input = handlerInput({ intent: 'X', screen });
    const config = parseConfig({
      mcp: { url: 'https://example.com/mcp' },
      visual: { idleTimeoutMs: 120000 },
    });
    await screenSettingsInterceptor(config).process(input);
    const response = render(input, { ...done, visual: visual(10) });
    expect(idleTimeoutOf(response)).toBe(120000);
  });
});
