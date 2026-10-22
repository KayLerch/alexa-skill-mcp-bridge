import { existsSync } from 'node:fs';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import type { Display, Logger, Visual } from '@alexa-mcp-bridge/core';
import type { McpToolResult } from '../mcp/result.js';
import {
  WIDGET_HEIGHT,
  WIDGET_WIDTH,
  hostPageHtml,
  initializeResult,
  type HostJob,
  type HostOutcome,
  type HostWindow,
} from './host-page.js';

/**
 * Renders an MCP server's widget to a JPEG for a device with a screen (D54). One headless
 * Chromium per container, launched at warm-up and kept, with one page that hosts every render
 * in a fresh iframe. The widget reaches no network, whatever its own CSP says: the browser's
 * only proxy is a dead port, loopback included, WebRTC may not send UDP outside it, and request
 * interception aborts every request but `data:` and `about:` on top. A render that hangs or
 * crashes the page kills the browser; the next render starts a new one. Logs carry timings and
 * sizes only, never the image or the tool result.
 */

export const JPEG_QUALITY = 60;
/** Tried once when the first shot is too large. */
export const JPEG_QUALITY_FALLBACK = 45;
/** The data URL's ceiling: Alexa caps a whole response at 120 KB, and speech must fit beside it. */
export const MAX_DATA_URL_BYTES = 90 * 1024;
/** Wider screens scale the image up; the bytes stay inside the response cap. */
export const MAX_IMAGE_WIDTH = 1280;
/** How long a widget gets to signal `size-changed` before the shot is taken anyway. */
export const SIGNAL_TIMEOUT_MS = 800;
const DEFAULT_CHROMIUM_PATH = '/usr/bin/chromium-browser';
/** Launch flags. Network: everything goes to a proxy on the discard port, which nothing serves. */
const CHROMIUM_ARGS = [
  // The container runs as a non-root user without the namespaces Chromium's sandbox needs.
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--proxy-server=127.0.0.1:9',
  // Chromium bypasses a proxy for loopback by default; this removes that exception.
  '--proxy-bypass-list=<-loopback>',
  // WebRTC may not send UDP outside the proxy. Chromium builds differ in which switch they read:
  // the headless shell honours the first, Alpine's chromium 155 only the second (measured).
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  // A widget that allocates without end crashes its page at this heap size, not the container.
  '--js-flags=--max-old-space-size=256',
];
/** A render that has not finished by now is abandoned, so the next one is not stuck behind it. */
const RENDER_ABANDON_MS = SIGNAL_TIMEOUT_MS + 3000;

export interface RenderJob {
  /** The widget: the `ui://` resource's HTML. */
  html: string;
  /** The arguments the tool was called with. */
  toolInput: Record<string, unknown>;
  /** The tool's result, handed to the widget as `ui/notifications/tool-result`. */
  toolResult: McpToolResult;
  display: Display;
}

/** What the session needs from a renderer; tests pass a fake. */
export interface ScreenRenderer {
  warm(): Promise<void>;
  /** The rendered screen, or undefined when there is none to show. Never throws. */
  render(job: RenderJob): Promise<Visual | undefined>;
  close(): Promise<void>;
}

export interface WidgetRendererOptions {
  logger: Logger;
  /** Default: CHROMIUM_PATH, else /usr/bin/chromium-browser (Alpine's chromium package). */
  executablePath?: string;
  timeoutMs?: number;
}

/** Quality 60; above the cap once more at 45; still above it, no image. */
export async function fitJpeg(
  shoot: (quality: number) => Promise<string>,
  maxBytes: number = MAX_DATA_URL_BYTES,
): Promise<string | undefined> {
  const first = await shoot(JPEG_QUALITY);
  if (first.length <= maxBytes) return first;
  const second = await shoot(JPEG_QUALITY_FALLBACK);
  return second.length <= maxBytes ? second : undefined;
}

export class WidgetRenderer implements ScreenRenderer {
  private starting?: Promise<Page>;
  private browser?: Browser;
  /** Set when the screen is on but the image has no browser: say so once, then render nothing. */
  private missing = false;
  /** Set when the page crashed; the next render starts a new browser. */
  private crashed = false;
  /** One page, so renders take turns. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: WidgetRendererOptions) {}

  async warm(): Promise<void> {
    if (this.browserMissing()) return;
    await this.page();
  }

  render(job: RenderJob): Promise<Visual | undefined> {
    const next = this.queue.then(() => this.renderNow(job));
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    const starting = this.starting;
    this.starting = undefined;
    await starting?.catch(() => undefined);
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close().catch(() => undefined);
  }

  private executablePath(): string {
    return this.options.executablePath ?? process.env.CHROMIUM_PATH ?? DEFAULT_CHROMIUM_PATH;
  }

  private browserMissing(): boolean {
    if (this.missing) return true;
    if (existsSync(this.executablePath())) return false;
    this.missing = true;
    this.options.logger.warn(
      'visual.enabled is on but the image has no browser; turns go without a visual. ' +
        'Deploy again so the agent image is built with the screen (WITH_SCREEN=1)',
      { executablePath: this.executablePath() },
    );
    return true;
  }

  /**
   * Kill the browser after a render that hung, crashed or broke the protocol: a page stuck in a
   * widget's loop never answers again. The next render launches a new one (about 200 ms).
   */
  private reset(): void {
    const browser = this.browser;
    this.browser = undefined;
    this.starting = undefined;
    this.crashed = false;
    if (!browser) return;
    browser.process()?.kill('SIGKILL');
    void browser.close().catch(() => undefined);
  }

  private page(): Promise<Page> {
    if (!this.starting) {
      this.starting = this.launch();
      this.starting.catch(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async launch(): Promise<Page> {
    const startedAt = Date.now();
    // Loaded on first use: a container with visual.enabled off never loads it.
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: this.executablePath(),
      headless: true,
      pipe: true,
      protocolTimeout: 10_000,
      args: CHROMIUM_ARGS,
    });
    this.browser = browser;
    browser.on('disconnected', () => {
      if (this.browser !== browser) return;
      this.browser = undefined;
      this.starting = undefined;
      this.options.logger.warn('screen renderer browser exited; relaunching on the next render');
    });
    const page = await browser.newPage();
    page.on('error', () => {
      this.crashed = true;
    });
    await page.setRequestInterception(true);
    page.on('request', allowLocalOnly);
    await page.setContent(hostPageHtml());
    this.options.logger.info('screen renderer warm', { elapsedMs: Date.now() - startedAt });
    return page;
  }

  private async renderNow(job: RenderJob): Promise<Visual | undefined> {
    if (this.browserMissing()) return undefined;
    if (this.crashed) this.reset();
    const { logger } = this.options;
    const startedAt = Date.now();
    const timeoutMs = this.options.timeoutMs ?? SIGNAL_TIMEOUT_MS;
    let page: Page | undefined;
    let threw = false;
    const onPageError = () => {
      threw = true;
    };
    // A crashed page (a widget out of memory) never answers: end the render at once.
    let onCrash = () => undefined as void;
    const crash = new Promise<never>((_, reject) => {
      onCrash = () => reject(new Error('the page crashed'));
    });
    crash.catch(() => undefined);
    try {
      page = await within(RENDER_ABANDON_MS, this.page());
      const shotPage = page;
      const scale = Math.min(job.display.width, MAX_IMAGE_WIDTH) / WIDGET_WIDTH;
      await within(
        RENDER_ABANDON_MS,
        page.setViewport({ width: WIDGET_WIDTH, height: WIDGET_HEIGHT, deviceScaleFactor: scale }),
      );
      page.on('pageerror', onPageError);
      page.on('error', onCrash);
      const hostJob: HostJob = {
        html: job.html,
        initialize: initializeResult(job.display.theme),
        toolInput: job.toolInput,
        toolResult: job.toolResult,
        timeoutMs,
      };
      const outcome = await within(
        RENDER_ABANDON_MS,
        Promise.race([
          page.evaluate(
            (j) => (globalThis as unknown as HostWindow).__bridgeRender?.(j),
            hostJob,
          ) as Promise<HostOutcome | undefined>,
          crash,
        ]),
      );
      if (this.crashed) throw new Error('the page crashed');
      if (threw) {
        await clearFrame(shotPage);
        logger.warn('widget threw while rendering; no visual', {
          elapsedMs: Date.now() - startedAt,
        });
        return undefined;
      }
      if (outcome !== 'drawn') {
        logger.warn('widget did not signal size-changed in time; shooting anyway', { timeoutMs });
      }
      const dataUrl = await within(
        RENDER_ABANDON_MS,
        fitJpeg(
          async (quality) =>
            'data:image/jpeg;base64,' +
            (await shotPage.screenshot({
              type: 'jpeg',
              quality,
              encoding: 'base64',
              optimizeForSpeed: true,
            })),
        ),
      );
      await clearFrame(shotPage);
      const elapsedMs = Date.now() - startedAt;
      if (!dataUrl) {
        logger.warn('rendered screen too large for a response even at quality 45; no visual', {
          elapsedMs,
        });
        return undefined;
      }
      logger.info('visual rendered', { elapsedMs, bytes: dataUrl.length });
      return {
        kind: 'image',
        mimeType: 'image/jpeg',
        dataUrl,
        width: Math.round(WIDGET_WIDTH * scale),
        height: Math.round(WIDGET_HEIGHT * scale),
      };
    } catch (err) {
      this.reset();
      logger.warn('visual render failed; the browser restarts on the next render', {
        errorName: err instanceof Error ? err.name : 'unknown',
        elapsedMs: Date.now() - startedAt,
      });
      return undefined;
    } finally {
      page?.off('pageerror', onPageError);
      page?.off('error', onCrash);
    }
  }
}

/** Remove the shot widget, so nothing of it runs between turns. */
async function clearFrame(page: Page): Promise<void> {
  await within(
    1000,
    page.evaluate(() => (globalThis as unknown as HostWindow).__bridgeClear?.()),
  ).catch(() => undefined);
}

/** The widget gets inline data and nothing else. */
function allowLocalOnly(request: HTTPRequest): void {
  const url = request.url();
  if (url.startsWith('data:') || url.startsWith('about:')) void request.continue();
  else void request.abort('blockedbyclient');
}

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`render step took over ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
