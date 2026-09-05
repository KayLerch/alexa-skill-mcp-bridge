import { createConsoleLog, jsonLog } from '@alexa-mcp-bridge/mcp-server-harness';
import { DEFAULT_PORT, startParksServer } from './app.js';

/** Bin entry. Options come from the environment; see the README. */
try {
  await startParksServer({
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    bearerToken: process.env.MCP_BEARER_TOKEN,
    // SAMPLE_LOG=json prints the raw events instead, for piping into jq.
    log: process.env.SAMPLE_LOG === 'json' ? jsonLog : createConsoleLog(),
  });
} catch (err) {
  console.error(
    `\nnational parks server could not start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
