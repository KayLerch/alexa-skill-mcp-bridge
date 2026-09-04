import { DEFAULT_PORT, startSampleServer } from './app.js';

/** Bin entry: `npm run sample:start`. Options come from the environment. */
try {
  await startSampleServer({
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    bearerToken: process.env.MCP_BEARER_TOKEN,
    slowSeconds: Number(process.env.SAMPLE_SLOW_SECONDS ?? 0),
  });
} catch (err) {
  console.error(
    `\nsample server could not start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
