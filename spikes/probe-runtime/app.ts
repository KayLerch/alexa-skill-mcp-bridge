import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * S2 stack: one AgentCore Runtime from the probe container. Idle timeout comes from
 * PROBE_IDLE_SECONDS so sequence 6 (session reuse after reclaim) can use the minimum.
 */
const idleSeconds = Number(process.env.PROBE_IDLE_SECONDS ?? 600);

const app = new cdk.App();
const stack = new cdk.Stack(app, 'AlexaMcpBridgeProbe', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});

const runtime = new agentcore.Runtime(stack, 'ProbeRuntime', {
  runtimeName: 'alexa_mcp_bridge_probe',
  agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset('./container', {
    platform: Platform.LINUX_ARM64,
  }),
  protocolConfiguration: agentcore.ProtocolType.HTTP,
  lifecycleConfiguration: {
    idleRuntimeSessionTimeout: cdk.Duration.seconds(idleSeconds),
    maxLifetime: cdk.Duration.hours(1),
  },
  environmentVariables: { PROBE: '1' },
});

new logs.LogGroup(stack, 'ProbeLogs', {
  logGroupName: `/aws/bedrock-agentcore/runtimes/${runtime.agentRuntimeId}-DEFAULT`,
  retention: logs.RetentionDays.THREE_DAYS,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

new cdk.CfnOutput(stack, 'RuntimeArn', { value: runtime.agentRuntimeArn });
new cdk.CfnOutput(stack, 'IdleSeconds', { value: String(idleSeconds) });
