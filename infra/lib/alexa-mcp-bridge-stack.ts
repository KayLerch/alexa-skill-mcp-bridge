import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import {
  ALEXA_PLUS_PROTOCOL_VERSION,
  serializeConfig,
  type BridgeConfig,
} from '@alexa-mcp-bridge/core';
import type { Construct } from 'constructs';
import { modelResourceArns } from './model-arns.js';

export interface AlexaMcpBridgeStackProps extends cdk.StackProps {
  config: BridgeConfig;
  /** Repo root: Docker build context and the Lambda entry live under it. */
  repoRoot: string;
}

/**
 * One stack, read from bridge.config.ts. Nothing here runs always-on: the runtime bills
 * while a session is active, memory and logs by volume, the Lambda per request. There is
 * no cost alarm; see docs/cost.md for what to watch and `npm run destroy` to stop it all.
 */
export class AlexaMcpBridgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AlexaMcpBridgeStackProps) {
    super(scope, id, props);
    const { config, repoRoot } = props;
    const configJson = serializeConfig(config);
    const retention = retentionFor(config.aws.logRetentionDays);

    // Memory: short-term events always; long-term extraction strategies when memory.longTerm.
    const memory = new agentcore.Memory(this, 'Memory', {
      memoryName: 'alexa_mcp_bridge',
      description: 'Conversation memory for the Alexa MCP bridge',
      expirationDuration: cdk.Duration.days(30),
      // Namespaces are what the agent reads back (packages/agent/src/memory/agentcore-memory.ts).
      memoryStrategies: config.memory.longTerm
        ? [
            agentcore.MemoryStrategy.usingUserPreference({
              strategyName: 'preferences',
              namespaces: ['/users/{actorId}/preferences'],
            }),
            agentcore.MemoryStrategy.usingSummarization({
              strategyName: 'summaries',
              namespaces: ['/users/{actorId}/sessions/{sessionId}'],
            }),
          ]
        : [],
    });

    // Agent runtime from the arm64 image; lifecycle set explicitly (a past CDK default was 60 s idle).
    const runtimeLogs = new logs.LogGroup(this, 'RuntimeLogs', {
      retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const runtimeEnv: Record<string, string> = {
      BRIDGE_CONFIG: configJson,
      MEMORY_ID: memory.memoryId,
      LOG_LEVEL: config.features.debug ? 'debug' : 'info',
    };
    const runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: 'alexa_mcp_bridge',
      description: 'Alexa MCP bridge agent',
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(repoRoot, {
        file: 'packages/agent/Dockerfile',
        platform: Platform.LINUX_ARM64,
      }),
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: cdk.Duration.minutes(config.runtime.idleTimeoutMinutes),
        maxLifetime: cdk.Duration.hours(config.runtime.maxLifetimeHours),
      },
      environmentVariables: runtimeEnv,
      loggingConfigs: [
        {
          logType: agentcore.LogType.APPLICATION_LOGS,
          destination: agentcore.LoggingDestination.cloudWatchLogs(runtimeLogs),
        },
      ],
    });
    memory.grantWrite(runtime);
    memory.grantRead(runtime);
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: modelResourceArns(
          [
            config.agent.modelId,
            ...(config.agent.fallbackModelId ? [config.agent.fallbackModelId] : []),
          ],
          this.region,
          this.account,
        ),
      }),
    );
    if (config.mcp.auth.type !== 'none' && config.mcp.auth.secretName) {
      runtime.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${config.mcp.auth.secretName}-*`,
          ],
        }),
      );
    }

    // Optional Gateway in front of the MCP server (features.gateway). Off by default.
    let gatewayUrl: string | undefined;
    if (config.features.gateway) {
      const gateway = new agentcore.Gateway(this, 'Gateway', {
        gatewayName: 'alexa-mcp-bridge',
        description: 'MCP gateway for the Alexa MCP bridge',
        authorizerConfiguration: new agentcore.IamAuthorizer(),
        // What the Gateway offers the agent, not what the developer's server must speak.
        protocolConfiguration: agentcore.GatewayProtocol.mcp({
          supportedVersions: [agentcore.MCPProtocolVersion.of(ALEXA_PLUS_PROTOCOL_VERSION)],
        }),
      });
      gateway.addMcpServerTarget('McpServer', {
        gatewayTargetName: 'mcp-server',
        endpoint: config.mcp.url,
        credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole()],
      });
      // Response streaming carries elicitation requests; the L2 has no switch for it yet.
      const cfnGateway = gateway.node.defaultChild as cdk.CfnResource;
      cfnGateway.addPropertyOverride(
        'ProtocolConfiguration.Mcp.StreamingConfiguration.EnableResponseStreaming',
        true,
      );
      gateway.grantInvoke(runtime);
      gatewayUrl = gateway.gatewayUrl;
      if (gatewayUrl) runtimeEnv.MCP_GATEWAY_URL = gatewayUrl;
    }

    // Alexa Skill Lambda: thin ASK SDK handlers, bundled from source, arm64, 8 s.
    const skillLogs = new logs.LogGroup(this, 'SkillLogs', {
      retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const skill = new nodejs.NodejsFunction(this, 'SkillLambda', {
      entry: join(repoRoot, 'packages/skill-lambda/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(8),
      memorySize: 512,
      logGroup: skillLogs,
      environment: {
        BRIDGE_CONFIG: configJson,
        AGENT_RUNTIME_ARN: runtime.agentRuntimeArn,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        sourceMap: true,
      },
    });
    runtime.grantInvoke(skill);
    skill.addPermission('AlexaSkillsKit', {
      principal: new iam.ServicePrincipal('alexa-appkit.amazon.com'),
      action: 'lambda:InvokeFunction',
      ...(config.skill.id ? { eventSourceToken: config.skill.id } : {}),
    });
    if (!config.skill.id) {
      cdk.Annotations.of(skill).addWarning(
        'skill.id is not set: any Alexa Skill that knows the function ARN can invoke this Lambda. After `ask deploy`, put the skill id into .env as BRIDGE_SKILL_ID and run `npm run deploy` again.',
      );
    }

    new cdk.CfnOutput(this, 'LambdaArn', {
      value: skill.functionArn,
      description: 'Endpoint for skill.json',
    });
    new cdk.CfnOutput(this, 'RuntimeArn', { value: runtime.agentRuntimeArn });
    new cdk.CfnOutput(this, 'MemoryId', { value: memory.memoryId });
    if (gatewayUrl) new cdk.CfnOutput(this, 'GatewayUrl', { value: gatewayUrl });
  }
}

function retentionFor(days: number): logs.RetentionDays {
  const known = Object.values(logs.RetentionDays).filter((v): v is number => typeof v === 'number');
  return (known.find((d) => d >= days) ?? logs.RetentionDays.ONE_WEEK) as logs.RetentionDays;
}
