import { describe, expect, it } from 'vitest';
import type { ManifestTool } from '@alexa-mcp-bridge/core';
import { MAX_UTTERANCES, MIN_UTTERANCES, templateUtterances } from './template.js';
import { normalizeUtterance, validUtterance } from './validate.js';

const hotels: ManifestTool = {
  name: 'search_hotels',
  intent: 'SearchHotelsIntent',
  slots: [
    { argument: 'checkIn', slot: 'checkIn', slotType: 'AMAZON.DATE', required: true },
    { argument: 'guests', slot: 'guests', slotType: 'AMAZON.NUMBER', required: false },
    {
      argument: 'destination',
      slot: 'destination',
      slotType: 'AMAZON.SearchQuery',
      required: true,
    },
  ],
  elicitedArguments: [],
  inputSchema: {},
};

describe('templateUtterances', () => {
  it('yields between 8 and 15 valid, unique utterances', () => {
    const out = templateUtterances(hotels);
    expect(out.length).toBeGreaterThanOrEqual(MIN_UTTERANCES);
    expect(out.length).toBeLessThanOrEqual(MAX_UTTERANCES);
    expect(new Set(out).size).toBe(out.length);
    for (const u of out) expect(validUtterance(u, hotels.slots)).toBe(true);
    expect(out).toContain('search hotels');
    expect(out).toContain('search hotels destination {destination}');
  });

  it('is deterministic', () => {
    expect(templateUtterances(hotels)).toEqual(templateUtterances(hotels));
  });
});

describe('validUtterance', () => {
  it('enforces the SearchQuery and slot rules', () => {
    expect(validUtterance('find hotels in {destination}', hotels.slots)).toBe(true);
    expect(validUtterance('{destination}', hotels.slots)).toBe(false);
    expect(validUtterance('hotels in {destination} for {guests}', hotels.slots)).toBe(false);
    expect(validUtterance('hotels for {guests} on {checkIn}', hotels.slots)).toBe(true);
    expect(validUtterance('hotels for {people}', hotels.slots)).toBe(false);
    expect(validUtterance('hotels for 2', hotels.slots)).toBe(false);
    expect(validUtterance('{guests} {guests}', hotels.slots)).toBe(false);
  });

  it('normalizes model output', () => {
    expect(normalizeUtterance('  Find Hotels, in {destination}!  ')).toBe(
      'find hotels in {destination}',
    );
  });
});
