import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError, findConfigFile, loadConfigFile } from '@alexa-mcp-bridge/core';
import { defaultPaths, generate } from './generate.js';
import { ScanError } from './scan.js';

/** npm run generate [-- --no-model] [--config path] */
const { values } = parseArgs({
  options: {
    'no-model': { type: 'boolean', default: false },
    config: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'npm run generate [-- --no-model] [--config bridge.config.ts]\n  --no-model  deterministic template utterances only (no Bedrock call)',
  );
  process.exit(0);
}

try {
  const configPath = values.config ?? findConfigFile();
  if (!configPath) throw new ConfigError('bridge.config.ts not found');
  const config = await loadConfigFile(configPath);
  const result = await generate({
    config,
    paths: defaultPaths(dirname(configPath)),
    useModel: !values['no-model'],
    log: (line) => console.log(line),
  });
  console.log('');
  for (const tool of result.manifest.tools) {
    const slots = tool.slots.map((s) => `${s.slot}:${s.slotType}`).join(', ') || 'no slots';
    const elicited = tool.elicitedArguments.length
      ? `; agent asks for ${tool.elicitedArguments.join(', ')}`
      : '';
    const count =
      result.models[config.skill.locales[0] as string]?.interactionModel.languageModel.intents.find(
        (i) => i.name === tool.intent,
      )?.samples?.length ?? 0;
    console.log(`  ${tool.intent} ← ${tool.name} (${slots}${elicited}), ${count} utterances`);
  }
  console.log(
    `\nGreeting examples: ${result.manifest.examplePhrases.map((p) => `"${p}"`).join(', ')}`,
  );
  for (const note of result.notes) console.log(`note: ${note}`);
  console.log(`\nWrote:\n${result.files.map((f) => `  ${f}`).join('\n')}`);
  console.log(
    '\nNext: review the interaction model, add overrides in skill-package/overrides/<locale>.utterances.json if you like, then npm run chat.',
  );
} catch (err) {
  if (err instanceof ConfigError || err instanceof ScanError) {
    console.error(`generate failed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
