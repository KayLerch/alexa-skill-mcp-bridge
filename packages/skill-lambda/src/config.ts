import { createLogger, loadConfigFromEnv, toolManifestSchema } from '@alexa-mcp-bridge/core';
import manifestJson from '../generated/tool-manifest.json' with { type: 'json' };

/**
 * Loaded once per container: config from BRIDGE_CONFIG (plan D2), the manifest from the
 * generated file (bundled into the Lambda at build time, validated here).
 */
export const config = loadConfigFromEnv();
export const logger = createLogger(
  { service: 'skill' },
  { level: config.features.debug ? 'debug' : 'info' },
);
export const runtimeArn = process.env.AGENT_RUNTIME_ARN ?? '';
export const manifest = toolManifestSchema.parse(manifestJson);
