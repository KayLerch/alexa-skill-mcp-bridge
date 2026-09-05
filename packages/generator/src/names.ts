/** Naming conventions: intent is PascalCase(tool) + 'Intent', slot is camelCase(argument). */

export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function pascalCase(name: string): string {
  return words(name)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

export function camelCase(name: string): string {
  const p = pascalCase(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

export function intentNameFor(toolName: string): string {
  return `${pascalCase(toolName)}Intent`;
}

export function slotNameFor(argument: string): string {
  return camelCase(argument);
}

/** Lowercase spoken words, digits dropped: what an utterance can carry. */
export function spokenWords(name: string): string {
  return words(name)
    .map((w) => w.toLowerCase().replace(/[0-9]/g, ''))
    .filter(Boolean)
    .join(' ');
}
