import { join } from 'node:path';
import { serializeConfig } from '@alexa-mcp-bridge/core';
import { loadRepo, run } from './lib.ts';

/**
 * npm run agent:dev: build the arm64 image and run it on :8080 with BRIDGE_CONFIG from
 * bridge.config.ts. AWS credentials come from the environment (export them first, e.g. with
 * `aws configure export-credentials --format env`). Docker or Finch (CONTAINER_CLI=finch).
 */
const { root, config } = await loadRepo();
const cli = process.env.CONTAINER_CLI ?? 'docker';
const image = 'alexa-mcp-bridge-agent';

// Inside the container, localhost is the container. Point a local sample server at the host.
const url = new URL(config.mcp.url);
if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
  url.hostname = 'host.docker.internal';
  console.log(`mcp.url rewritten for the container: ${url.href}`);
}
const containerConfig = serializeConfig({ ...config, mcp: { ...config.mcp, url: url.href } });

const build = run(
  cli,
  [
    'build',
    '--platform',
    'linux/arm64',
    '-f',
    join('packages', 'agent', 'Dockerfile'),
    '-t',
    image,
    '.',
  ],
  root,
);
if (build !== 0) process.exit(build);

console.log(`
Container up on http://localhost:8080. Try:
  curl -s localhost:8080/ping
  curl -s -X POST localhost:8080/invocations -H 'content-type: application/json' -d '{"turn":{"type":"warmup"},"actorId":"dev","sessionId":"dev","locale":"en-US","budgetMs":6500}'
  curl -s -X POST localhost:8080/invocations -H 'content-type: application/json' -d '{"turn":{"type":"turn","utterance":{"text":"what is the weather in Hamburg"}},"actorId":"dev","sessionId":"dev","locale":"en-US","budgetMs":6500}'
Ctrl-C stops it.
`);
const envFlags = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'MCP_SECRET_VALUE',
]
  .filter((k) => process.env[k])
  .flatMap((k) => ['-e', k]);
process.exit(
  run(
    cli,
    [
      'run',
      '--rm',
      '-p',
      '8080:8080',
      '-e',
      `BRIDGE_CONFIG=${containerConfig}`,
      '-e',
      'LOG_LEVEL=debug',
      ...envFlags,
      image,
    ],
    root,
  ),
);
