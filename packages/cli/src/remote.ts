import type { Bridge, BridgeIdentity } from './bridge.js';

export interface RemoteBridgeOptions {
  identity: BridgeIdentity;
  budgetMs: number;
  debug: boolean;
  runtimeArn?: string;
  region: string;
}

/** `chat --remote` lands with the CDK stack (Phase 4). */
export function createRemoteBridge(_options: RemoteBridgeOptions): Bridge {
  throw new Error(
    '--remote needs the deployed runtime (Phase 4 of EXECUTION-PLAN.md). Run `npm run deploy` first.',
  );
}
