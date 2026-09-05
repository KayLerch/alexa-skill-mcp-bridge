import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { parseConfig } from '@alexa-mcp-bridge/core';
import { fileURLToPath } from 'node:url';
import { AlexaMcpBridgeStack } from '../lib/alexa-mcp-bridge-stack.js';
import { modelResourceArns } from '../lib/model-arns.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function synth(overrides: Record<string, unknown> = {}) {
  const app = new cdk.App();
  const stack = new AlexaMcpBridgeStack(app, 'Test', {
    config: parseConfig({ mcp: { url: 'https://example.com/mcp' }, ...overrides }),
    repoRoot,
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return { stack, template: Template.fromStack(stack) };
}

describe('AlexaMcpBridgeStack', () => {
  it('sets the runtime lifecycle explicitly from config', () => {
    const { template } = synth({ runtime: { idleTimeoutMinutes: 20, maxLifetimeHours: 8 } });
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: { IdleRuntimeSessionTimeout: 1200, MaxLifetime: 28800 },
      ProtocolConfiguration: 'HTTP',
    });
  });

  it('gives the Lambda 8 s, arm64, and the Alexa trigger permission', () => {
    const { template } = synth({
      skill: { id: 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555' },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 8,
      Architectures: ['arm64'],
      Runtime: 'nodejs22.x',
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'alexa-appkit.amazon.com',
      EventSourceToken: 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555',
    });
  });

  it('warns when the skill id is unset and leaves the permission open', () => {
    const { stack, template } = synth();
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'alexa-appkit.amazon.com',
    });
    const permissions = Object.values(template.findResources('AWS::Lambda::Permission'));
    expect(permissions.some((p) => 'EventSourceToken' in (p.Properties as object))).toBe(false);
    const warnings = stack.node
      .findAll()
      .flatMap((c) => c.node.metadata.filter((m) => m.type === 'aws:cdk:warning'));
    expect(warnings.some((w) => String(w.data).includes('skill.id'))).toBe(true);
  });

  it('creates memory with long-term strategies only when enabled', () => {
    synth({ memory: { longTerm: true } }).template.hasResourceProperties(
      'AWS::BedrockAgentCore::Memory',
      {
        MemoryStrategies: [{ UserPreferenceMemoryStrategy: {} }, { SummaryMemoryStrategy: {} }].map(
          () => ({}),
        ),
      },
    );
    const off = synth({ memory: { longTerm: false } }).template;
    const memories = Object.values(off.findResources('AWS::BedrockAgentCore::Memory'));
    expect(
      (memories[0]?.Properties as { MemoryStrategies?: unknown[] }).MemoryStrategies ?? [],
    ).toEqual([]);
  });

  it('creates the gateway only when the feature is on', () => {
    synth().template.resourceCountIs('AWS::BedrockAgentCore::Gateway', 0);
    const on = synth({ features: { gateway: true } }).template;
    on.resourceCountIs('AWS::BedrockAgentCore::Gateway', 1);
    on.hasResourceProperties('AWS::BedrockAgentCore::GatewayTarget', {
      TargetConfiguration: { Mcp: { McpServer: { Endpoint: 'https://example.com/mcp' } } },
    });
    on.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
      ProtocolConfiguration: { Mcp: { StreamingConfiguration: { EnableResponseStreaming: true } } },
    });
  });

  it('sets log retention on every log group and creates no cost alarm', () => {
    const { template } = synth({ aws: { logRetentionDays: 7 } });
    for (const group of Object.values(template.findResources('AWS::Logs::LogGroup'))) {
      expect((group.Properties as { RetentionInDays?: number }).RetentionInDays).toBe(7);
    }
    expect(Object.keys(template.findResources('AWS::Budgets::Budget'))).toHaveLength(0);
  });

  it('grants the runtime the model, memory, and secret it needs', () => {
    const { template } = synth({
      mcp: { url: 'https://example.com/mcp', auth: { type: 'bearer', secretName: 'bridge/token' } },
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('inference-profile/us.amazon.nova-2-lite-v1:0');
    expect(policies).toContain('foundation-model/amazon.nova-2-lite-v1:0');
    expect(policies).toContain('secret:bridge/token-*');
    expect(policies).toContain('bedrock-agentcore:CreateEvent');
    expect(policies).toContain('bedrock-agentcore:InvokeAgentRuntime');
  });
});

describe('modelResourceArns', () => {
  it('expands cross-region profiles to the profile plus the foundation model everywhere', () => {
    expect(modelResourceArns(['us.amazon.nova-2-lite-v1:0'], 'us-east-1', '123')).toEqual([
      'arn:aws:bedrock:us-east-1:123:inference-profile/us.amazon.nova-2-lite-v1:0',
      'arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0',
    ]);
    expect(modelResourceArns(['amazon.nova-2-lite-v1:0'], 'us-east-1', '123')).toEqual([
      'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-2-lite-v1:0',
    ]);
  });
});
