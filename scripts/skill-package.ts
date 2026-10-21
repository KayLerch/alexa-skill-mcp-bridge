import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { deepMerge } from '@alexa-mcp-bridge/core';

/**
 * A profile's own Alexa Skill listing (D62): `<profile>/skill-package/skill.json` is deep-merged
 * over the repo's `skill-package/skill.json` (objects merge, arrays replace) and
 * `<profile>/skill-package/assets/` is copied into `skill-package/assets/`, for one `ask deploy`.
 * The ASK CLI zips the whole skill-package folder, so an icon given as
 * `file://assets/images/<name>.png` travels with it. Afterwards `restore()` puts the repo's files
 * back exactly as they were, so nothing of the profile can be committed by accident.
 */
export const PROFILE_SKILL_PACKAGE = 'skill-package';

export interface StagedSkillPackage {
  /** What was applied, for the console. */
  notes: string[];
  restore(): void;
}

export function stageProfileSkillPackage(
  root: string,
  profileDir: string,
  lambdaArn: string,
): StagedSkillPackage | undefined {
  const source = join(profileDir, PROFILE_SKILL_PACKAGE);
  if (!existsSync(source)) return undefined;
  const target = join(root, 'skill-package');
  const skillJson = join(target, 'skill.json');
  const original = readFileSync(skillJson, 'utf8');
  const notes: string[] = [];
  const created: string[] = [];
  const replaced = new Map<string, Buffer>();
  const madeDirs: string[] = [];

  const restore = () => {
    writeFileSync(skillJson, original);
    for (const file of created) rmSync(file, { force: true });
    for (const [file, content] of replaced) writeFileSync(file, content);
    for (const dir of madeDirs.reverse()) {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
    }
  };

  try {
    const assets = join(source, 'assets');
    if (existsSync(assets)) {
      for (const file of filesUnder(assets)) {
        const to = join(target, 'assets', relative(assets, file));
        for (const dir of missingDirs(dirname(to))) {
          mkdirSync(dir);
          madeDirs.push(dir);
        }
        if (existsSync(to)) replaced.set(to, readFileSync(to));
        else created.push(to);
        copyFileSync(file, to);
      }
      notes.push(`${created.length + replaced.size} asset file(s) from ${assets}`);
    }

    const overlayFile = join(source, 'skill.json');
    if (existsSync(overlayFile)) {
      let overlay: unknown;
      try {
        overlay = JSON.parse(readFileSync(overlayFile, 'utf8'));
      } catch {
        throw new Error(`${overlayFile} is not valid JSON.`);
      }
      if (!isRecord(overlay) || !isRecord(overlay.manifest)) {
        throw new Error(`${overlayFile} must be an object with a "manifest" key, like skill.json.`);
      }
      const merged = deepMerge(JSON.parse(original), overlay) as SkillJson;
      // The endpoint is always this deploy's Lambda, whatever the overlay says.
      merged.manifest.apis.custom.endpoint = { uri: lambdaArn };
      const missing = fileUris(merged).filter((uri) => !existsSync(join(target, uri)));
      if (missing.length) {
        throw new Error(
          `${overlayFile} names files that are not in ${assets}: ${missing.join(', ')}`,
        );
      }
      writeFileSync(skillJson, JSON.stringify(merged, null, 2) + '\n');
      notes.push(`skill.json overlay from ${overlayFile}`);
    }
  } catch (err) {
    restore();
    throw err;
  }
  return { notes, restore };
}

interface SkillJson {
  manifest: { apis: { custom: { endpoint?: { uri?: string } } } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every `file://` path in the manifest, relative to the skill-package folder. */
export function fileUris(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.startsWith('file://') ? [value.slice('file://'.length)] : [];
  }
  if (Array.isArray(value)) return value.flatMap(fileUris);
  if (isRecord(value)) return Object.values(value).flatMap(fileUris);
  return [];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The directories that must be created for `dir` to exist, outermost first. */
function missingDirs(dir: string): string[] {
  const missing: string[] = [];
  let current = dir;
  while (!existsSync(current)) {
    missing.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}
