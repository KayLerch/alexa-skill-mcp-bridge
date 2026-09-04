import { join } from 'node:path';
import { checkModelAccess } from './check-model-access.ts';
import { STACK_NAME, costNote, loadRepo, readOutputs, run } from './lib.ts';

/**
 * npm run deploy: validate config, check model access, cdk deploy, print outputs, the cost
 * note, and the next step. Creates billable resources; see the cost note it prints.
 */
const { root, config } = await loadRepo();

if (!(config.aws.budgetUsd > 0)) {
  console.error(
    'aws.budgetUsd must be a positive number; refusing to deploy without a cost budget.',
  );
  process.exit(1);
}
console.log(
  `Config ok: MCP ${config.mcp.url}, model ${config.agent.modelId}, region ${config.aws.region}`,
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

console.log('\nNext step:');
if (!config.skill.id) {
  console.log(
    `  1. Put the Lambda ARN into skill-package/skill.json (apis.custom.endpoint.uri): ${outputs.LambdaArn ?? '<LambdaArn>'}`,
  );
  console.log('  2. cd skill-package && ask deploy   (prints the skill id)');
  console.log(
    '  3. Put the skill id into bridge.config.ts (skill.id) and run npm run deploy again to lock the Lambda to your skill.',
  );
} else {
  console.log(
    `  Lambda permission is locked to ${config.skill.id}. If skill.json does not carry the Lambda ARN yet, set it and run: cd skill-package && ask deploy`,
  );
  console.log(
    '  Then enable testing in the Alexa developer console and say: Alexa, open ' +
      config.skill.invocationName,
  );
}
