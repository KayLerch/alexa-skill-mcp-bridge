import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  findConfigFile,
  turnOutputSchema,
  type Display,
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
  /** Stands in for the Alexa account-linked token when mcp.auth.type is alexaAccountLinking. */
  userToken?: string;
  /** Sent with every turn, as for a device with a screen (D54). */
  display?: Display;
}

/**
 * `chat --remote`: the same REPL through InvokeAgentRuntime against the deployed runtime.
 * runtimeSessionId is the hashed user id. The Alexa Skill Lambda also keys it on the runtime
 * version (runtimeSessionFor), so its users reach new code at their next turn after a deploy;
 * a `chat --remote` session keeps the old code until it idles out.
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
                ...(options.userToken ? { userToken: options.userToken } : {}),
                ...(options.display ? { display: options.display } : {}),
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
