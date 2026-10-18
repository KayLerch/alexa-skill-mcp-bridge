import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { displaySchema, type Display, type Visual } from '@alexa-mcp-bridge/core';

/**
 * `npm run chat -- --display WxH[:theme]` (D54): the chat sends a screen with every turn, the
 * way an Alexa Skill does for a device that has one, and saves each rendered screen to a file.
 */

export function parseDisplay(value: string): Display {
  const match = /^(\d+)x(\d+)(?::(light|dark))?$/i.exec(value.trim());
  const parsed = match
    ? displaySchema.safeParse({
        width: Number(match[1]),
        height: Number(match[2]),
        ...(match[3] ? { theme: match[3].toLowerCase() } : {}),
      })
    : undefined;
  if (!parsed?.success) {
    throw new Error(`--display wants WxH or WxH:light|dark, e.g. 1280x800; got "${value}"`);
  }
  return parsed.data;
}

let folder: string | undefined;
let count = 0;

/** Writes the visual's JPEG to a temp folder of this chat and returns the file's path. */
export function saveVisual(visual: Visual): string {
  folder ??= mkdtempSync(join(tmpdir(), 'bridge-chat-screen-'));
  const file = join(folder, `screen-${++count}.jpg`);
  writeFileSync(file, Buffer.from(visual.dataUrl.slice(visual.dataUrl.indexOf(',') + 1), 'base64'));
  return file;
}
