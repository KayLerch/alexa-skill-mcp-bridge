import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';

/**
 * S5: does the stable aws-bedrockagentcore module expose what the stack needs?
 * Runtime with explicit lifecycleConfiguration, Memory with long-term strategies,
 * Gateway with NoAuth and an MCP server target. Synth only, no AWS calls.
 */
const app = new cdk.App();
const stack = new cdk.Stack(app, 'SpikeGatewaySynth', {
  env: { account: '123456789012', region: 'us-east-1' },
});

const runtime = new agentcore.Runtime(stack, 'Runtime', {
  runtimeName: 'spike_runtime',
  agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromImageUri(
    '123456789012.dkr.ecr.us-east-1.amazonaws.com/spike:latest',
  ),
  protocolConfiguration: agentcore.ProtocolType.HTTP,
  lifecycleConfiguration: {
    idleRuntimeSessionTimeout: cdk.Duration.minutes(20),
    maxLifetime: cdk.Duration.hours(8),
  },
  environmentVariables: { BRIDGE_CONFIG: '{}' },
});

const memory = new agentcore.Memory(stack, 'Memory', {
  memoryName: 'spike_memory',
  expirationDuration: cdk.Duration.days(30),
  memoryStrategies: [
    agentcore.MemoryStrategy.usingBuiltInUserPreference(),
    agentcore.MemoryStrategy.usingBuiltInSummarization(),
  ],
});
memory.grantWrite(runtime);
memory.grantRead(runtime);

const gateway = new agentcore.Gateway(stack, 'Gateway', {
  gatewayName: 'spike-gateway',
  authorizerConfiguration: new agentcore.NoAuthAuthorizer(),
  protocolConfiguration: agentcore.GatewayProtocol.mcp({
    supportedVersions: [agentcore.MCPProtocolVersion.of('2025-11-25')],
  }),
});
gateway.addMcpServerTarget('SampleServer', {
  gatewayTargetName: 'sample-server',
  endpoint: 'https://example.com/mcp',
  credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
});

new cdk.CfnOutput(stack, 'RuntimeArn', { value: runtime.agentRuntimeArn });
new cdk.CfnOutput(stack, 'MemoryId', { value: memory.memoryId });
new cdk.CfnOutput(stack, 'GatewayUrl', { value: gateway.gatewayUrl ?? 'n/a' });
