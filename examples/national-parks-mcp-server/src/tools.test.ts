import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startParksServer, type ParksServerHandle } from './app.js';

/**
 * The tools against a real client over Streamable HTTP, because the behaviour that matters is
 * conditional: a question arrives only when the request is underdetermined, and never when the
 * caller supplied enough to answer.
 */

interface CallResult {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * One server per test, on its own port. A tools/call that is waiting on an elicitation holds its
 * HTTP stream open, and several sessions against one origin can queue behind it, which showed up
 * as tests that hung until the ten-minute elicitation timeout rather than failing.
 */
async function withServer(
  answer: Record<string, unknown> | undefined,
  body: (ctx: {
    asked: string[];
    call: (name: string, args: Record<string, unknown>) => Promise<CallResult>;
    client: Client;
  }) => Promise<void>,
): Promise<void> {
  const server: ParksServerHandle = await startParksServer({ port: 0, log: () => undefined });
  const asked: string[] = [];
  const client = new Client(
    { name: 'parks-test', version: '0.1.0' },
    // The server elicits in form mode, so the client has to declare it, exactly as the
    // bridge's own MCP client does. A bare `elicitation: {}` leaves the request undeliverable.
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    asked.push(request.params.message);
    return answer ? { action: 'accept', content: answer } : { action: 'decline' };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  // Every real client lists tools before calling one, and the bridge does it at warm-up. Calling
  // a tool in the same tick as connect races the transport's stream setup, and a server-to-client
  // elicitation on that stream is then never delivered (measured: see docs/decisions.md).
  await client.listTools();
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }) as Promise<CallResult>;
  try {
    await body({ asked, call, client });
  } finally {
    await client.close().catch(() => undefined);
    await server.close();
  }
}

const textOf = (r: CallResult) => (r.content ?? []).map((c) => c.text ?? '').join(' ');

describe('national parks tools', () => {
  it('lists both tools with their schemas', async () => {
    await withServer(undefined, async ({ client }) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['find_park', 'plan_park_visit']);
    });
  });

  it('answers a one-shot request without asking anything', async () => {
    await withServer(undefined, async ({ asked, call }) => {
      const result = await call('find_park', { activity: 'fishing', month: 'July' });
      expect(asked).toEqual([]);
      expect(textOf(result)).toMatch(/Katmai/);
      expect(result.structuredContent?.criteria).toMatchObject({
        activity: 'fishing',
        month: 'July',
      });
    });
  });

  it('asks which month when a park is named without one, then uses the answer', async () => {
    await withServer({ month: 'January' }, async ({ asked, call }) => {
      const result = await call('plan_park_visit', { park: 'Glacier' });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatch(/which month/i);
      expect(result.structuredContent).toMatchObject({ park: 'Glacier', month: 'January' });
      // January is outside the Going-to-the-Sun season, and the answer says so.
      expect(result.structuredContent?.access).toBe('limited');
    });
  });

  it('does not ask when the month came with the request', async () => {
    await withServer({ month: 'January' }, async ({ asked, call }) => {
      const result = await call('plan_park_visit', { park: 'Glacier', month: 'August' });
      expect(asked).toEqual([]);
      expect(result.structuredContent).toMatchObject({ park: 'Glacier', access: 'full' });
    });
  });

  it('asks what to do whenever the activity is missing, even with a month', async () => {
    await withServer({ activity: 'stargazing' }, async ({ asked, call }) => {
      const result = await call('find_park', { month: 'June' });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatch(/what would you like to do/i);
      expect(result.structuredContent?.criteria).toMatchObject({
        activity: 'stargazing',
        month: 'June',
      });
    });
  });

  it('puts the park known for the activity first', async () => {
    await withServer(undefined, async ({ call }) => {
      const fishing = await call('find_park', { activity: 'fishing' });
      const results = fishing.structuredContent?.results as { park: string }[];
      expect(results[0]?.park).toBe('Katmai');
      const stargazing = await call('find_park', { activity: 'stargazing' });
      expect((stargazing.structuredContent?.results as { park: string }[])[0]?.park).toBe(
        'Great Basin',
      );
    });
  });

  it('carries on without the answer when the user declines', async () => {
    await withServer(undefined, async ({ asked, call }) => {
      const result = await call('plan_park_visit', { park: 'Yosemite' });
      expect(asked).toHaveLength(1);
      expect(textOf(result)).toMatch(/Yosemite/);
      expect(result.isError).toBeFalsy();
    });
  });

  it('prefers a park that is open in the month asked about', async () => {
    await withServer(undefined, async ({ call }) => {
      const january = await call('find_park', { activity: 'hiking', month: 'January' });
      const results = january.structuredContent?.results as { park: string; access: string }[];
      expect(results[0]?.access).toBe('full');
    });
  });

  it('says so when nothing matches instead of inventing a park', async () => {
    await withServer(undefined, async ({ call }) => {
      const result = await call('find_park', { activity: 'climbing', state: 'Florida' });
      expect(textOf(result)).toMatch(/nothing in my fourteen parks/i);
    });
  });
});
