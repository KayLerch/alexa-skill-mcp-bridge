import { describe, expect, it } from 'vitest';
import { createConsoleLog } from './console-log.js';
import type { LogEvent } from './wire.js';

/** Render events without colour and drop the timestamp, which changes every run. */
function render(...events: LogEvent[]): string[] {
  const lines: string[] = [];
  const log = createConsoleLog({ color: false, detailWidth: 60, write: (l) => lines.push(l) });
  for (const event of events) log(event);
  return lines.map((line) => line.slice('00:00:00.000  '.length));
}

const call = (params: unknown): LogEvent => ({
  msg: 'mcp',
  dir: 'in',
  kind: 'request',
  method: 'tools/call',
  id: 1,
  params,
});

describe('console log', () => {
  it('shows a tool call with its arguments and the result that answers it', () => {
    const [request, result] = render(
      call({ name: 'get_weather', arguments: { city: 'Hamburg' } }),
      {
        msg: 'mcp',
        dir: 'out',
        kind: 'result',
        method: 'tools/call',
        id: 1,
        ms: 1400,
        result: {
          content: [{ type: 'text', text: 'Hamburg: light rain.' }],
          structuredContent: {},
        },
      },
    );
    expect(request).toBe('→ tools/call   get_weather city=Hamburg');
    expect(result).toBe('← tools/call   Hamburg: light rain. +structured  (1.4s)');
  });

  it('summarises an elicitation question and the answer to it', () => {
    const [question, answer] = render(
      {
        msg: 'mcp',
        dir: 'out',
        kind: 'request',
        method: 'elicitation/create',
        params: {
          message: 'How many guests?',
          requestedSchema: {
            type: 'object',
            properties: { guests: { type: 'integer', minimum: 1, maximum: 6 } },
          },
        },
      },
      {
        msg: 'mcp',
        dir: 'in',
        kind: 'result',
        method: 'elicitation/create',
        ms: 4200,
        result: { action: 'accept', content: { guests: 2 } },
      },
    );
    expect(question).toBe('← elicit       "How many guests?" guests:integer 1-6');
    expect(answer).toBe('→ elicit       accept guests=2  (4.2s)');
  });

  it('marks failures and clips long details', () => {
    const [toolError, protocolError] = render(
      {
        msg: 'mcp',
        dir: 'out',
        kind: 'result',
        method: 'tools/call',
        result: {
          content: [{ type: 'text', text: 'No weather data for ' + 'x'.repeat(80) }],
          isError: true,
        },
      },
      {
        msg: 'mcp',
        dir: 'out',
        kind: 'error',
        method: 'tools/list',
        error: { code: -32602, message: 'Invalid arguments' },
      },
    );
    expect(toolError).toMatch(/^← tools\/call {3}tool error: No weather data for x+…$/);
    expect(toolError).toHaveLength('← tools/call   '.length + 60);
    expect(protocolError).toBe('← tools/list   -32602 Invalid arguments');
  });

  it('tags sessions only once a second client shows up', () => {
    const [first, second] = render(
      { ...call({ name: 'get_weather' }), session: 'aaaa' },
      { ...call({ name: 'get_weather' }), session: 'bbbb' },
    );
    expect(first).toBe('→ tools/call   get_weather');
    expect(second).toBe('#2 → tools/call   get_weather');
  });

  it("renders the server's own events with their fields", () => {
    const [line] = render({ msg: 'session initialized', session: '0123456789abcdef' });
    expect(line).toBe('● session initialized  session=01234567');
  });
});
