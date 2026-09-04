import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { parseArgs } from 'node:util';
import {
  createLogger,
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
 * a pending result is polled the way the skill Lambda would on the next request.
 */

const { values: args } = parseArgs({
  options: {
    remote: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
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
      '  --budget  simulate the Alexa deadline (default: turn.budgetMs from bridge.config.ts)\n',
  );
  process.exit(0);
}

const config = await loadConfigFile();
const debug = args.debug || config.features.debug;
const budgetMs = args.budget ? Number(args.budget) : config.turn.budgetMs;
const logger = createLogger(
  { service: 'chat' },
  { level: debug ? 'debug' : 'warn', write: (line) => stderr.write(line + '\n') },
);
const identity = {
  actorId: hashId(args.user as string),
  sessionId: hashId(`local-session-${Date.now()}`),
  locale: config.skill.locales[0] as string,
};

const bridge: Bridge = args.remote
  ? createRemoteBridge({
      identity,
      budgetMs,
      debug,
      region: config.aws.region,
      stillWorkingMessage: config.skill.stillWorkingMessage,
    })
  : createLocalBridge({
      config: { ...config, features: { ...config.features, debug } },
      identity,
      logger,
      budgetMs,
      debug,
    });

const rl = createInterface({ input: stdin, output: stdout });
let pendingQuestion: Question | undefined;

stdout.write(
  `Bridge chat. MCP server: ${config.mcp.url}. Budget ${budgetMs} ms.${args.remote ? ' (remote)' : ''}\n`,
);
stdout.write('Type a request. "stop" cancels, "quit" exits.\n\n');

await show(await bridge.turn({ type: 'warmup' }));

for (;;) {
  const line = (await rl.question(pendingQuestion ? 'answer> ' : 'you> ')).trim();
  if (!line) continue;
  if (line === 'quit' || line === 'exit') break;
  if (line === 'stop' || line === 'cancel') {
    await show(await bridge.turn({ type: 'cancel' }));
    pendingQuestion = undefined;
    continue;
  }
  const started = Date.now();
  const output = pendingQuestion
    ? await bridge.turn({
        type: 'answer',
        questionId: pendingQuestion.id,
        answer: answerHint(line, pendingQuestion),
      })
    : await bridge.turn({ type: 'turn', utterance: { text: line } });
  await show(output, Date.now() - started);
}

await bridge.turn({ type: 'cancel' });
await bridge.close();
rl.close();

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
    // The skill Lambda polls on the next request; here we poll on the user's behalf.
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
