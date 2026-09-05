import { dirname } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { findConfigFile, loadConfigFile } from '@alexa-mcp-bridge/core';
import { AlexaMcpBridgeStack } from '../lib/alexa-mcp-bridge-stack.js';

/** CDK entry. Reads bridge.config.ts from the repo root; region comes from config. */
const configPath = findConfigFile();
if (!configPath) throw new Error('bridge.config.ts not found; run from inside the repo');
const config = await loadConfigFile(configPath);

const app = new cdk.App();
new AlexaMcpBridgeStack(app, 'AlexaMcpBridgeStack', {
  config,
  repoRoot: dirname(configPath),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.aws.region,
  },
  description: 'Alexa Skill to MCP server bridge: Alexa Skill Lambda, AgentCore runtime, memory',
});
