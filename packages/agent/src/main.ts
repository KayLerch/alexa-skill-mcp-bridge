import { createLogger, loadConfigFromEnv } from '@alexa-mcp-bridge/core';
import { createModel } from './agent/model.js';
import { createMemoryAdapter } from './memory/index.js';
import { createAgentServer } from './server.js';

/** Container entry point. Config arrives as BRIDGE_CONFIG (plan D2). */
const logger = createLogger({ service: 'agent' });
const config = loadConfigFromEnv();
const server = createAgentServer({
  config,
  model: createModel(config),
  memory: createMemoryAdapter(config, process.env, logger),
  logger,
  port: Number(process.env.PORT ?? 8080),
  ...(process.env.MCP_GATEWAY_URL ? { gatewayUrl: process.env.MCP_GATEWAY_URL } : {}),
});

await server.start();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.stop().finally(() => process.exit(0));
  });
}
