import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageProfileSkillPackage } from './skill-package.ts';

/** The profile's Alexa Skill listing over the repo's, for one `ask deploy` (D62). */
const ARN = 'arn:aws:lambda:us-east-1:000000000000:function:test';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'bridge-repo-'));
  mkdirSync(join(root, 'skill-package'));
  const base = {
    manifest: {
      publishingInformation: {
        locales: { 'en-US': { name: 'bridge demo', summary: 'Demo.', keywords: ['mcp'] } },
        category: 'ORGANIZERS_AND_ASSISTANTS',
      },
      apis: { custom: { endpoint: { uri: ARN }, interfaces: [] } },
    },
  };
  const text = JSON.stringify(base, null, 2) + '\n';
  writeFileSync(join(root, 'skill-package', 'skill.json'), text);
  return { root, text };
}

function profile(overlay?: unknown, icons = true) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-profile-'));
  mkdirSync(join(dir, 'skill-package', 'assets', 'images'), { recursive: true });
  if (icons) {
    writeFileSync(join(dir, 'skill-package', 'assets', 'images', 'en-US_smallIconUri.png'), 'png');
  }
  if (overlay !== undefined) {
    writeFileSync(join(dir, 'skill-package', 'skill.json'), JSON.stringify(overlay));
  }
  return dir;
}

const overlay = {
  manifest: {
    publishingInformation: {
      locales: {
        'en-US': {
          name: 'Park Guide',
          keywords: ['parks', 'hiking'],
          smallIconUri: 'file://assets/images/en-US_smallIconUri.png',
        },
      },
      category: 'TRAVEL_AND_TRANSPORTATION',
    },
    apis: { custom: { endpoint: { uri: 'arn:aws:lambda:us-east-1:000000000000:function:other' } } },
  },
};

describe('stageProfileSkillPackage (D62)', () => {
  it('merges the overlay, copies the assets, keeps the endpoint, then restores the repo', () => {
    const { root, text } = repo();
    const staged = stageProfileSkillPackage(root, profile(overlay), ARN);
    const merged = JSON.parse(readFileSync(join(root, 'skill-package', 'skill.json'), 'utf8'));
    const locale = merged.manifest.publishingInformation.locales['en-US'];
    expect(locale).toMatchObject({ name: 'Park Guide', summary: 'Demo.' });
    expect(locale.keywords).toEqual(['parks', 'hiking']);
    expect(merged.manifest.publishingInformation.category).toBe('TRAVEL_AND_TRANSPORTATION');
    expect(merged.manifest.apis.custom.endpoint.uri).toBe(ARN);
    const icon = join(root, 'skill-package', 'assets', 'images', 'en-US_smallIconUri.png');
    expect(existsSync(icon)).toBe(true);

    staged?.restore();
    expect(readFileSync(join(root, 'skill-package', 'skill.json'), 'utf8')).toBe(text);
    expect(existsSync(join(root, 'skill-package', 'assets'))).toBe(false);
  });

  it('refuses an icon the assets folder does not have, and leaves the repo as it was', () => {
    const { root, text } = repo();
    expect(() => stageProfileSkillPackage(root, profile(overlay, false), ARN)).toThrow(
      /assets\/images\/en-US_smallIconUri\.png/,
    );
    expect(readFileSync(join(root, 'skill-package', 'skill.json'), 'utf8')).toBe(text);
  });

  it('does nothing without a skill-package folder in the profile', () => {
    const { root } = repo();
    expect(stageProfileSkillPackage(root, mkdtempSync(join(tmpdir(), 'empty-')), ARN)).toBe(
      undefined,
    );
  });
});
