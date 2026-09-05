import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  isPlaceholderArn,
  loadRepo,
  readSkillEndpoint,
  run,
  upsertEnv,
  writeSkillEndpoint,
} from './lib.ts';

/**
 * npm run skill:deploy
 *
 * Deploys the Alexa Skill: puts the Lambda ARN into skill-package/skill.json, runs `ask deploy`
 * from the repo root (where ask-resources.json lives), and records the Alexa Skill id in .env so
 * the next `npm run deploy` can lock the Lambda to it. `npm run deploy` writes the ARN into .env
 * as BRIDGE_LAMBDA_ARN; an ARN pasted into skill.json by hand works too.
 */
const { root, config } = await loadRepo();
const locale = config.skill.locales[0] ?? 'en-US';

const fromEnv = process.env.BRIDGE_LAMBDA_ARN?.trim();
const inSkillJson = readSkillEndpoint(root);
const arn = fromEnv || (isPlaceholderArn(inSkillJson) ? undefined : inSkillJson);

if (!arn) {
  console.error(
    '\nNo Lambda ARN to deploy the Alexa Skill against.\n' +
      '  Either run `npm run deploy`, which writes BRIDGE_LAMBDA_ARN into .env,\n' +
      '  or put the ARN into .env yourself as BRIDGE_LAMBDA_ARN=arn:aws:lambda:...,\n' +
      '  or paste it into skill-package/skill.json at apis.custom.endpoint.uri.\n',
  );
  process.exit(1);
}
if (!/^arn:aws[a-z-]*:lambda:/.test(arn)) {
  console.error(`\nBRIDGE_LAMBDA_ARN does not look like a Lambda ARN: ${arn}\n`);
  process.exit(1);
}

const model = join(root, 'skill-package', 'interactionModels', 'custom', `${locale}.json`);
if (!existsSync(model)) {
  console.error(`\nNo interaction model for ${locale}. Run: npm run generate\n`);
  process.exit(1);
}

if (spawnSync('ask', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.error('\nThe ASK CLI is not installed. Run: npm install -g ask-cli && ask configure\n');
  process.exit(1);
}

if (inSkillJson !== arn) {
  writeSkillEndpoint(root, arn);
  console.log(
    `Lambda ARN written into skill-package/skill.json (keep that edit local; the pre-commit hook refuses it).`,
  );
}

console.log('Deploying the Alexa Skill with ask deploy (from the repo root)...');
const status = run('ask', ['deploy'], root);
if (status !== 0) process.exit(status);

const skillId = deployedSkillId(root);
if (skillId) {
  upsertEnv(root, 'BRIDGE_SKILL_ID', skillId);
  console.log(`\nAlexa Skill id ${skillId} written into .env as BRIDGE_SKILL_ID.`);
} else {
  console.log(
    '\nCould not read the Alexa Skill id from .ask/ask-states.json; put it into .env as BRIDGE_SKILL_ID yourself.',
  );
}

console.log('\nNext step:');
console.log(
  `  In the Alexa developer console (https://developer.amazon.com/alexa/console/ask), open the ` +
    `Alexa Skill named '${config.skill.invocationName}', go to Test, set testing to Development, ` +
    `and type: open ${config.skill.invocationName}`,
);
console.log(
  '\nOptional but recommended: run `npm run deploy` once more. With BRIDGE_SKILL_ID in .env it locks ' +
    'the Lambda to this Alexa Skill; until then any Alexa Skill that knows the ARN can invoke it. ' +
    'Remove BRIDGE_SKILL_ID from .env if you want to keep it open.',
);

/**
 * The ASK CLI records the deployed skill id in .ask/ask-states.json next to ask-resources.json,
 * which is the repo root here, under the profile it deployed with.
 */
function deployedSkillId(repoRoot: string): string | undefined {
  const file = join(repoRoot, '.ask', 'ask-states.json');
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, 'utf8');
  try {
    const states = JSON.parse(raw) as { profiles?: Record<string, { skillId?: string }> };
    const profile = process.env.ASK_DEFAULT_PROFILE ?? 'default';
    const id =
      states.profiles?.[profile]?.skillId ?? Object.values(states.profiles ?? {})[0]?.skillId;
    if (id) return id;
  } catch {
    // fall through to the pattern match
  }
  return raw.match(/amzn1\.ask\.skill\.[0-9a-f-]+/)?.[0];
}
