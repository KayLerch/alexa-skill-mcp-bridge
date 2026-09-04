import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { BridgeConfig } from '@alexa-mcp-bridge/core';
import { loadRepo } from './lib.ts';

/**
 * One tiny Converse call per configured model. Fails with the console step when access is
 * not enabled. Used by `npm run deploy` as a pre-flight and standalone via npm run check-model-access.
 */
export async function checkModelAccess(config: BridgeConfig): Promise<boolean> {
  const client = new BedrockRuntimeClient({ region: config.aws.region });
  const models = [
    config.agent.modelId,
    ...(config.agent.fallbackModelId ? [config.agent.fallbackModelId] : []),
  ];
  let ok = true;
  for (const modelId of models) {
    try {
      await client.send(
        new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: 'Reply with one word: ready' }] }],
          inferenceConfig: { maxTokens: 5 },
        }),
      );
      console.log(`model access ok: ${modelId}`);
    } catch (err) {
      ok = false;
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`model access FAILED for ${modelId}: ${message}`);
      console.error(
        `  Enable it in the Bedrock console (${config.aws.region}) under Model access, ` +
          'or check the credentials and region in your AWS profile.',
      );
    }
  }
  return ok;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() as string)) {
  const { config } = await loadRepo();
  process.exit((await checkModelAccess(config)) ? 0 : 1);
}
