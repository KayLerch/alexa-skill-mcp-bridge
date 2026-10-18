import { describe, expect, it } from 'vitest';
import {
  hostPageHtml,
  initializeResult,
  installHost,
  type HostFrame,
  type HostJob,
  type HostWindow,
} from './host-page.js';

/**
 * The minimal MCP Apps host (D54) against a fake window: the handshake order a widget relies
 * on, and the outcomes the renderer reads. The same function runs in Chromium as the page script.
 */

type Listener = (event: { source: unknown; data: unknown }) => void;

function fakeWindow() {
  const listeners = new Set<Listener>();
  const timers: (() => void)[] = [];
  const posted: Record<string, unknown>[] = [];
  const attributes: Record<string, string> = {};
  const widget = {
    postMessage: (message: unknown) => posted.push(message as Record<string, unknown>),
  };
  let frame: (HostFrame & { removed: boolean }) | undefined;
  const win: HostWindow = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => undefined,
    document: {
      createElement: () => {
        frame = {
          srcdoc: '',
          style: { cssText: '' },
          contentWindow: widget,
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
          remove: () => {
            if (frame) frame.removed = true;
          },
          removed: false,
        };
        return frame;
      },
      body: { appendChild: () => undefined },
    },
  };
  /** The widget speaks: a message whose source is the iframe's window. */
  const fromWidget = (data: unknown, source: unknown = widget) => {
    for (const listener of [...listeners]) listener({ source, data });
  };
  return {
    win,
    posted,
    attributes,
    fromWidget,
    fireTimers: () => timers.splice(0).forEach((t) => t()),
    frame: () => frame,
  };
}

const job = (overrides: Partial<HostJob> = {}): HostJob => ({
  html: '<!doctype html><p>widget</p>',
  initialize: initializeResult('light'),
  toolInput: { city: 'Berlin' },
  toolResult: { content: [], structuredContent: { title: 'Weather' } },
  timeoutMs: 800,
  ...overrides,
});

describe('MCP Apps host page', () => {
  it('answers ui/initialize, then sends tool-input before tool-result, and resolves on size-changed', async () => {
    const page = fakeWindow();
    installHost(page.win);
    const rendered = page.win.__bridgeRender?.(job());

    expect(page.frame()?.srcdoc).toBe('<!doctype html><p>widget</p>');
    expect(page.attributes.sandbox).toBe('allow-scripts');

    page.fromWidget({ jsonrpc: '2.0', id: 7, method: 'ui/initialize', params: {} });
    expect(page.posted).toEqual([{ jsonrpc: '2.0', id: 7, result: initializeResult('light') }]);

    page.fromWidget({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(page.posted.slice(1)).toEqual([
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: { city: 'Berlin' } },
      },
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { content: [], structuredContent: { title: 'Weather' } },
      },
    ]);

    page.fromWidget({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { width: 768, height: 480 },
    });
    await expect(rendered).resolves.toBe('drawn');
  });

  it('initializes with the fullscreen host context the widget was authored for', () => {
    expect(initializeResult('dark')).toEqual({
      protocolVersion: '2026-01-26',
      hostInfo: { name: 'alexa-skill-mcp-bridge', version: '0.1.0' },
      hostCapabilities: {},
      hostContext: {
        theme: 'dark',
        displayMode: 'fullscreen',
        platform: 'web',
        containerDimensions: { width: 768, height: 480 },
      },
    });
  });

  it('ignores messages from anything but the widget and refuses requests it does not serve', async () => {
    const page = fakeWindow();
    installHost(page.win);
    const rendered = page.win.__bridgeRender?.(job());

    page.fromWidget({ jsonrpc: '2.0', id: 1, method: 'ui/initialize' }, { other: true });
    expect(page.posted).toEqual([]);

    page.fromWidget({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } });
    expect(page.posted).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Not supported by this host' } },
    ]);
    page.fireTimers();
    await expect(rendered).resolves.toBe('timeout');
  });

  it('resolves with timeout when the widget never signals, and starts each render in a fresh frame', async () => {
    const page = fakeWindow();
    installHost(page.win);
    const first = page.win.__bridgeRender?.(job());
    const firstFrame = page.frame();
    page.fireTimers();
    await expect(first).resolves.toBe('timeout');

    const second = page.win.__bridgeRender?.(job());
    expect(firstFrame?.removed).toBe(true);
    expect(page.frame()).not.toBe(firstFrame);
    // A size from before the result arrived describes an empty screen: not yet drawn.
    page.fromWidget({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: {} });
    page.fromWidget({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    page.fromWidget({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: {} });
    await expect(second).resolves.toBe('drawn');
    page.fireTimers();
  });

  it('removes the shot widget on clear, so nothing of it runs between turns', async () => {
    const page = fakeWindow();
    installHost(page.win);
    const rendered = page.win.__bridgeRender?.(job());
    page.fireTimers();
    await rendered;
    page.win.__bridgeClear?.();
    expect(page.frame()?.removed).toBe(true);
  });

  it('embeds the same host function in the page it serves', () => {
    const html = hostPageHtml();
    expect(html).toContain('__bridgeRender');
    expect(html).toMatch(/^<!doctype html>/);
  });
});
