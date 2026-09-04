import { BedrockModel, type Model } from '@strands-agents/sdk';
import type { BridgeConfig } from '@alexa-mcp-bridge/core';

/**
 * The model behind the agent. Nova 2 takes its reasoning effort through
 * additionalModelRequestFields.reasoningConfig; 'off' sends nothing, which measured fastest.
 * Tests inject a scripted model instead (plan D10).
 */
export function createModel(config: BridgeConfig): Model {
  const { modelId, reasoningEffort, maxTokens } = config.agent;
  const isNova = /amazon\.nova/.test(modelId);
  const additionalRequestFields =
    isNova && reasoningEffort !== 'off'
      ? { reasoningConfig: { type: 'enabled', maxReasoningEffort: reasoningEffort } }
      : undefined;

  return new BedrockModel({
    modelId,
    region: config.aws.region,
    maxTokens,
    ...(additionalRequestFields ? { additionalRequestFields } : {}),
  });
}
