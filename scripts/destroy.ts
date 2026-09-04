import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BatchDeleteImageCommand, ECRClient } from '@aws-sdk/client-ecr';
import { STACK_NAME, loadRepo, run } from './lib.ts';

/**
 * npm run destroy: cdk destroy, then delete this app's container images from the CDK asset
 * repository (cdk destroy leaves them behind), then remind about the Alexa skill.
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

const leftovers = existsSync(join(root, 'cdk-outputs.json')) ? ['cdk-outputs.json'] : [];
if (leftovers.length) console.log(`You can delete: ${leftovers.join(', ')}`);
const stateDir = join(root, 'skill-package', '.ask');
const hasSkill = existsSync(stateDir) && readdirSync(stateDir).length > 0;
console.log(
  '\nThe Alexa skill stays in your developer account (no cost). Delete it with: ' +
    `ask smapi delete-skill --skill-id ${config.skill.id ?? '<skill id>'}` +
    (hasSkill ? '  (skill-package/.ask holds the deployed state)' : ''),
);
console.log('AgentCore Memory records and CloudWatch logs expire on their own.');
