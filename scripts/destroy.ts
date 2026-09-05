import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BatchDeleteImageCommand, ECRClient } from '@aws-sdk/client-ecr';
import {
  PLACEHOLDER_LAMBDA_ARN,
  STACK_NAME,
  loadRepo,
  readSkillEndpoint,
  removeEnv,
  run,
  writeSkillEndpoint,
} from './lib.ts';

/**
 * npm run destroy: cdk destroy, then delete this app's container images from the CDK asset
 * repository (cdk destroy leaves them behind), then undo what deploy wrote into the working tree
 * so the repo is committable again, and remind about the Alexa Skill.
 */
const { root, config } = await loadRepo();
const infra = join(root, 'infra');

const status = run('npx', ['cdk', 'destroy', STACK_NAME, '--force'], infra);
if (status !== 0) process.exit(status);

// Image tags are the asset hashes recorded at synth time.
const assetsFile = join(infra, 'cdk.out', `${STACK_NAME}.assets.json`);
if (existsSync(assetsFile)) {
  const assets = JSON.parse(readFileSync(assetsFile, 'utf8')) as {
    dockerImages?: Record<
      string,
      { destinations: Record<string, { repositoryName: string; imageTag: string }> }
    >;
  };
  const byRepo = new Map<string, string[]>();
  for (const image of Object.values(assets.dockerImages ?? {})) {
    for (const dest of Object.values(image.destinations)) {
      byRepo.set(dest.repositoryName, [...(byRepo.get(dest.repositoryName) ?? []), dest.imageTag]);
    }
  }
  const ecr = new ECRClient({ region: config.aws.region });
  for (const [repositoryName, tags] of byRepo) {
    try {
      const out = await ecr.send(
        new BatchDeleteImageCommand({
          repositoryName,
          imageIds: tags.map((imageTag) => ({ imageTag })),
        }),
      );
      console.log(`Deleted ${out.imageIds?.length ?? 0} image(s) from ${repositoryName}`);
    } catch (err) {
      console.warn(`Could not delete images from ${repositoryName}: ${String(err)}`);
    }
  }
} else {
  console.log(
    'No cdk.out assets file found; nothing to clean in ECR (run npm run synth first to know the tags).',
  );
}

// The Lambda is gone, so the ARN that deploy and skill:deploy left behind is dead: put the
// shipped placeholder back into skill.json (tracked) and drop the ARN from .env (not tracked).
if (readSkillEndpoint(root) !== PLACEHOLDER_LAMBDA_ARN) {
  writeSkillEndpoint(root, PLACEHOLDER_LAMBDA_ARN);
  console.log('\nskill-package/skill.json: placeholder ARN restored.');
}
removeEnv(root, 'BRIDGE_LAMBDA_ARN');

const stateDir = join(root, '.ask');
const hasSkill = existsSync(stateDir) && readdirSync(stateDir).length > 0;
console.log(
  '\nThe Alexa Skill stays in your developer account (no cost). Delete it with: ' +
    `ask smapi delete-skill --skill-id ${config.skill.id ?? '<skill id>'}` +
    (hasSkill ? '  (.ask holds the deployed state)' : ''),
);
console.log(
  'BRIDGE_SKILL_ID stays in .env for that reason; remove it yourself if you delete the Alexa Skill.',
);
console.log('AgentCore Memory records and CloudWatch logs expire on their own.');
console.log(
  '\nWhat is left is git-ignored (.env, .ask/, cdk-outputs.json, infra/cdk.out/). The generated ' +
    'interaction model and tool manifest are meant to be committed. To be sure before you push: ' +
    'npm run check:leaks -- --all',
);
