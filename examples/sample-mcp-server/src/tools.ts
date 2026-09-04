import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HOTELS, WEATHER } from './data.js';

/** Timeouts around the elicitation: the client may take minutes to bring a spoken answer back. */
const ELICITATION_TIMEOUT_MS = 10 * 60 * 1000;
/** Keep the tools/call stream alive through tunnels and proxies while we wait for an answer. */
const KEEPALIVE_PING_MS = 15 * 1000;

export const SERVER_INSTRUCTIONS =
  'This server searches hotels and reports weather in a few European and US cities. ' +
  'Hotel search needs a destination, check-in and check-out dates, and the number of guests; ' +
  'if guests is missing the tool asks for it. Prices are per night in euros.';

export interface ToolOptions {
  slowSeconds: number;
  log: (event: Record<string, unknown>) => void;
}

export function registerTools(server: McpServer, options: ToolOptions): void {
  server.registerTool(
    'search_hotels',
    {
      title: 'Search hotels',
      description:
        'Find hotels in a destination city for a date range. Returns up to three matches sorted by rating. ' +
        'Asks for the number of guests when it is not provided.',
      inputSchema: {
        destination: z.string().describe('City to search in, e.g. Berlin'),
        checkIn: z.string().describe('Check-in date, ISO 8601 (YYYY-MM-DD)'),
        checkOut: z.string().describe('Check-out date, ISO 8601 (YYYY-MM-DD)'),
        guests: z.number().int().min(1).max(6).optional().describe('Number of guests, 1 to 6'),
      },
    },
    async ({ destination, checkIn, checkOut, guests }, extra): Promise<CallToolResult> => {
      let guestCount = guests;

      if (guestCount === undefined) {
        const answer = await elicitGuests(server, extra.signal, options.log);
        if (answer === undefined) {
          return text(
            'Hotel search cancelled because the number of guests was not provided.',
            true,
          );
        }
        guestCount = answer;
      }

      const matches = HOTELS.filter(
        (h) =>
          h.destination.toLowerCase() === destination.trim().toLowerCase() &&
          h.maxGuests >= guestCount,
      )
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3);

      const structuredContent = {
        destination,
        checkIn,
        checkOut,
        guests: guestCount,
        results: matches.map((h) => ({
          name: h.name,
          pricePerNight: h.pricePerNight,
          currency: 'EUR',
          rating: h.rating,
        })),
      };

      const summary =
        matches.length === 0
          ? `No hotels found in ${destination} for ${guestCount} guests.`
          : `${matches.length} hotels in ${destination} from ${checkIn} to ${checkOut} for ${guestCount} guests: ` +
            matches.map((h) => `${h.name} (${h.pricePerNight} EUR/night, ${h.rating})`).join(', ');

      return { content: [{ type: 'text', text: summary }], structuredContent };
    },
  );

  server.registerTool(
    'get_weather',
    {
      title: 'Get weather',
      description:
        'Current weather for a city: conditions plus high and low temperature in Celsius.',
      inputSchema: {
        city: z.string().describe('City name, e.g. Hamburg'),
      },
    },
    async ({ city }): Promise<CallToolResult> => {
      if (options.slowSeconds > 0) {
        // SAMPLE_SLOW_SECONDS lets device tests exercise the bridge's overrun path.
        await new Promise((r) => setTimeout(r, options.slowSeconds * 1000));
      }
      const entry = WEATHER[city.trim().toLowerCase()];
      if (!entry) {
        return text(
          `No weather data for ${city}. Known cities: ${Object.keys(WEATHER).join(', ')}.`,
          true,
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: `${city}: ${entry.conditions}, high ${entry.highC}°C, low ${entry.lowC}°C.`,
          },
        ],
        structuredContent: { city, ...entry },
      };
    },
  );
}

/**
 * Form-mode elicitation on the open tools/call stream (MCP 2025-11-25).
 * Returns the guest count, or undefined when the client declined or cancelled.
 */
async function elicitGuests(
  server: McpServer,
  signal: AbortSignal,
  log: ToolOptions['log'],
): Promise<number | undefined> {
  const keepalive = setInterval(() => {
    server.server.ping().catch(() => undefined);
  }, KEEPALIVE_PING_MS);

  try {
    const result = await server.server.elicitInput(
      {
        mode: 'form',
        message: 'How many guests will be staying?',
        requestedSchema: {
          type: 'object',
          properties: {
            guests: {
              type: 'integer',
              title: 'Guests',
              description: 'Number of guests, 1 to 6',
              minimum: 1,
              maximum: 6,
            },
          },
          required: ['guests'],
        },
      },
      { timeout: ELICITATION_TIMEOUT_MS, signal },
    );

    if (result.action !== 'accept') {
      log({ msg: 'elicitation ended without an answer', action: result.action });
      return undefined;
    }
    const guests = Number(result.content?.guests);
    return Number.isInteger(guests) && guests >= 1 && guests <= 6 ? guests : undefined;
  } catch (err) {
    // The client cancelled the tool call while the question was open, or the wait timed out.
    log({
      msg: 'elicitation aborted',
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
