import { readFileSync } from 'node:fs';
import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, type Display } from '@alexa-mcp-bridge/core';
import { MAX_DATA_URL_BYTES, WidgetRenderer, fitJpeg, type RenderJob } from './renderer.js';

/**
 * The renderer (D54): the size policy without a browser, then real renders in Chromium.
 * The browser tests need CHROMIUM_PATH (a local Chromium or chrome-headless-shell) and skip
 * without it, so CI stays green on a machine that has none.
 */

const widget = readFileSync(new URL('../../test/fixtures/widget.html', import.meta.url), 'utf8');

describe('fitJpeg', () => {
  const dataUrl = (bytes: number) => 'data:image/jpeg;base64,' + 'A'.repeat(bytes - 23);

  it('keeps quality 60 when the data URL fits', async () => {
    const asked: number[] = [];
    const out = await fitJpeg(async (q) => (asked.push(q), dataUrl(50_000)));
    expect(asked).toEqual([60]);
    expect(out?.length).toBe(50_000);
  });

  it('re-encodes at quality 45 above 90 KB', async () => {
    const asked: number[] = [];
    const out = await fitJpeg(async (q) => (asked.push(q), dataUrl(q === 60 ? 100_000 : 80_000)));
    expect(asked).toEqual([60, 45]);
    expect(out?.length).toBe(80_000);
  });

  it('gives up when quality 45 is still above 90 KB', async () => {
    expect(await fitJpeg(async () => dataUrl(MAX_DATA_URL_BYTES + 1))).toBeUndefined();
  });
});

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(dataUrl: string): { width: number; height: number } {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1] as number;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error('no start-of-frame marker');
}

describe('WidgetRenderer without a browser', () => {
  it('warns once and renders nothing when the screen is on but no browser is installed', async () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'test' }, { write: (l) => lines.push(l) });
    const renderer = new WidgetRenderer({ logger, executablePath: '/nonexistent/chromium' });
    await renderer.warm();
    const job: RenderJob = {
      html: '<p>x</p>',
      toolInput: {},
      toolResult: { content: [] },
      display: { width: 1280, height: 800, theme: 'dark' },
    };
    const startedAt = Date.now();
    expect(await renderer.render(job)).toBeUndefined();
    expect(await renderer.render(job)).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(100);
    const warnings = lines.filter((l) => l.includes('"level":"warn"'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no browser/);
    await renderer.close();
  });
});

const chromium = process.env.CHROMIUM_PATH;

describe.skipIf(!chromium)('WidgetRenderer in Chromium', () => {
  const lines: string[] = [];
  const everything: string[] = [];
  const logger = createLogger(
    { service: 'test' },
    { level: 'debug', write: (l) => (lines.push(l), everything.push(l)) },
  );
  const renderer = new WidgetRenderer({
    logger,
    ...(chromium ? { executablePath: chromium } : {}),
  });
  let probe: Server;
  let probeUrl = '';
  let probeHits = 0;
  let upgrades = 0;
  let stun: Socket;
  let stunPackets = 0;

  beforeAll(async () => {
    probe = createServer((_req, res) => {
      probeHits++;
      res.end('');
    });
    probe.on('upgrade', (_req, socket) => {
      upgrades++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    stun = createSocket('udp4');
    stun.on('message', () => stunPackets++);
    await new Promise<void>((resolve) => stun.bind(0, '127.0.0.1', resolve));
    const address = probe.address();
    probeUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/x`;
    await renderer.warm();
  });
  afterAll(async () => {
    await renderer.close();
    probe.closeAllConnections();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    stun.close();
  });

  const job = (html: string, display: Display): RenderJob => ({
    html,
    toolInput: { park: 'yose' },
    toolResult: {
      content: [{ type: 'text', text: 'Yosemite, three things to see.' }],
      structuredContent: {
        title: 'Yosemite National Park',
        subtitle: 'Things to see',
        progress: '1 of 3',
        items: ['Tunnel View', 'Mist Trail', 'Glacier Point'],
      },
    },
    display,
  });

  it('renders the widget to a JPEG data URL at the display width, under 90 KB', async () => {
    lines.length = 0;
    const visual = await renderer.render(job(widget, { width: 1280, height: 800, theme: 'dark' }));
    expect(visual).toMatchObject({
      kind: 'image',
      mimeType: 'image/jpeg',
      width: 1280,
      height: 800,
    });
    expect(visual?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(jpegSize(visual?.dataUrl ?? '')).toEqual({ width: 1280, height: 800 });
    expect(visual?.dataUrl.length).toBeLessThanOrEqual(90 * 1024);
    const rendered = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const line = rendered.find((l) => l.msg === 'visual rendered');
    expect(line).toMatchObject({ elapsedMs: expect.any(Number), bytes: visual?.dataUrl.length });
    expect(rendered.some((l) => l.level === 'warn')).toBe(false);
  });

  it('caps the image at 1280 px wide on a larger screen', async () => {
    const visual = await renderer.render(
      job(widget, { width: 1920, height: 1200, theme: 'light' }),
    );
    expect(jpegSize(visual?.dataUrl ?? '')).toEqual({ width: 1280, height: 800 });
  });

  it('shoots after the timeout, with a warning, when the widget never signals', async () => {
    lines.length = 0;
    const silent = '<!doctype html><body style="background:#123">no handshake</body>';
    const startedAt = Date.now();
    const visual = await renderer.render(job(silent, { width: 960, height: 480, theme: 'dark' }));
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(800);
    expect(visual?.width).toBe(960);
    expect(lines.some((l) => l.includes('"level":"warn"') && l.includes('size-changed'))).toBe(
      true,
    );
  });

  it('drops the visual when the widget throws on load', async () => {
    lines.length = 0;
    const throwing = '<!doctype html><script>throw new Error("broken bundle")</script>';
    const visual = await renderer.render(
      job(throwing, { width: 1280, height: 800, theme: 'dark' }),
    );
    expect(visual).toBeUndefined();
    expect(lines.some((l) => l.includes('"level":"warn"'))).toBe(true);
  });

  it('blocks every network request the widget makes', async () => {
    probeHits = 0;
    const fetching = `<!doctype html><img src="${probeUrl}"><script>fetch("${probeUrl}").catch(() => {})</script>`;
    await renderer.render(job(fetching, { width: 1280, height: 800, theme: 'dark' }));
    expect(probeHits).toBe(0);
  });

  it('lets no WebSocket and no WebRTC traffic out', async () => {
    upgrades = 0;
    stunPackets = 0;
    const port = new URL(probeUrl).port;
    const stunPort = stun.address().port;
    const leaking = `<!doctype html><script>
      try { new WebSocket("ws://127.0.0.1:${port}/ws"); } catch (e) {}
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${stunPort}" }] });
        pc.createDataChannel("x");
        pc.createOffer().then((o) => pc.setLocalDescription(o));
      } catch (e) {}
      try { navigator.sendBeacon("${probeUrl}", "x"); } catch (e) {}
    </script>`;
    await renderer.render(job(leaking, { width: 1280, height: 800, theme: 'dark' }));
    // ICE gathering and the socket keep going after the shot; give them time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect({ http: probeHits, upgrades, stunPackets }).toEqual({
      http: 0,
      upgrades: 0,
      stunPackets: 0,
    });
  });

  it('recovers from a widget that hangs its page: the next render works in normal time', async () => {
    lines.length = 0;
    const looping = '<!doctype html><script>for (;;) {}</script>';
    expect(
      await renderer.render(job(looping, { width: 1280, height: 800, theme: 'dark' })),
    ).toBeUndefined();
    const startedAt = Date.now();
    const visual = await renderer.render(job(widget, { width: 1280, height: 800, theme: 'dark' }));
    expect(visual?.width).toBe(1280);
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('recovers from a widget that runs its page out of memory, which the heap cap ends early', async () => {
    const hungry =
      '<!doctype html><script>const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random()));</script>';
    const crashedAt = Date.now();
    expect(
      await renderer.render(job(hungry, { width: 1280, height: 800, theme: 'dark' })),
    ).toBeUndefined();
    // The page crashes at the 256 MB heap cap and the render ends then, not at the step timeout.
    expect(Date.now() - crashedAt).toBeLessThan(1500);
    const visual = await renderer.render(job(widget, { width: 1280, height: 800, theme: 'dark' }));
    expect(visual?.width).toBe(1280);
  });

  it('never logs the image or the tool result', () => {
    const all = everything.join('\n');
    expect(all).toContain('visual rendered');
    expect(all).not.toMatch(/data:image|base64/);
    expect(all).not.toContain('Yosemite');
  });
});
