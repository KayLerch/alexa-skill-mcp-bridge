import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  buildSystemPrompt,
  formatToolList,
} from '/Users/kay/Workspace/alexa-skill-mcp-bridge-brief/packages/agent/dist/index.js';

const client = new BedrockRuntimeClient({ region: 'us-east-1' });
const modelId = 'us.amazon.nova-2-lite-v1:0';
const tools = [
  {
    name: 'search_hotels',
    description:
      'Find hotels in a destination city for a date range. Returns up to three matches sorted by rating. Asks for the number of guests when it is not provided.',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        guests: { type: 'integer', minimum: 1, maximum: 6 },
      },
      required: ['destination', 'checkIn', 'checkOut'],
    },
  },
  {
    name: 'get_weather',
    description: 'Current weather for a city: conditions plus high and low temperature in Celsius.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
  {
    name: 'ask_user',
    description: 'Ask the user one short question when a required tool argument is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        expects: { type: 'string', enum: ['yesNo', 'date', 'number', 'choice', 'text'] },
        choices: { type: 'array', items: { type: 'string' } },
      },
      required: ['message', 'expects'],
    },
  },
];
const system = buildSystemPrompt({
  serverName: 'sample-hotel-and-weather',
  serverInstructions: 'This server searches hotels and reports weather.',
  toolList: formatToolList(tools),
  locale: 'en-US',
  today: '2026-09-03',
  memoryContext: '',
});
const toolConfig = {
  tools: tools.map((t) => ({
    toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } },
  })),
};

async function run(label, toolResultContent, opts = {}) {
  const messages = [
    { role: 'user', content: [{ text: opts.user ?? 'what is the weather in Hamburg' }] },
    {
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'tooluse_1',
            name: opts.tool ?? 'get_weather',
            input: opts.input ?? { city: 'Hamburg' },
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        { toolResult: { toolUseId: 'tooluse_1', status: 'success', content: toolResultContent } },
      ],
    },
  ];
  const t0 = Date.now();
  try {
    const out = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: opts.maxTokens ?? 400 },
      }),
    );
    const text = out.output?.message?.content
      ?.map((c) => c.text ?? (c.reasoningContent ? '[reasoning]' : JSON.stringify(c)))
      .join(' | ');
    console.log(
      `${label}: ${Date.now() - t0}ms stop=${out.stopReason} usage=${JSON.stringify(out.usage)}\n   -> ${text?.slice(0, 300)}`,
    );
  } catch (e) {
    console.log(`${label}: ERROR ${e.name}: ${e.message}`);
  }
}
const weather = { city: 'Hamburg', conditions: 'light rain', highC: 18, lowC: 11 };
await run('A json+text', [
  { json: weather },
  { text: 'Hamburg: light rain, high 18°C, low 11°C.' },
]);
await run('B text only', [{ text: 'Hamburg: light rain, high 18°C, low 11°C.' }]);
await run('C json only', [{ json: weather }]);
const hotels = {
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
await run(
  'D hotels json+text max400',
  [
    { json: hotels },
    {
      text: '3 hotels in Berlin from 2026-10-05 to 2026-10-07 for 2 guests: Hotel Adlon (320 EUR/night, 4.8), Michelberger Hotel (140 EUR/night, 4.5), Circus Hostel (60 EUR/night, 4.3)',
    },
  ],
  {
    user: 'find hotels in Berlin from the fifth to the seventh of October',
    tool: 'search_hotels',
    input: { destination: 'Berlin', checkIn: '2026-10-05', checkOut: '2026-10-07' },
  },
);
