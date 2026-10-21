import type { BridgeConfig, ToolManifest } from '@alexa-mcp-bridge/core';

/** The example phrases the greeting and help name: from config, else from the manifest (D61). */
export function examplePhrases(config: BridgeConfig, manifest: ToolManifest): string[] {
  return config.skill.examplePhrases ?? manifest.examplePhrases;
}

/** Spoken on launch: from config, or derived from the manifest (plan D3). */
export function greeting(config: BridgeConfig, manifest: ToolManifest): string {
  if (config.skill.greeting) return config.skill.greeting;
  const [first, second] = examplePhrases(config, manifest);
  const examples =
    first && second
      ? `For example, say "${first}" or "${second}".`
      : first
        ? `For example, say "${first}".`
        : '';
  return `Welcome to ${spokenName(manifest.server.name)}. ${examples} What would you like to do?`.replace(
    /\s+/g,
    ' ',
  );
}

/** Spoken for "help": skill.help when set (D61), else the tools and example phrases. */
export function helpText(config: BridgeConfig, manifest: ToolManifest): string {
  if (config.skill.help) return config.skill.help;
  const tools = manifest.tools
    .filter((t) => !t.aliasOf)
    .map((t) => t.name.replace(/[_-]+/g, ' '))
    .join(', ');
  const examples = examplePhrases(config, manifest)
    .map((p) => `"${p}"`)
    .join(' or ');
  return `${spokenName(manifest.server.name)} can ${tools}. Try saying ${examples || 'a request'}. You can also say "ask" followed by anything. What would you like to do?`;
}

export const REPROMPT = 'What would you like to do?';

function spokenName(name: string): string {
  return name.replace(/[_-]+/g, ' ');
}
