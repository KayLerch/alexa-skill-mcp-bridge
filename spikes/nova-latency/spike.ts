import { parseArgs } from 'node:util';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * S4: raw Bedrock Converse baseline for one typical turn:
 * system prompt of realistic size, two tool definitions, one tool call, one phrasing call.
 * Usage: node spike.ts [--runs 20] [--model us.amazon.nova-2-lite-v1:0] [--effort low|medium|high|off]
 */

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '20' },
    model: { type: 'string', default: 'us.amazon.nova-2-lite-v1:0' },
    effort: { type: 'string', default: 'low' },
    region: { type: 'string', default: 'us-east-1' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'node spike.ts [--runs 20] [--model id] [--effort low|medium|high|off] [--region us-east-1]',
  );
  process.exit(0);
}

const SYSTEM = `You are a voice assistant speaking through an Alexa+ device. You help the user by calling the tools of an MCP server called "hotels-and-weather".

Rules for every answer:
- Answer in one to three short sentences. This is spoken aloud.
- No markdown, lists, URLs, code, or symbols. Say numbers and dates in spoken form ("the fifth of October", "two hundred euros").
- Ask exactly one question at a time, and only when you need something you cannot infer.
- When a tool returns several results, summarize the top one or two and offer to hear more.
- End with at most one natural follow-up when the conversation should continue. When nothing more is needed, answer and stop.
- Never read raw JSON or error text aloud. If a tool fails, apologize briefly and say what the user can try.

Server instructions: This server searches hotels and reports weather in a few European and US cities. Hotel search needs a destination, check-in and check-out dates, and the number of guests; if guests is missing the tool asks for it. Prices are per night in euros.

Tools available: search_hotels (find hotels in a city for a date range), get_weather (current weather for a city).

Today's date is 2026-09-03. The user's locale is en-US.`;

const TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'search_hotels',
      description:
        'Find hotels in a destination city for a date range. Returns up to three matches sorted by rating. Asks for the number of guests when it is not provided.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            destination: { type: 'string', description: 'City to search in, e.g. Berlin' },
            checkIn: { type: 'string', description: 'Check-in date, ISO 8601 (YYYY-MM-DD)' },
            checkOut: { type: 'string', description: 'Check-out date, ISO 8601 (YYYY-MM-DD)' },
            guests: {
              type: 'integer',
              minimum: 1,
              maximum: 6,
              description: 'Number of guests, 1 to 6',
            },
          },
          required: ['destination', 'checkIn', 'checkOut'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_weather',
      description:
        'Current weather for a city: conditions plus high and low temperature in Celsius.',
      inputSchema: {
        json: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name, e.g. Hamburg' } },
          required: ['city'],
        },
      },
    },
  },
];

const TOOL_RESULT = {
  destination: 'Berlin',
  checkIn: '2026-10-05',
  checkOut: '2026-10-07',
  guests: 2,
  results: [
    { name: 'Hotel Adlon', pricePerNight: 320, currency: 'EUR', rating: 4.8 },
    { name: 'Michelberger Hotel', pricePerNight: 140, currency: 'EUR', rating: 4.5 },
    { name: 'Circus Hostel', pricePerNight: 60, currency: 'EUR', rating: 4.3 },
  ],
};

const client = new BedrockRuntimeClient({ region: values.region });
const modelId = values.model!;
const isNova = modelId.includes('nova');
const additional =
  isNova && values.effort !== 'off'
    ? { reasoningConfig: { type: 'enabled', maxReasoningEffort: values.effort } }
    : undefined;

async function converse(messages: Message[]) {
  const t0 = Date.now();
  const out = await client.send(
    new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages,
      toolConfig: { tools: TOOLS },
      inferenceConfig: { maxTokens: 400 },
      ...(additional ? { additionalModelRequestFields: additional } : {}),
    }),
  );
  return { ms: Date.now() - t0, out };
}

interface Run {
  call1Ms: number;
  call2Ms: number;
  totalMs: number;
  toolPicked: string | undefined;
  inputTokens: number;
  outputTokens: number;
  answer: string;
}

async function oneRun(): Promise<Run> {
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { text: 'find hotels in Berlin from the fifth to the seventh of October for two guests' },
      ],
    },
  ];
  const first = await converse(messages);
  const assistant = first.out.output!.message!;
  const toolUse = assistant.content?.find((c) => c.toolUse)?.toolUse;
  let call2Ms = 0;
  let answer = assistant.content?.map((c) => c.text ?? '').join('') ?? '';
  let tokens = { i: first.out.usage?.inputTokens ?? 0, o: first.out.usage?.outputTokens ?? 0 };
  if (toolUse) {
    messages.push(assistant);
    messages.push({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: toolUse.toolUseId!,
            content: [{ json: TOOL_RESULT }],
            status: 'success',
          },
        },
      ],
    });
    const second = await converse(messages);
    call2Ms = second.ms;
    answer = second.out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    tokens = {
      i: tokens.i + (second.out.usage?.inputTokens ?? 0),
      o: tokens.o + (second.out.usage?.outputTokens ?? 0),
    };
  }
  return {
    call1Ms: first.ms,
    call2Ms,
    totalMs: first.ms + call2Ms,
    toolPicked: toolUse?.name,
    inputTokens: tokens.i,
    outputTokens: tokens.o,
    answer: answer.trim(),
  };
}

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

const runs: Run[] = [];
const n = Number(values.runs);
console.log(`model=${modelId} effort=${values.effort} runs=${n}`);
for (let i = 0; i < n; i++) {
  const r = await oneRun();
  runs.push(r);
  console.log(
    `#${i + 1} call1=${r.call1Ms}ms call2=${r.call2Ms}ms total=${r.totalMs}ms tool=${r.toolPicked} tokens=${r.inputTokens}/${r.outputTokens} answer="${r.answer.slice(0, 120)}"`,
  );
}
const totals = runs.map((r) => r.totalMs);
console.log('\n=== SUMMARY ===');
console.log(
  JSON.stringify(
    {
      model: modelId,
      effort: values.effort,
      runs: n,
      p50Ms: percentile(totals, 50),
      p95Ms: percentile(totals, 95),
      maxMs: Math.max(...totals),
      toolPickRate: runs.filter((r) => r.toolPicked === 'search_hotels').length / n,
      avgInputTokens: Math.round(runs.reduce((a, r) => a + r.inputTokens, 0) / n),
      avgOutputTokens: Math.round(runs.reduce((a, r) => a + r.outputTokens, 0) / n),
    },
    null,
    2,
  ),
);
