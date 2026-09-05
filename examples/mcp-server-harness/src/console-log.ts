import type { Log, LogEvent, WireEvent } from './wire.js';

/**
 * Console sink: one readable line per event, so a developer watching this terminal
 * sees what the client asked for and what went back. `SAMPLE_LOG=json` swaps this
 * for the raw records (see jsonLog).
 *
 *   20:15:02.113  →  initialize   alexa-mcp-bridge/0.1.0 protocol=2025-11-25 wants=elicitation
 *   20:15:04.902  →  tools/call   search_hotels destination=Berlin checkIn=2026-09-10
 *   20:15:04.905  ←  elicit       "How many guests will be staying?" guests:integer 1-6
 *   20:15:09.140  →  elicit       accept guests=2
 *   20:15:09.144  ←  tools/call   3 hotels in Berlin from 2026-09-10 to … +structured  (4.2s)
 */

const DIM = '2';
const PLAIN = '0';
const RED = '31';
const GREEN = '32';
const YELLOW = '33';
const CYAN = '36';

/** Widest label we print, so the detail column lines up. */
const LABEL_WIDTH = 11;
const MIN_DETAIL_WIDTH = 60;

export interface ConsoleLogOptions {
  color?: boolean;
  write?: (line: string) => void;
  /** Longest detail before it is clipped. Defaults to whatever the terminal fits. */
  detailWidth?: number;
}

export function createConsoleLog(options: ConsoleLogOptions = {}): Log {
  const color = options.color ?? (process.stdout.isTTY === true && !process.env.NO_COLOR);
  const write = options.write ?? ((line: string) => process.stdout.write(line + '\n'));
  // Empty text stays empty so a line with no detail can be trimmed clean.
  const paint = (text: string, code: string) =>
    color && text ? `\u001b[${code}m${text}\u001b[0m` : text;
  // Sessions are numbered so interleaved clients stay apart; with one client the tag is noise.
  const sessions = new Map<string, number>();

  const width = () =>
    options.detailWidth ??
    Math.max(MIN_DETAIL_WIDTH, (process.stdout.columns ?? 120) - 32 - LABEL_WIDTH);

  return (event: LogEvent) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session && !sessions.has(session)) sessions.set(session, sessions.size + 1);
    const tag = session && sessions.size > 1 ? `#${sessions.get(session)} ` : '';

    const line = isWireEvent(event)
      ? wireLine(event, paint, width())
      : eventLine(event, paint, width(), tag === '');
    write(`${paint(timestamp(), DIM)}  ${paint(tag, DIM)}${line}`.trimEnd());
  };
}

/** The original behaviour: one JSON record per line, nothing summarised. */
export const jsonLog: Log = (event) => process.stdout.write(JSON.stringify(event) + '\n');

type Paint = (text: string, code: string) => string;

function wireLine(event: WireEvent, paint: Paint, width: number): string {
  const failed = event.kind === 'error' || isErrorResult(event);
  // Keepalive pings are frequent and dull, but hiding them would hide a working keepalive.
  const muted = event.method === 'ping';
  const arrow = paint(
    event.dir === 'in' ? '→' : '←',
    muted ? DIM : event.dir === 'in' ? CYAN : GREEN,
  );
  const label = paint(
    shortMethod(event.method).padEnd(LABEL_WIDTH),
    failed ? RED : muted ? DIM : PLAIN,
  );
  const detail = clip(oneLine(wireDetail(event)), width);
  const took = event.ms === undefined ? '' : paint(`  (${duration(event.ms)})`, DIM);

  const body = muted ? paint(detail, DIM) : detail;
  return `${arrow} ${label}${body ? '  ' + body : ''}${took}`;
}

/** Anything the server says about itself: startup, sessions, elicitation outcomes, failures. */
function eventLine(event: LogEvent, paint: Paint, width: number, withSession: boolean): string {
  const { msg, session, ...rest } = event;
  // The session belongs on lifecycle lines, unless the tag column already carries it.
  const shown = { ...rest, session: withSession ? asString(session)?.slice(0, 8) : undefined };
  const detail = clip(oneLine(fields(shown)), width);
  return `${paint('●', YELLOW)} ${String(msg ?? 'event')}${detail ? '  ' + paint(detail, DIM) : ''}`;
}

function wireDetail(event: WireEvent): string {
  if (event.kind === 'error') {
    const error = asRecord(event.error);
    const code = error?.code === undefined ? '' : String(error.code);
    return `${code} ${asString(error?.message) ?? compact(event.error)}`.trim();
  }
  return event.kind === 'result'
    ? resultDetail(event.method, event.result)
    : paramsDetail(event.method, event.params);
}

function paramsDetail(method: string, params: unknown): string {
  const p = asRecord(params) ?? {};
  switch (method) {
    case 'initialize': {
      return [
        describe(asRecord(p.clientInfo)),
        `protocol=${asString(p.protocolVersion) ?? '?'}`,
        capabilities(p.capabilities),
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'tools/call':
      return `${asString(p.name) ?? '?'} ${fields(asRecord(p.arguments) ?? {})}`.trim();
    case 'elicitation/create':
      return `${JSON.stringify(asString(p.message) ?? '')} ${schema(p.requestedSchema)}`.trim();
    case 'ping':
      return '';
    default:
      return fields(p);
  }
}

function resultDetail(method: string, result: unknown): string {
  const r = asRecord(result) ?? {};
  switch (method) {
    case 'initialize':
      return `${describe(asRecord(r.serverInfo))} protocol=${asString(r.protocolVersion) ?? '?'}`;
    case 'tools/list': {
      const tools = Array.isArray(r.tools) ? r.tools : [];
      const names = tools.map((tool) => asString(asRecord(tool)?.name) ?? '?');
      return `${names.length} tools: ${names.join(', ')}`;
    }
    case 'tools/call': {
      const body = content(r.content) + (r.structuredContent ? ' +structured' : '');
      return r.isError === true ? `tool error: ${body}` : body;
    }
    case 'elicitation/create':
      return `${asString(r.action) ?? '?'} ${fields(asRecord(r.content) ?? {})}`.trim();
    case 'ping':
      return '';
    default:
      return compact(result);
  }
}

/** Only two methods are long enough to crowd the line. */
function shortMethod(method: string): string {
  if (method === 'elicitation/create') return 'elicit';
  return method.startsWith('notifications/') ? method.slice('notifications/'.length) : method;
}

function content(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const b = asRecord(block);
      return asString(b?.text) ?? `[${asString(b?.type) ?? 'block'}]`;
    })
    .join(' ');
}

function capabilities(value: unknown): string {
  const keys = Object.keys(asRecord(value) ?? {});
  return keys.length ? `wants=${keys.join(',')}` : '';
}

/** "name/version", for clientInfo and serverInfo. */
function describe(info: Record<string, unknown> | undefined): string {
  if (!info) return '';
  return `${asString(info.name) ?? '?'}/${asString(info.version) ?? '?'}`;
}

/** Summarise an elicitation schema as "guests:integer 1-6". */
function schema(value: unknown): string {
  const properties = asRecord(asRecord(value)?.properties) ?? {};
  return Object.entries(properties)
    .map(([name, raw]) => {
      const p = asRecord(raw) ?? {};
      const range =
        p.minimum !== undefined && p.maximum !== undefined ? ` ${p.minimum}-${p.maximum}` : '';
      const choices = Array.isArray(p.enum) ? ` ${p.enum.join('|')}` : '';
      return `${name}:${asString(p.type) ?? '?'}${range}${choices}`;
    })
    .join(' ');
}

function fields(record: Record<string, unknown>): string {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${compact(value)}`)
    .join(' ');
}

function compact(value: unknown): string {
  if (typeof value === 'string') return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isWireEvent(event: LogEvent): event is WireEvent {
  return event.msg === 'mcp' && typeof event.method === 'string';
}

function isErrorResult(event: WireEvent): boolean {
  return event.kind === 'result' && asRecord(event.result)?.isError === true;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function duration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}`
  );
}
