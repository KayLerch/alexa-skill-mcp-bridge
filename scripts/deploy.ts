import { join } from 'node:path';
import { checkModelAccess } from './check-model-access.ts';
import { STACK_NAME, costNote, loadRepo, mcpHost, readOutputs, run, upsertEnv } from './lib.ts';

/**
 * npm run deploy: validate config, check model access, cdk deploy, print outputs, the cost
 * note, and the next step. Creates billable resources; see the cost note it prints.
 */
const { root, config } = await loadRepo();

console.log(
  `Config ok: MCP ${mcpHost(config.mcp.url)}, model ${config.agent.modelId}, region ${config.aws.region}`,
);

if (!(await checkModelAccess(config))) process.exit(1);

const status = run(
  'npx',
  [
    'cdk',
    'deploy',
    STACK_NAME,
    '--require-approval',
    'never',
    '--outputs-file',
    join(root, 'cdk-outputs.json'),
  ],
  join(root, 'infra'),
);
if (status !== 0) process.exit(status);

const outputs = readOutputs(root) ?? {};
console.log('\nOutputs:');
for (const [key, value] of Object.entries(outputs)) console.log(`  ${key}: ${value}`);

console.log('\n' + costNote(config));

if (outputs.LambdaArn) {
  // .env is git-ignored; the ARN carries the account id and must not reach a tracked file.
  upsertEnv(root, 'BRIDGE_LAMBDA_ARN', outputs.LambdaArn);
  console.log('\nLambda ARN written into .env as BRIDGE_LAMBDA_ARN.');
}

console.log('\nNext step:');
if (!config.skill.id) {
  console.log(
    '  1. npm run skill:deploy   (from the repo root: puts the ARN into skill.json, runs ask deploy, records the Alexa Skill id in .env)',
  );
  console.log(
    '  2. Optional but recommended: npm run deploy once more. With BRIDGE_SKILL_ID in .env it locks the Lambda to your Alexa Skill;',
  );
  console.log('     until then any Alexa Skill that knows the ARN above can invoke this Lambda.');
} else {
  console.log(`  Lambda permission is locked to ${config.skill.id}.`);
  console.log(
    '  If the Alexa Skill is not deployed yet: npm run skill:deploy. Then enable testing in the Alexa developer console and say: Alexa, open ' +
      config.skill.invocationName,
  );
}
