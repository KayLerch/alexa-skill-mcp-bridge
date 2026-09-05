import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { parseArgs } from 'node:util';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createLogger,
  findConfigFile,
  hashId,
  loadConfigFile,
  type AnswerHint,
  type Question,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import { createLocalBridge, type Bridge } from './bridge.js';
import { createRemoteBridge } from './remote.js';

/**
 * npm run chat: a REPL over the Turn contract. In-process by default (the fastest dev loop),
 * --remote through the deployed runtime. Questions are answered at an "answer>" prompt,
 * a pending result is polled the way the Alexa Skill Lambda would on the next request.
 */

const { values: args } = parseArgs({
  options: {
    remote: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
    budget: { type: 'string' },
    user: { type: 'string', default: 'local-user' },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  stdout.write(
    'npm run chat [-- --remote] [--debug] [--budget <ms>] [--user <name>]\n' +
      '  --remote  talk to the deployed AgentCore runtime instead of running in-process\n' +
      '  --debug   show tool calls and timings\n' +
      '  --record  append what you say, and the tool chosen for it, to skill-package/training/<locale>.chat.jsonl for npm run generate\n' +
      '  --budget  simulate the Alexa deadline (default: turn.budgetMs from bridge.config.ts)\n',
  );
  process.exit(0);
}

const config = await loadConfigFile();
const debug = args.debug || config.features.debug;
const budgetMs = args.budget ? Number(args.budget) : config.turn.budgetMs;
// Humans read this terminal: one readable line per log event instead of JSON.
const logger = createLogger(
  { service: 'chat' },
  {
    level: debug ? 'debug' : 'warn',
    write: (line) => {
      const event = JSON.parse(line) as {
        level: string;
        msg: string;
        errorMessage?: string;
        tool?: string;
      };
      const detail = event.errorMessage
        ? `: ${event.errorMessage}`
        : event.tool
          ? ` (${event.tool})`
          : '';
      stderr.write(`  [${event.level}] ${event.msg}${detail}\n`);
    },
  },
);
const identity = {
  actorId: hashId(args.user as string),
  sessionId: hashId(`local-session-${Date.now()}`),
  locale: config.skill.locales[0] as string,
};

// Recording needs the tool calls to label what was said, so it collects debug output even
// when nothing prints it.
const collect = debug || Boolean(args.record);
const bridge: Bridge = args.remote
  ? createRemoteBridge({
      identity,
      budgetMs,
      debug: collect,
      region: config.aws.region,
      stillWorkingMessage: config.skill.stillWorkingMessage,
    })
  : createLocalBridge({
      config: { ...config, features: { ...config.features, debug: collect } },
      identity,
      logger,
      budgetMs,
      debug: collect,
    });

// Lines come through the async iterator so piped input (scripts, smoke tests) works as well
// as a terminal: nothing typed before we ask is lost, and end of input ends the session.
const rl = createInterface({ input: stdin, output: stdout, terminal: stdout.isTTY });
const lines = rl[Symbol.asyncIterator]();
let pendingQuestion: Question | undefined;

async function ask(prompt: string): Promise<string | undefined> {
  stdout.write(prompt);
  const next = await lines.next();
  return next.done ? undefined : next.value.trim();
}

stdout.write(
  `Bridge chat. MCP server: ${config.mcp.url}. Budget ${budgetMs} ms.${args.remote ? ' (remote)' : ''}\n`,
);
stdout.write('Type a request. "stop" cancels, "quit" exits.\n\n');

await show(await bridge.turn({ type: 'warmup' }));
const notReady = await bridge.waitReady?.(20_000);
if (notReady) {
  stderr.write(
    `\nCould not connect to the MCP server at ${config.mcp.url}: ${notReady}\n\n` +
      'What to check:\n' +
      '  - Is the server running? For the bundled sample: npm run sample:start (in another terminal).\n' +
      '  - Does mcp.url (bridge.config.ts, or BRIDGE_MCP_URL in .env) match its address and port?\n' +
      '  - Does the server need auth? Set BRIDGE_MCP_AUTH_TYPE, BRIDGE_MCP_SECRET_NAME and MCP_SECRET_VALUE in .env.\n' +
      '  - npm run doctor checks all of this and more.\n',
  );
  await bridge.close();
  rl.close();
  process.exit(1);
}
stdout.write('Connected. ');

for (;;) {
  const line = await ask(pendingQuestion ? 'answer> ' : 'you> ');
  if (line === undefined || line === 'quit' || line === 'exit') break;
  if (!line) continue;
  if (line === 'stop' || line === 'cancel') {
    await show(await bridge.turn({ type: 'cancel' }));
    pendingQuestion = undefined;
    continue;
  }
  const started = Date.now();
  const wasAnswer = pendingQuestion;
  const output = pendingQuestion
    ? await bridge.turn({
        type: 'answer',
        questionId: pendingQuestion.id,
        answer: answerHint(line, pendingQuestion),
      })
    : await bridge.turn({ type: 'turn', utterance: { text: line } });
  if (args.record) {
    recordTraining(
      line,
      wasAnswer
        ? { kind: 'answer', expects: wasAnswer.expects }
        : { kind: 'turn', tool: output.debug?.toolCalls[0]?.name },
    );
  }
  await show(output, Date.now() - started);
}

stdout.write('\n');
await bridge.turn({ type: 'cancel' });
await bridge.close();
rl.close();
process.exit(0);

async function show(output: TurnOutput, elapsedMs?: number): Promise<void> {
  pendingQuestion = output.status === 'question' ? output.question : undefined;
  const timing = elapsedMs !== undefined ? ` (${elapsedMs} ms)` : '';
  if (output.speech) stdout.write(`alexa> ${output.speech}${timing}\n`);
  else if (elapsedMs !== undefined) stdout.write(`alexa> (nothing to say)${timing}\n`);
  if (debug && output.debug) {
    const calls = output.debug.toolCalls
      .map((c) => `${c.name} ${c.status} ${c.elapsedMs}ms`)
      .join(', ');
    stderr.write(
      `  [debug] status=${output.status} model calls=${output.debug.modelCalls} tools=[${calls}] agent=${output.debug.elapsedMs}ms\n`,
    );
  }
  if (output.status === 'question') {
    stderr.write(
      `  [expects ${output.question?.expects}${output.question?.choices ? ': ' + output.question.choices.join(' | ') : ''}]\n`,
    );
  }
  if (output.status === 'pending') {
    // The Alexa Skill Lambda polls on the next request; here we poll on the user's behalf.
    await new Promise((r) => setTimeout(r, 1000));
    const polled = await bridge.turn({ type: 'poll' });
    if (polled.status !== 'done' || polled.speech) await show(polled);
  }
  if (output.status === 'done' && output.endSession && output.speech)
    stdout.write('  (session would end here)\n');
}

function answerHint(text: string, question: Question): AnswerHint {
  if (question.expects === 'yesNo') {
    if (/^(y|yes|yeah|yep|sure)\b/i.test(text)) return { yesNo: true };
    if (/^(n|no|nope|nah)\b/i.test(text)) return { yesNo: false };
  }
  if (/^(no|nope)$/i.test(text)) return { yesNo: false, text };
  return { text };
}

/**
 * One JSON line per turn: what was said, and what the agent did with it. The generator turns
 * these into sample utterances (see packages/generator/src/training.ts). Recording is opt-in
 * and the file is yours to prune; it lives next to the overrides and survives regeneration.
 */
function recordTraining(
  text: string,
  what: { kind: 'turn'; tool?: string | undefined } | { kind: 'answer'; expects: string },
): void {
  const locale = config.skill.locales[0] ?? 'en-US';
  const file = join(
    dirname(findConfigFile() ?? process.cwd()),
    'skill-package',
    'training',
    `${locale}.chat.jsonl`,
  );
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ text, ...what, at: new Date().toISOString() }) + '\n');
}
