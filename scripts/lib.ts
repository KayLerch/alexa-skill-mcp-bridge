import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

export function costNote(config: BridgeConfig): string {
  return [
    'What costs money from here on (nothing runs always-on):',
    `  - Model tokens per turn (${config.agent.modelId}): about a tenth of a cent per turn.`,
    `  - Runtime CPU while a turn runs; memory while a session exists (idle timeout ${config.runtime.idleTimeoutMinutes} min, then the session is reclaimed).`,
    `  - Memory events per turn${config.memory.longTerm ? ', plus one extraction model call per session (memory.longTerm)' : ''}.`,
    `  - CloudWatch logs (${config.aws.logRetentionDays}-day retention).`,
    `${config.features.gateway ? '  - Gateway: per call (features.gateway).\n' : ''}` +
      `  - Budget alarm at ${config.aws.budgetUsd} USD/month${config.aws.budgetEmail ? ` emails ${config.aws.budgetEmail}` : ' (set aws.budgetEmail to be notified)'}.`,
    '  - Tear down with: npm run destroy',
  ].join('\n');
}
