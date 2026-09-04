import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Generated JSON: `_generated` first, two-space indent, trailing newline. Data only, never code. */
export function writeGeneratedJson(path: string, data: Record<string, unknown>): void {
  const { _generated, ...rest } = data;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ _generated, ...rest }, null, 2) + '\n');
}
