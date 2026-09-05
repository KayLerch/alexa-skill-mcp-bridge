import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findConfigFile, loadConfigFile, type BridgeConfig } from '@alexa-mcp-bridge/core';

/** Shared bits for the deploy, destroy, and check scripts. Node 22 runs these as-is (D23). */

export interface Repo {
  root: string;
  config: BridgeConfig;
}

export async function loadRepo(): Promise<Repo> {
  const configPath = findConfigFile();
  if (!configPath) throw new Error('bridge.config.ts not found; run from inside the repo');
  return { root: dirname(configPath), config: await loadConfigFile(configPath) };
}

export function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): number {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

export const STACK_NAME = 'AlexaMcpBridgeStack';

export interface StackOutputs {
  LambdaArn?: string;
  RuntimeArn?: string;
  MemoryId?: string;
  GatewayUrl?: string;
}

export function readOutputs(root: string): StackOutputs | undefined {
  const file = join(root, 'cdk-outputs.json');
  if (!existsSync(file)) return undefined;
  const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, StackOutputs>;
  return all[STACK_NAME];
}

/** Host only: the full URL can carry a token someone pastes into an issue by accident. */
export function mcpHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparsable mcp.url)';
  }
}

export function costNote(config: BridgeConfig): string {
  return [
    'What costs money from here on (nothing runs always-on):',
    `  - Model tokens per turn (${config.agent.modelId}): about a tenth of a cent per turn.`,
    `  - Runtime CPU while a turn runs; memory while a session exists (idle timeout ${config.runtime.idleTimeoutMinutes} min, then the session is reclaimed).`,
    `  - Memory events per turn${config.memory.longTerm ? ', plus one extraction model call per session (memory.longTerm)' : ''}.`,
    `  - CloudWatch logs (${config.aws.logRetentionDays}-day retention).`,
    `${config.features.gateway ? '  - Gateway: per call (features.gateway).\n' : ''}` +
      '  - Nothing alarms you when this adds up: watch Billing in the console, or tear down.',
    '  - Tear down with: npm run destroy',
  ].join('\n');
}

/**
 * Set one KEY=value line in the repo's .env, replacing an existing line for that key. .env is
 * git-ignored, which is why deploy outputs that identify the developer (the Lambda ARN, the Alexa
 * Skill id) go here and nowhere tracked.
 */
export function upsertEnv(root: string, key: string, value: string): void {
  const file = join(root, '.env');
  const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\n+$/, '') : '';
  const lines = current ? current.split('\n') : [];
  const pattern = new RegExp(`^#?\\s*${key}=`);
  const index = lines.findIndex((line) => pattern.test(line));
  const entry = `${key}=${value}`;
  if (index >= 0) lines[index] = entry;
  else {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(entry);
  }
  writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
}

const SKILL_JSON = ['skill-package', 'skill.json'];

/** What skill.json ships with; `npm run destroy` puts it back once the Lambda is gone. */
export const PLACEHOLDER_LAMBDA_ARN =
  'arn:aws:lambda:us-east-1:000000000000:function:REPLACE-WITH-LambdaArn-FROM-npm-run-deploy';

/** Remove a key from .env, if present. */
export function removeEnv(root: string, key: string): void {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  const pattern = new RegExp(`^${key}=`);
  const kept = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !pattern.test(line));
  writeFileSync(file, kept.join('\n').replace(/\n*$/, '\n'));
}

/** The shipped placeholder, or any all-zero account: not a real Lambda. */
export function isPlaceholderArn(uri: string | undefined): boolean {
  return !uri || uri.includes('REPLACE') || uri.includes(':000000000000:');
}

export function readSkillEndpoint(root: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(root, ...SKILL_JSON), 'utf8')) as {
    manifest?: { apis?: { custom?: { endpoint?: { uri?: string } } } };
  };
  return manifest.manifest?.apis?.custom?.endpoint?.uri;
}

export function writeSkillEndpoint(root: string, arn: string): void {
  const file = join(root, ...SKILL_JSON);
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
    manifest: { apis: { custom: { endpoint?: { uri?: string } } } };
  };
  manifest.manifest.apis.custom.endpoint = { uri: arn };
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
