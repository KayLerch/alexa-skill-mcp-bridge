import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  type JSONRPCMessage,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/** Every event the server emits is a plain record; the sink decides how it looks. */
export type LogEvent = Record<string, unknown>;
export type Log = (event: LogEvent) => void;

/** A logged JSON-RPC message. `dir` is from the server's point of view. */
export interface WireEvent extends LogEvent {
  msg: 'mcp';
  dir: 'in' | 'out';
  kind: 'request' | 'notification' | 'result' | 'error';
  /** For a result or an error: the method of the request it answers. */
  method: string;
  session?: string;
  id?: RequestId;
  /** Round trip in milliseconds, on results and errors. */
  ms?: number;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/** What a call site fills in; the rest of a WireEvent is the same for every message. */
type WireDetail = Pick<WireEvent, 'kind' | 'method' | 'id' | 'ms' | 'params' | 'result' | 'error'>;

/**
 * Log every JSON-RPC message crossing the transport, both directions.
 *
 * One interception point instead of instrumenting each tool: `send` is what the
 * server writes, `onmessage` is what the client sends. Responses carry no method
 * name of their own, so open requests are kept here and each response is logged
 * with the method it answers and how long it took.
 *
 * Call this after `server.connect(transport)`, which is when `onmessage` exists.
 */
export function attachWireLog(transport: Transport, log: Log): void {
  // Both sides number their requests from zero, so the direction is part of the key.
  const open = new Map<string, { method: string; startedAt: number }>();
  const key = (dir: 'in' | 'out', id: RequestId | undefined) => `${dir}:${id}`;

  const observe = (message: JSONRPCMessage, dir: 'in' | 'out'): void => {
    const emit = (detail: WireDetail) =>
      log({ msg: 'mcp', dir, session: transport.sessionId, ...detail });

    if (isJSONRPCRequest(message)) {
      open.set(key(dir, message.id), { method: message.method, startedAt: Date.now() });
      emit({ kind: 'request', method: message.method, id: message.id, params: message.params });
      return;
    }
    if (isJSONRPCNotification(message)) {
      emit({ kind: 'notification', method: message.method, params: message.params });
      return;
    }

    // A response travels the opposite way from the request it answers.
    const asked = open.get(key(dir === 'in' ? 'out' : 'in', message.id));
    open.delete(key(dir === 'in' ? 'out' : 'in', message.id));
    const answered = {
      method: asked?.method ?? 'unknown',
      id: message.id,
      ms: asked ? Date.now() - asked.startedAt : undefined,
    };
    if (isJSONRPCErrorResponse(message)) emit({ kind: 'error', ...answered, error: message.error });
    else emit({ kind: 'result', ...answered, result: message.result });
  };

  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    observe(message, 'out');
    return send(message, options);
  };

  const onmessage = transport.onmessage?.bind(transport);
  transport.onmessage = (message, extra) => {
    observe(message, 'in');
    onmessage?.(message, extra);
  };
}
