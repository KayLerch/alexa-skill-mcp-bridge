import { describe, expect, it } from 'vitest';
import { hashId } from './ids.js';

describe('hashId', () => {
  it('is a 64-char lowercase hex string without dots', () => {
    const id = hashId('amzn1.ask.account.AHXYZ');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('.');
  });

  it('is deterministic and collision-free for different inputs', () => {
    expect(hashId('a')).toBe(hashId('a'));
    expect(hashId('a')).not.toBe(hashId('b'));
  });
});
