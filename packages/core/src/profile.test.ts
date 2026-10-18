import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFile } from './config.js';

// A repo root with a minimal bridge.config.ts, and a profile folder beside it.
let root: string;
let profile: string;
const saved = { ...process.env };

const write = (file: string, text: string) => writeFileSync(file, text);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bridge-root-'));
  profile = mkdtempSync(join(tmpdir(), 'bridge-profile-'));
  write(
    join(root, 'bridge.config.ts'),
    "export default { mcp: { url: 'http://localhost:3939/mcp' } };\n",
  );
  for (const key of ['BRIDGE_PROFILE_DIR', 'BRIDGE_MCP_URL', 'BRIDGE_MCP_AUTH_TYPE']) {
    delete process.env[key];
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe('BRIDGE_PROFILE_DIR (D56)', () => {
  it('changes nothing when unset', async () => {
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.mcp.url).toBe('http://localhost:3939/mcp');
    expect(config.agent.promptAddendum).toBeUndefined();
  });

  it('reads the profile .env and the prompt addendum', async () => {
    write(join(profile, '.env'), 'BRIDGE_MCP_URL=https://quiz.example.com/mcp\n');
    write(join(profile, 'prompt-addendum.md'), '\nAsk one quiz question at a time.\n');
    process.env.BRIDGE_PROFILE_DIR = profile;
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.mcp.url).toBe('https://quiz.example.com/mcp');
    expect(config.agent.promptAddendum).toBe('Ask one quiz question at a time.');
  });

  it('lets the profile beat the repo .env, and a real variable beat both', async () => {
    write(join(root, '.env'), 'BRIDGE_MCP_URL=https://repo.example.com/mcp\nBRIDGE_SKILL_ID=\n');
    write(join(profile, '.env'), 'BRIDGE_MCP_URL=https://profile.example.com/mcp\n');
    process.env.BRIDGE_PROFILE_DIR = profile;
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.mcp.url).toBe('https://profile.example.com/mcp');

    process.env.BRIDGE_MCP_URL = 'https://real.example.com/mcp';
    const again = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(again.mcp.url).toBe('https://real.example.com/mcp');
  });

  it('resolves a relative path against the repo root', async () => {
    mkdirSync(join(root, 'mine'));
    write(join(root, 'mine', 'prompt-addendum.md'), 'Be brief.');
    process.env.BRIDGE_PROFILE_DIR = 'mine';
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.agent.promptAddendum).toBe('Be brief.');
  });

  it('is a clear config error when the directory is missing', async () => {
    process.env.BRIDGE_PROFILE_DIR = join(root, 'nope');
    await expect(loadConfigFile(join(root, 'bridge.config.ts'))).rejects.toThrowError(ConfigError);
    await expect(loadConfigFile(join(root, 'bridge.config.ts'))).rejects.toThrowError(
      /BRIDGE_PROFILE_DIR points to .*nope, which is not a directory/,
    );
  });

  it('accepts a profile with no files in it', async () => {
    process.env.BRIDGE_PROFILE_DIR = profile;
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.mcp.url).toBe('http://localhost:3939/mcp');
  });

  it('cannot be chained: the profile .env never sets BRIDGE_PROFILE_DIR', async () => {
    const other = mkdtempSync(join(tmpdir(), 'bridge-other-'));
    write(join(other, 'prompt-addendum.md'), 'Should not load.');
    write(join(profile, '.env'), `BRIDGE_PROFILE_DIR=${other}\n`);
    process.env.BRIDGE_PROFILE_DIR = profile;
    const config = await loadConfigFile(join(root, 'bridge.config.ts'));
    expect(config.agent.promptAddendum).toBeUndefined();
    expect(process.env.BRIDGE_PROFILE_DIR).toBe(profile);
    rmSync(other, { recursive: true, force: true });
  });

  it('refuses an addendum too long for BRIDGE_CONFIG', async () => {
    write(join(profile, 'prompt-addendum.md'), 'x'.repeat(2001));
    process.env.BRIDGE_PROFILE_DIR = profile;
    await expect(loadConfigFile(join(root, 'bridge.config.ts'))).rejects.toThrowError(
      /agent\.promptAddendum/,
    );
  });
});
