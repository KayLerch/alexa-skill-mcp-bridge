import { createConsoleLog, jsonLog } from '@alexa-mcp-bridge/mcp-server-harness';
import { DEFAULT_PORT, startHotelsWeatherServer } from './app.js';

/** Bin entry: `npm run sample:start`. Options come from the environment. */
try {
  await startHotelsWeatherServer({
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    bearerToken: process.env.MCP_BEARER_TOKEN,
    slowSeconds: Number(process.env.SAMPLE_SLOW_SECONDS ?? 0),
    // SAMPLE_LOG=json prints the raw events instead, for piping into jq.
    log: process.env.SAMPLE_LOG === 'json' ? jsonLog : createConsoleLog(),
  });
} catch (err) {
  console.error(
    `\nsample server could not start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
