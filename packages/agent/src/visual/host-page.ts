/**
 * The minimal MCP Apps host the renderer loads into headless Chromium (D54). It does what an
 * Alexa+ device does with a widget, and no more: the widget runs in a sandboxed `allow-scripts`
 * iframe from `srcdoc`, the host answers `ui/initialize`, sends the tool's input and result once
 * the widget says it is initialized, and reports when the widget signals `size-changed`.
 * Anything else the widget asks for (tool calls, links, messages) is refused: a still image
 * cannot act on it.
 *
 * Spec: github.com/modelcontextprotocol/ext-apps, specification/draft/apps.mdx.
 */

/** The MCP Apps protocol version this host speaks. */
export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';
/** The size widgets are authored for; the renderer scales the shot to the device. */
export const WIDGET_WIDTH = 768;
export const WIDGET_HEIGHT = 480;

export type Theme = 'light' | 'dark';

export interface InitializeResult {
  protocolVersion: string;
  hostInfo: { name: string; version: string };
  hostCapabilities: Record<string, never>;
  hostContext: {
    theme: Theme;
    displayMode: 'fullscreen';
    platform: 'web';
    containerDimensions: { width: number; height: number };
  };
}

/** The host's answer to the widget's `ui/initialize`. */
export function initializeResult(theme: Theme): InitializeResult {
  return {
    protocolVersion: MCP_APPS_PROTOCOL_VERSION,
    hostInfo: { name: 'alexa-skill-mcp-bridge', version: '0.1.0' },
    hostCapabilities: {},
    hostContext: {
      theme,
      displayMode: 'fullscreen',
      platform: 'web',
      containerDimensions: { width: WIDGET_WIDTH, height: WIDGET_HEIGHT },
    },
  };
}

/** One render, as handed to the page. Plain JSON: it crosses into the browser. */
export interface HostJob {
  html: string;
  initialize: InitializeResult;
  /** Sent as `ui/notifications/tool-input` `{ arguments }`. */
  toolInput: Record<string, unknown>;
  /** Sent as `ui/notifications/tool-result`: the tool's CallToolResult. */
  toolResult: unknown;
  /** Resolve with 'timeout' if the widget has not signalled by then. */
  timeoutMs: number;
}

/** 'drawn': the widget signalled size-changed. 'timeout': it did not in time. */
export type HostOutcome = 'drawn' | 'timeout';

interface MessageEventLike {
  source: unknown;
  data: unknown;
}

export interface HostFrame {
  srcdoc: string;
  style: { cssText: string };
  contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** The part of `window` the host uses, so a test can hand it a fake one. */
export interface HostWindow {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  document: {
    createElement(tag: 'iframe'): HostFrame;
    body: { appendChild(node: HostFrame): unknown };
  };
  __bridgeRender?: (job: HostJob) => Promise<HostOutcome>;
  __bridgeClear?: () => void;
}

/**
 * Installs `window.__bridgeRender(job)` and `window.__bridgeClear()`. This function is serialized into the page with
 * `toString()`, so it must stay self-contained: no imports, no references to this module.
 * Every render starts a fresh iframe, so no state carries from one widget to the next.
 */
export function installHost(win: HostWindow): void {
  let frame: HostFrame | undefined;

  win.__bridgeClear = () => {
    if (frame) frame.remove();
    frame = undefined;
  };

  win.__bridgeRender = (job) =>
    new Promise<HostOutcome>((resolve) => {
      if (frame) frame.remove();
      const current = win.document.createElement('iframe');
      frame = current;
      let resultSent = false;

      const send = (message: Record<string, unknown>) =>
        current.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, '*');

      const onMessage = (event: MessageEventLike) => {
        if (event.source !== current.contentWindow) return;
        const message = event.data as { jsonrpc?: unknown; id?: unknown; method?: unknown } | null;
        if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
        if (typeof message.method !== 'string') return;
        const isRequest = message.id !== undefined && message.id !== null;

        if (message.method === 'ui/initialize' && isRequest) {
          send({ id: message.id, result: job.initialize });
        } else if (message.method === 'ui/notifications/initialized') {
          send({ method: 'ui/notifications/tool-input', params: { arguments: job.toolInput } });
          send({ method: 'ui/notifications/tool-result', params: job.toolResult });
          resultSent = true;
        } else if (message.method === 'ui/notifications/size-changed') {
          // A size from before the result reached the widget describes an empty screen.
          if (resultSent) finish('drawn');
        } else if (isRequest) {
          send({ id: message.id, error: { code: -32601, message: 'Not supported by this host' } });
        }
      };

      const finish = (outcome: HostOutcome) => {
        win.removeEventListener('message', onMessage);
        win.clearTimeout(timer);
        resolve(outcome);
      };

      const timer = win.setTimeout(() => finish('timeout'), job.timeoutMs);
      win.addEventListener('message', onMessage);
      const { width, height } = job.initialize.hostContext.containerDimensions;
      current.setAttribute('sandbox', 'allow-scripts');
      current.style.cssText = `border:0;display:block;width:${width}px;height:${height}px`;
      current.srcdoc = job.html;
      win.document.body.appendChild(current);
    });
}

/** The page the renderer loads once and reuses: the host script and nothing else. */
export function hostPageHtml(): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>bridge host</title></head>' +
    '<body style="margin:0;overflow:hidden;background:#000">' +
    `<script>(${installHost.toString()})(window);</script></body></html>`
  );
}
