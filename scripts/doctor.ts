import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  ConfigError,
  alexaPlusVersionWarning,
  findConfigFile,
  loadConfigFile,
  type BridgeConfig,
} from '@alexa-mcp-bridge/core';
import { ScanError, scanServer } from '@alexa-mcp-bridge/generator';

/**
 * npm run doctor [-- --track local|cloud|skill]
 * Checks what each track needs and says exactly what to do about anything missing.
 * local: Node, dependencies, config, MCP server, AWS credentials, Bedrock model access.
 * cloud: local plus Docker or Finch, CDK bootstrap in the region, and a public MCP URL.
 * skill: cloud plus the ASK CLI, skill.json's endpoint, and skill.id.
 */

type Track = 'local' | 'cloud' | 'skill';
const TRACKS: Track[] = ['local', 'cloud', 'skill'];

const { values } = parseArgs({
  options: {
    track: { type: 'string', default: 'local' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help || !TRACKS.includes(values.track as Track)) {
  console.log(
    'npm run doctor -- --track local|cloud|skill   (each track includes the previous one)',
  );
  process.exit(values.help ? 0 : 1);
}
const track = values.track as Track;
const level = TRACKS.indexOf(track);

interface Result {
  ok: boolean;
  detail: string;
  fix?: string;
}
const results: { name: string; result: Result }[] = [];

async function check(name: string, fn: () => Promise<Result> | Result): Promise<Result> {
  let result: Result;
  try {
    result = await fn();
  } catch (err) {
    result = {
      ok: false,
      detail: err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err),
    };
  }
  results.push({ name, result });
  const mark = result.ok ? 'ok ' : 'FAIL';
  console.log(`${mark}  ${name}: ${result.detail}`);
  if (!result.ok && result.fix) console.log(`      → ${result.fix}`);
  return result;
}

const root = (() => {
  const configPath = findConfigFile();
  return configPath ? join(configPath, '..') : process.cwd();
})();

console.log(`alexa-skill-mcp-bridge doctor, track "${track}"\n`);

// ---- local -----------------------------------------------------------------------------------
await check('Node', () => ({
  ok: true,
  detail: `${process.versions.node} (22.18 or later required; the check-node script already enforced it)`,
}));

await check('Dependencies installed', () => {
  const ok = existsSync(join(root, 'node_modules', '@alexa-mcp-bridge', 'core'));
  return ok
    ? { ok, detail: 'node_modules present with workspace links' }
    : { ok, detail: 'node_modules missing or incomplete', fix: 'run: npm install' };
});

let config: BridgeConfig | undefined;
await check('config (bridge.config.ts + .env)', async () => {
  try {
    config = await loadConfigFile();
    return {
      ok: true,
      detail: `mcp.url = ${config.mcp.url}, model ${config.agent.modelId}, region ${config.aws.region}`,
    };
  } catch (err) {
    if (err instanceof ConfigError)
      return {
        ok: false,
        detail: err.message.replace(/\n\s*/g, ' '),
        fix: 'fix the field named above in bridge.config.ts, or in .env if you set it there',
      };
    throw err;
  }
});

if (config) {
  const cfg = config;
  await check('MCP server', async () => {
    try {
      const scan = await scanServer(cfg);
      const versionWarning = alexaPlusVersionWarning(scan.protocolVersion);
      return {
        ok: true,
        detail:
          `${scan.server.name} at ${cfg.mcp.url}, protocol ${scan.protocolVersion}, tools: ${scan.tools.map((t) => t.name).join(', ')}` +
          (versionWarning ? `\n     warning: ${versionWarning}` : ''),
      };
    } catch (err) {
      if (err instanceof ScanError) {
        const local = /localhost|127\.0\.0\.1/.test(cfg.mcp.url);
        return {
          ok: false,
          detail: err.message,
          fix: local
            ? 'start it in another terminal: npm run sample:start (the bundled sample) or your own server on that port; or change mcp.url'
            : 'check the URL, that the server is up, and mcp.auth',
        };
      }
      throw err;
    }
  });

  let account: string | undefined;
  await check('AWS credentials', async () => {
    const sts = new STSClient({ region: cfg.aws.region });
    try {
      const id = await sts.send(new GetCallerIdentityCommand({}));
      account = id.Account;
      return {
        ok: true,
        detail: `account ${id.Account}, principal ${id.Arn?.split('/').pop() ?? id.Arn}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err),
        fix: 'configure credentials: aws configure (or export AWS_PROFILE / AWS_ACCESS_KEY_ID). The agent calls Bedrock even when it runs locally.',
      };
    }
  });

  await check(`Bedrock model access (${cfg.agent.modelId})`, async () => {
    const client = new BedrockRuntimeClient({ region: cfg.aws.region });
    try {
      await client.send(
        new ConverseCommand({
          modelId: cfg.agent.modelId,
          messages: [{ role: 'user', content: [{ text: 'Reply with one word: ready' }] }],
          inferenceConfig: { maxTokens: 5 },
        }),
      );
      return { ok: true, detail: 'one test call succeeded' };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]}` : String(err),
        fix: `enable the model in the Bedrock console for ${cfg.aws.region}: https://console.aws.amazon.com/bedrock/home?region=${cfg.aws.region}#/modelaccess`,
      };
    }
  });

  // ---- cloud ---------------------------------------------------------------------------------
  if (level >= 1) {
    await check('Container engine', () => {
      const cli = process.env.CONTAINER_CLI ?? 'docker';
      const out = spawnSync(cli, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
      if (out.status === 0 && out.stdout.trim())
        return { ok: true, detail: `${cli} daemon ${out.stdout.trim()}` };
      return {
        ok: false,
        detail: `${cli} not reachable`,
        fix:
          cli === 'docker'
            ? 'install Docker Desktop (https://www.docker.com/products/docker-desktop/) and start it, or set CONTAINER_CLI=finch'
            : 'start finch: finch vm start',
      };
    });

    await check(`CDK bootstrap in ${cfg.aws.region}`, async () => {
      try {
        const cfn = new CloudFormationClient({ region: cfg.aws.region });
        const out = await cfn.send(new DescribeStacksCommand({ StackName: 'CDKToolkit' }));
        const version = out.Stacks?.[0]?.Outputs?.find(
          (o) => o.OutputKey === 'BootstrapVersion',
        )?.OutputValue;
        return {
          ok: true,
          detail: `CDKToolkit stack present (bootstrap version ${version ?? '?'})`,
        };
      } catch {
        return {
          ok: false,
          detail: 'no CDKToolkit stack',
          fix: `npx cdk bootstrap aws://${account ?? '<account-id>'}/${cfg.aws.region}`,
        };
      }
    });

    await check('MCP URL reachable from AWS', () => {
      const local = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(cfg.mcp.url);
      return local
        ? {
            ok: false,
            detail: `${cfg.mcp.url} is a local address; the deployed agent cannot reach it`,
            fix: 'expose the server (e.g. cloudflared tunnel --url http://localhost:3939), put the public https URL into .env as BRIDGE_MCP_URL, then npm run generate',
          }
        : {
            ok: true,
            detail: cfg.mcp.url.startsWith('https://')
              ? 'public https URL'
              : 'public URL (not https; fine for testing)',
          };
    });
  }

  // ---- skill ---------------------------------------------------------------------------------
  if (level >= 2) {
    await check('ASK CLI', () => {
      const version = spawnSync('ask', ['--version'], { encoding: 'utf8' });
      if (version.status !== 0) {
        return {
          ok: false,
          detail: 'ask not found',
          fix: 'npm install -g ask-cli && ask configure',
        };
      }
      const vendors = spawnSync('ask', ['smapi', 'get-vendor-list'], { encoding: 'utf8' });
      if (vendors.status !== 0) {
        return {
          ok: false,
          detail: `ask ${version.stdout.trim()} installed but not logged in`,
          fix: 'ask configure (log in with your Amazon developer account)',
        };
      }
      return { ok: true, detail: `ask ${version.stdout.trim()}, logged in` };
    });

    await check('skill-package/skill.json endpoint', () => {
      const file = join(root, 'skill-package', 'skill.json');
      const uri = (
        JSON.parse(readFileSync(file, 'utf8')) as {
          manifest: { apis: { custom: { endpoint: { uri: string } } } };
        }
      ).manifest.apis.custom.endpoint.uri;
      const fromEnv = process.env.BRIDGE_LAMBDA_ARN;
      if (uri.includes('REPLACE') || uri.includes(':000000000000:')) {
        return fromEnv
          ? { ok: true, detail: `placeholder; npm run skill:deploy will write ${fromEnv}` }
          : {
              ok: false,
              detail: 'still the placeholder and no BRIDGE_LAMBDA_ARN in .env',
              fix: 'run npm run deploy (writes the ARN into .env), then npm run skill:deploy',
            };
      }
      return { ok: true, detail: uri };
    });

    // Recommended, not required: the Lambda works without it, it is just open until it is set.
    await check('skill.id (recommended)', () =>
      cfg.skill.id
        ? { ok: true, detail: cfg.skill.id }
        : {
            ok: true,
            detail:
              'unset: any Alexa Skill that knows your function ARN can invoke this Lambda. ' +
              'Recommended once ask deploy prints the id: put it in .env as BRIDGE_SKILL_ID and deploy again',
          },
    );
  }
}

const failed = results.filter((r) => !r.result.ok);
console.log('');
if (failed.length === 0) {
  console.log(`All checks passed for the "${track}" track.`);
  if (track === 'local') console.log('Next: npm run chat');
  if (track === 'cloud') console.log('Next: npm run deploy, then npm run chat -- --remote');
  if (track === 'skill')
    console.log('Next: ask deploy, then enable testing in the Alexa developer console');
} else {
  console.log(
    `${failed.length} check(s) failed: ${failed.map((f) => f.name).join(', ')}. Fix the → lines above and run npm run doctor again.`,
  );
  process.exit(1);
}
