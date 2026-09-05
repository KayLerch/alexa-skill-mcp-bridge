import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Log } from '@alexa-mcp-bridge/mcp-server-harness';
import { ACTIVITIES, MONTHS, PARKS, type Activity, type Park } from './data.js';

/** Timeouts around the elicitation: the client may take minutes to bring a spoken answer back. */
const ELICITATION_TIMEOUT_MS = 10 * 60 * 1000;
/** Keep the tools/call stream alive through tunnels and proxies while we wait for an answer. */
const KEEPALIVE_PING_MS = 15 * 1000;

export const SERVER_INSTRUCTIONS =
  'This server answers questions about fourteen US national parks from a fixed extract of ' +
  'public National Park Service data: which activities each park offers, what is open in which ' +
  'month, and what each park is known for. Ask about a named park, or ask which park suits an ' +
  'activity, a month, or a state. The answer depends on all three, so a tool asks for what is ' +
  'missing when the question would otherwise be underdetermined. Unofficial demo, not ' +
  'affiliated with the National Park Service.';

const PARK_NAMES = PARKS.map((p) => p.name);
const STATES = [...new Set(PARKS.flatMap((p) => p.states))].sort();

export interface ToolOptions {
  log: Log;
}

export function registerTools(server: McpServer, options: ToolOptions): void {
  server.registerTool(
    'plan_park_visit',
    {
      title: 'Plan a park visit',
      description:
        'What a named national park is like in a given month: what is open, what is limited, ' +
        'and what the park is known for. Asks which month when none is given, because access ' +
        'changes through the year.',
      inputSchema: {
        park: z.enum(PARK_NAMES as [string, ...string[]]).describe('The national park, by name'),
        month: z
          .enum(MONTHS as unknown as [string, ...string[]])
          .optional()
          .describe('Month of the visit'),
      },
    },
    async ({ park, month }, extra): Promise<CallToolResult> => {
      const found = PARKS.find((p) => p.name.toLowerCase() === park.trim().toLowerCase());
      if (!found) {
        return text(`I do not have ${park}. I know ${PARK_NAMES.join(', ')}.`, true);
      }

      let when = month;
      if (!when) {
        // The answer genuinely depends on the month, so ask rather than average over the year.
        const answer = await elicit(
          server,
          extra,
          options.log,
          `Which month are you thinking of for ${found.name}?`,
          { month: { type: 'string', title: 'Month', enum: [...MONTHS] } },
        );
        if (!answer) return text(`No problem. ${found.name}: ${found.highlight}`);
        when = String(answer.month);
      }

      const index = MONTHS.indexOf(when as (typeof MONTHS)[number]) + 1;
      const access = accessIn(found, index);
      const structuredContent = {
        park: found.name,
        states: found.states,
        month: when,
        access,
        seasonNote: found.season.note,
        highlight: found.highlight,
        // What it is known for, not everything it offers: the whole list gets read aloud.
        knownFor: found.signature,
        source: found.sources[0],
      };
      return {
        content: [
          {
            type: 'text',
            text:
              `${found.name} in ${when}: ${accessSentence(access)} ${found.season.note} ` +
              `${found.highlight}`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'find_park',
    {
      title: 'Find a park',
      description:
        'Which national park suits an activity, a month, a state, or any combination of them. ' +
        'Answers outright when an activity is given; asks what the visitor wants to do when it ' +
        'is missing, because a month or a state alone leaves several parks in the running.',
      inputSchema: {
        activity: z
          .enum(ACTIVITIES as unknown as [string, ...string[]])
          .optional()
          .describe('What the visitor wants to do'),
        month: z
          .enum(MONTHS as unknown as [string, ...string[]])
          .optional()
          .describe('Month of the visit'),
        state: z
          .enum(STATES as [string, ...string[]])
          .optional()
          .describe('US state to look in'),
      },
    },
    async ({ activity, month, state }, extra): Promise<CallToolResult> => {
      let want = activity as Activity | undefined;
      if (!want) {
        // A month or a state still leaves several parks, and which one is right depends on what
        // the visitor wants to do. One question beats reading out a list.
        const answer = await elicit(
          server,
          extra,
          options.log,
          'What would you like to do — hiking, wildlife watching, stargazing, fishing, or something else?',
          { activity: { type: 'string', title: 'Activity', enum: [...ACTIVITIES] } },
        );
        if (!answer)
          return text('No problem. Ask me about any park, or any month, whenever you like.');
        want = answer.activity as Activity;
      }

      const monthIndex = month ? MONTHS.indexOf(month as (typeof MONTHS)[number]) + 1 : undefined;
      const matches = PARKS.filter(
        (p) =>
          (!want || p.activities.includes(want)) &&
          (!state || p.states.includes(state)) &&
          (!monthIndex || accessIn(p, monthIndex) !== 'closed'),
      ).sort((a, b) => score(b, want, monthIndex) - score(a, want, monthIndex));

      if (matches.length === 0) {
        return text(
          `Nothing in my fourteen parks matches${want ? ` ${want}` : ''}` +
            `${month ? ` in ${month}` : ''}${state ? ` in ${state}` : ''}.`,
        );
      }

      const top = matches.slice(0, 3);
      const best = top[0] as Park;
      const structuredContent = {
        criteria: { activity: want ?? null, month: month ?? null, state: state ?? null },
        results: top.map((p) => ({
          park: p.name,
          states: p.states,
          highlight: p.highlight,
          seasonNote: p.season.note,
          ...(monthIndex ? { access: accessIn(p, monthIndex) } : {}),
          source: p.sources[0],
        })),
      };
      const summary =
        `${best.name} in ${best.states.join(' and ')}. ${best.highlight}` +
        (monthIndex ? ` In ${month}: ${accessSentence(accessIn(best, monthIndex))}` : '') +
        (top.length > 1
          ? ` Also worth a look: ${top
              .slice(1)
              .map((p) => p.name)
              .join(' and ')}.`
          : '');
      return { content: [{ type: 'text', text: summary }], structuredContent };
    },
  );
}

type Access = 'full' | 'limited' | 'closed';

function accessIn(park: Park, month: number): Access {
  if (park.season.fullAccess.includes(month)) return 'full';
  if (park.season.limited.includes(month)) return park.season.openAllYear ? 'limited' : 'closed';
  return 'limited';
}

function accessSentence(access: Access): string {
  if (access === 'full') return 'everything is open.';
  if (access === 'closed') return 'the season is over, so services are shut.';
  return 'some roads or services are cut back.';
}

/**
 * A park known for the activity comes first, then one that is actually open in the month asked
 * about. Without both, the order is the dataset's, which is stable and roughly iconic-first.
 */
function score(park: Park, activity?: Activity, month?: number): number {
  const known = activity && park.signature.includes(activity) ? 20 : 0;
  if (!month) return known;
  const access = accessIn(park, month);
  return (
    known +
    (access === 'full' ? 10 : access === 'limited' ? 3 : 0) +
    (park.season.highlighted.includes(month) ? 5 : 0)
  );
}

/**
 * One elicitation, form mode, on the open tools/call stream (MCP 2025-11-25). Returns the
 * answered content, or undefined when the client declined, cancelled or timed out.
 */
async function elicit(
  server: McpServer,
  extra: { signal: AbortSignal; sessionId?: string; requestId: string | number },
  log: Log,
  message: string,
  properties: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const { signal, sessionId: session } = extra;
  const keepalive = setInterval(() => {
    server.server.ping().catch(() => undefined);
  }, KEEPALIVE_PING_MS);

  try {
    const result = await server.server.elicitInput(
      {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: properties as never,
          required: Object.keys(properties),
        },
      },
      {
        timeout: ELICITATION_TIMEOUT_MS,
        signal,
        // Ride the open tools/call stream. Without this the SDK sends the question on the
        // standalone SSE stream, and if the client has not opened that yet the message is
        // dropped without an error and the call waits out its timeout (see docs/decisions.md).
        relatedRequestId: extra.requestId,
      },
    );
    if (result.action !== 'accept') {
      log({ msg: 'elicitation ended without an answer', session, action: result.action });
      return undefined;
    }
    return result.content;
  } catch (err) {
    log({
      msg: 'elicitation aborted',
      session,
      reason: signal.aborted ? 'tool call cancelled' : String(err),
    });
    return undefined;
  } finally {
    clearInterval(keepalive);
  }
}

function text(message: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError };
}
