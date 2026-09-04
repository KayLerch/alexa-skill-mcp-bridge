import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

// Tests resolve workspace packages from source so `npm test` needs no build step.
export default defineConfig({
  resolve: {
    alias: {
      '@alexa-mcp-bridge/core': src('core'),
      '@alexa-mcp-bridge/agent': src('agent'),
      '@alexa-mcp-bridge/sample-mcp-server': fileURLToPath(
        new URL('./examples/sample-mcp-server/src/app.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'infra/**/*.test.ts', 'examples/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
