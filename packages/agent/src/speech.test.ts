import { describe, expect, it } from 'vitest';
import { cleanSpeech, endsWithQuestion } from './speech.js';

describe('cleanSpeech', () => {
  it('strips markdown, bullets, links, and code', () => {
    const input =
      '# Hotels\n\n- **Hotel Adlon** at *320 euros*\n- [Michelberger](https://x.y) at 140\n\n`code` here';
    expect(cleanSpeech(input)).toBe(
      'Hotels Hotel Adlon at 320 euros Michelberger at 140 code here',
    );
  });

  it('replaces bare URLs and removes emoji', () => {
    expect(cleanSpeech('See https://example.com/a?b=c now 🎉')).toBe('See a link now');
  });

  it('collapses whitespace and newlines', () => {
    expect(cleanSpeech('one\n\n\n two   three ')).toBe('one two three');
  });

  it('keeps ordinary punctuation and underscores inside words', () => {
    expect(cleanSpeech("It's 21 degrees, partly cloudy. snake_case stays.")).toBe(
      "It's 21 degrees, partly cloudy. snake_case stays.",
    );
  });
});

describe('endsWithQuestion', () => {
  it('detects a trailing question mark', () => {
    expect(endsWithQuestion('Want to hear more?')).toBe(true);
    expect(endsWithQuestion('Want to hear more? ')).toBe(true);
    expect(endsWithQuestion('Done.')).toBe(false);
  });
});
