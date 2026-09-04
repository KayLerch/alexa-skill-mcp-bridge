import type { BridgeConfig, ToolManifest } from '@alexa-mcp-bridge/core';

/** Spoken on launch: from config, or derived from the manifest (plan D3). */
export function greeting(config: BridgeConfig, manifest: ToolManifest): string {
  if (config.skill.greeting) return config.skill.greeting;
  const [first, second] = manifest.examplePhrases;
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

export function helpText(config: BridgeConfig, manifest: ToolManifest): string {
  const tools = manifest.tools.map((t) => t.name.replace(/[_-]+/g, ' ')).join(', ');
  const examples = manifest.examplePhrases.map((p) => `"${p}"`).join(' or ');
  return `${spokenName(manifest.server.name)} can ${tools}. Try saying ${examples || 'a request'}. You can also say "ask" followed by anything. What would you like to do?`;
}

export const REPROMPT = 'What would you like to do?';

function spokenName(name: string): string {
  return name.replace(/[_-]+/g, ' ');
}
