import { describe, expect, it } from 'vitest';
import {
  ALEXA_PLUS_PROTOCOL_VERSION,
  ProtocolVersionError,
  alexaPlusVersionWarning,
  requireProtocolVersion,
} from './mcp-version.js';

describe('requireProtocolVersion', () => {
  it('returns whatever the transport negotiated, old versions included', () => {
    expect(requireProtocolVersion('2025-06-18')).toBe('2025-06-18');
    expect(requireProtocolVersion(ALEXA_PLUS_PROTOCOL_VERSION)).toBe(ALEXA_PLUS_PROTOCOL_VERSION);
  });

  it('throws only when the server reported no version', () => {
    expect(() => requireProtocolVersion(undefined)).toThrowError(ProtocolVersionError);
  });
});

describe('alexaPlusVersionWarning', () => {
  it('says nothing at or above the Alexa+ floor', () => {
    expect(alexaPlusVersionWarning(ALEXA_PLUS_PROTOCOL_VERSION)).toBeUndefined();
    expect(alexaPlusVersionWarning('2026-07-28')).toBeUndefined();
  });

  it('names the negotiated version and the floor below it', () => {
    const warning = alexaPlusVersionWarning('2025-06-18');
    expect(warning).toContain('2025-06-18');
    expect(warning).toContain(ALEXA_PLUS_PROTOCOL_VERSION);
    expect(warning).toMatch(/Alexa\+ add-on/);
  });
});
