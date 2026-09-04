import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  findConfigFile,
  turnOutputSchema,
  type TurnInput,
  type TurnOutput,
} from '@alexa-mcp-bridge/core';
import type { Bridge, BridgeIdentity } from './bridge.js';

export interface RemoteBridgeOptions {
  identity: BridgeIdentity;
  budgetMs: number;
  debug: boolean;
  region: string;
  runtimeArn?: string;
  stillWorkingMessage: string;
}

/**
 * `chat --remote`: the same REPL through InvokeAgentRuntime against the deployed runtime.
 * runtimeSessionId is the hashed user id, exactly what the skill Lambda sends.
 */
export function createRemoteBridge(options: RemoteBridgeOptions): Bridge {
  const runtimeArn = options.runtimeArn ?? process.env.AGENT_RUNTIME_ARN ?? runtimeArnFromOutputs();
  if (!runtimeArn) {
    throw new Error(
      'No runtime ARN: run `npm run deploy` (writes cdk-outputs.json) or set AGENT_RUNTIME_ARN.',
    );
  }
  const client = new BedrockAgentCoreClient({ region: options.region });

  return {
    async turn(turn: TurnInput): Promise<TurnOutput> {
      const aborter = new AbortController();
      const timer = setTimeout(() => aborter.abort(), options.budgetMs);
      try {
        const response = await client.send(
          new InvokeAgentRuntimeCommand({
            agentRuntimeArn: runtimeArn,
            runtimeSessionId: options.identity.actorId,
            contentType: 'application/json',
            accept: 'application/json',
            payload: Buffer.from(
              JSON.stringify({
                turn,
                actorId: options.identity.actorId,
                sessionId: options.identity.sessionId,
                locale: options.identity.locale,
                budgetMs: options.budgetMs,
                debug: options.debug,
              }),
            ),
          }),
          { abortSignal: aborter.signal },
        );
        const body = await response.response?.transformToString();
        return turnOutputSchema.parse(JSON.parse(body ?? '{}'));
      } catch (err) {
        if (aborter.signal.aborted) {
          return {
            status: 'pending',
            speech: options.stillWorkingMessage,
            reprompt: options.stillWorkingMessage,
            endSession: false,
            visual: null,
          };
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    close: async () => undefined,
  };
}

function runtimeArnFromOutputs(): string | undefined {
  const configPath = findConfigFile();
  if (!configPath) return undefined;
  const file = join(configPath, '..', 'cdk-outputs.json');
  if (!existsSync(file)) return undefined;
  const outputs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { RuntimeArn?: string }>;
  return outputs.AlexaMcpBridgeStack?.RuntimeArn;
}
