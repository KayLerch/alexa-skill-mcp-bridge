import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';

/**
 * npm run check:leaks [-- --all]
 *
 * Stops the things a public fork of this repo leaks by accident: your AWS account id, your
 * Alexa Skill id, your MCP endpoint, a token pasted into a URL. Default scope is what is staged
 * for the next commit, which is what the pre-commit hook uses; `--all` scans tracked files.
 *
 * The fix is always the same: the value belongs in .env (git-ignored), not in a tracked file.
 */

const { values } = parseArgs({
  options: { all: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
});
if (values.help) {
  console.log('npm run check:leaks [-- --all]   (default: staged files only)');
  process.exit(0);
}

interface Rule {
  name: string;
  pattern: RegExp;
  fix: string;
  /** Files where this value is expected and harmless. */
  allow?: (file: string) => boolean;
}

/** Placeholders the repo ships on purpose; they are the shape of the value, not a value. */
const PLACEHOLDERS = [
  '000000000000',
  '123456789012',
  '11111111-2222-3333-4444-555555555555',
  '00000000-0000-0000-0000-000000000000',
];
const isPlaceholder = (hit: string) => PLACEHOLDERS.some((p) => hit.includes(p));

const RULES: Rule[] = [
  {
    name: 'AWS account id',
    pattern: /arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:(\d{12}):/g,
    fix: 'keep real ARNs out of tracked files: npm run skill:deploy writes yours into skill-package/skill.json locally, do not commit it',
  },
  {
    name: 'Alexa Skill id',
    pattern: /amzn1\.ask\.skill\.[0-9a-f]{8}-[0-9a-f-]+/g,
    fix: 'put it in .env as BRIDGE_SKILL_ID instead',
  },
  {
    name: 'MCP endpoint',
    // Any http(s) host that is not localhost or a documentation example.
    pattern: /https?:\/\/(?!localhost|127\.0\.0\.1|host\.docker\.internal|<)[^\s'"`)]+/g,
    fix: 'put your endpoint in .env as BRIDGE_MCP_URL instead',
    allow: (file) => ENDPOINT_FILES.includes(file),
  },
  {
    name: 'credentials in a URL',
    pattern: /https?:\/\/[^\s'"`/]*:[^\s'"`/]*@/g,
    fix: 'use mcp.auth with a Secrets Manager secret name, never credentials in the URL',
  },
  {
    name: 'tunnel URL',
    pattern: /[a-z0-9-]+\.(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io|dev))/g,
    fix: 'put your tunnel URL in .env as BRIDGE_MCP_URL instead',
    allow: () => true,
  },
];

/** Endpoint hosts are only a leak in the files a developer edits or regenerates. */
const ENDPOINT_FILES = [
  'bridge.config.ts',
  'packages/skill-lambda/generated/tool-manifest.json',
  'skill-package/skill.json',
  'skill-package/interactionModels/custom/en-US.json',
];

/** Documentation hosts that appear all over the repo on purpose. */
const DOC_HOSTS =
  /(example\.com|example\.org|amazonaws\.com|amazon\.com|aws\.amazon\.com|github\.com|nodejs\.org|modelcontextprotocol\.io|anthropic\.com|npmjs\.com|cloudflare\.com|developer\.amazon\.com|apache\.org|claude\.com|json-schema\.org)/;

/** `--all` means everything a `git add -A` would commit: tracked files plus untracked, unignored ones. */
function filesToScan(): string[] {
  const listings = values.all
    ? [['ls-files'], ['ls-files', '--others', '--exclude-standard']]
    : [['diff', '--cached', '--name-only', '--diff-filter=ACM']];
  const files: string[] = [];
  for (const args of listings) {
    const out = spawnSync('git', args, { encoding: 'utf8' });
    if (out.status !== 0) {
      console.error('check:leaks needs a git repository.');
      process.exit(1);
    }
    files.push(...out.stdout.split('\n'));
  }
  return [...new Set(files)]
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => existsSync(file) && statSync(file).isFile())
    .filter((file) => !file.startsWith('spikes/') && file !== 'scripts/check-leaks.ts');
}

interface Finding {
  file: string;
  line: number;
  rule: Rule;
  hit: string;
}

function scan(file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const rule of RULES) {
    if (rule.allow && !rule.allow(file)) continue;
    lines.forEach((text, index) => {
      for (const match of text.matchAll(rule.pattern)) {
        const hit = match[0];
        if (isPlaceholder(hit) || DOC_HOSTS.test(hit)) continue;
        findings.push({ file, line: index + 1, rule, hit });
      }
    });
  }
  return findings;
}

const findings = filesToScan().flatMap(scan);

if (findings.length === 0) {
  console.log(`No leaks in ${values.all ? 'tracked or untracked' : 'staged'} files.`);
  process.exit(0);
}

console.error(
  `\nWait: ${findings.length} value${findings.length === 1 ? '' : 's'} that should not be in a public repo.\n`,
);
for (const { file, line, rule, hit } of findings) {
  console.error(`  ${file}:${line}  ${rule.name}: ${clip(hit)}`);
  console.error(`      → ${rule.fix}`);
}
console.error(
  '\nUnstage the file, move the value to .env, and commit again.' +
    '\nIf this is a placeholder or an example, commit with --no-verify.\n',
);
process.exit(1);

function clip(text: string): string {
  return text.length > 70 ? text.slice(0, 69) + '…' : text;
}
