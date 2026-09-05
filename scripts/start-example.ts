import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * npm run sample:start [-- --list]
 *
 * Starts one of the example MCP servers. Which one comes from EXAMPLE, defaulting to the one
 * named below. Examples are discovered, not listed here: a directory under examples/ with a
 * src/server.ts is runnable, so adding one is a directory, not an edit to this script.
 *
 *   npm run sample:start                    the default example
 *   EXAMPLE=hotels-weather npm run sample:start     any other, by its short name
 *   PORT=4000 npm run sample:start          any example, on another port
 */

const DEFAULT_EXAMPLE = 'national-parks';
const SUFFIX = '-mcp-server';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'examples');

interface Example {
  /** Short name used in EXAMPLE, e.g. "national-parks". */
  name: string;
  dir: string;
}

function discover(): Example[] {
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name.replace(new RegExp(`${SUFFIX}$`), ''), dir: entry.name }))
    .filter((example) => existsSync(join(examplesDir, example.dir, 'src', 'server.ts')))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const examples = discover();
const wanted = process.env.EXAMPLE ?? DEFAULT_EXAMPLE;

if (process.argv.includes('--list')) {
  console.log('Example MCP servers (EXAMPLE=<name> npm run sample:start):\n');
  for (const example of examples) {
    console.log(`  ${example.name}${example.name === DEFAULT_EXAMPLE ? '   (default)' : ''}`);
  }
  process.exit(0);
}

const example = examples.find((e) => e.name === wanted);
if (!example) {
  console.error(
    `No example named "${wanted}". Available: ${examples.map((e) => e.name).join(', ')}.\n` +
      'Set EXAMPLE to one of those, or run with --list.',
  );
  process.exit(1);
}

const entry = join(examplesDir, example.dir, 'dist', 'server.js');
if (!existsSync(entry)) {
  console.error(`${example.name} is not built. Run: npm run build`);
  process.exit(1);
}

process.exit(spawnSync('node', [entry], { stdio: 'inherit' }).status ?? 1);
