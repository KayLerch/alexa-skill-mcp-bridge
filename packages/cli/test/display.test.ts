import { existsSync, readFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDisplay, saveVisual } from '../src/display.js';

/** `npm run chat -- --display WxH` (D54): the screen size it sends, and where the image goes. */

describe('parseDisplay', () => {
  it('reads WxH with the dark theme by default, and an optional theme', () => {
    expect(parseDisplay('1280x800')).toEqual({ width: 1280, height: 800, theme: 'dark' });
    expect(parseDisplay('960X480:light')).toEqual({ width: 960, height: 480, theme: 'light' });
  });

  it('refuses anything else with the expected form', () => {
    for (const bad of ['1280', '0x800', 'axb', '1280x800:blue', '']) {
      expect(() => parseDisplay(bad)).toThrow(/WxH/);
    }
  });
});

describe('saveVisual', () => {
  it('writes the JPEG of a visual to a temp file and returns its path', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const path = saveVisual({
      kind: 'image',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,' + bytes.toString('base64'),
      width: 1280,
      height: 800,
    });
    expect(path).toMatch(/\.jpg$/);
    expect(readFileSync(path)).toEqual(bytes);
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });
});
