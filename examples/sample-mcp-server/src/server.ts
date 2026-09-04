import { startSampleServer } from './app.js';

/** Bin entry: `npm run sample:start`. Options come from the environment. */
await startSampleServer({
  port: Number(process.env.PORT ?? 3000),
  bearerToken: process.env.MCP_BEARER_TOKEN,
  slowSeconds: Number(process.env.SAMPLE_SLOW_SECONDS ?? 0),
});
