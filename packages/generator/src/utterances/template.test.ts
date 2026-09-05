import { describe, expect, it } from 'vitest';
import type { ManifestTool } from '@alexa-mcp-bridge/core';
import {
  MAX_UTTERANCES,
  MIN_UTTERANCES,
  slotCombinations,
  templateUtterances,
} from './template.js';
import { topUp } from './model.js';
import { normalizeUtterance, slotKey, validUtterance } from './validate.js';

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

/** Three typed slots, the shape a one-shot request needs: "best park for fishing in june". */
const findPark: ManifestTool = {
  name: 'find_park',
  intent: 'FindParkIntent',
  slots: [
    { argument: 'activity', slot: 'activity', slotType: 'FindParkActivityType', required: false },
    { argument: 'month', slot: 'month', slotType: 'FindParkMonthType', required: false },
    { argument: 'state', slot: 'state', slotType: 'FindParkStateType', required: false },
  ],
  elicitedArguments: [],
  inputSchema: {},
};

describe('slot combination coverage', () => {
  it('lists every combination of typed slots, smallest first', () => {
    const keys = slotCombinations(findPark.slots).map((c) => c.map((s) => s.slot).join('+'));
    expect(keys).toHaveLength(7);
    expect(keys.slice(0, 3)).toEqual(['activity', 'month', 'state']);
    expect(keys).toContain('activity+month');
    expect(keys).toContain('activity+month+state');
  });

  it('gives every combination at least one utterance, in more than one order', () => {
    const out = templateUtterances(findPark);
    const covered = new Set(out.map(slotKey));
    for (const combination of slotCombinations(findPark.slots)) {
      const key = combination
        .map((s) => s.slot)
        .sort()
        .join('+');
      expect(covered, `no utterance covers ${key}`).toContain(key);
    }
    const pairs = out.filter((u) => slotKey(u) === 'activity+month');
    expect(pairs.length).toBeGreaterThan(1);
    expect(pairs.some((u) => u.indexOf('{activity}') < u.indexOf('{month}'))).toBe(true);
    expect(pairs.some((u) => u.indexOf('{month}') < u.indexOf('{activity}'))).toBe(true);
  });

  it('reads like speech rather than naming the arguments', () => {
    const out = templateUtterances(findPark);
    expect(out).toContain('find park for {activity} in {month}');
    for (const u of out) expect(validUtterance(u, findPark.slots)).toBe(true);
  });

  it('tops model output up with the combinations it missed', () => {
    const fromModel = ['what is the best park for {activity}', 'where should i go'];
    const merged = topUp(fromModel, templateUtterances(findPark), findPark);
    expect(merged.slice(0, 2)).toEqual(fromModel);
    const covered = new Set(merged.map(slotKey));
    expect(covered).toContain('activity+month');
    expect(covered).toContain('activity+month+state');
    expect(merged.length).toBeLessThanOrEqual(MAX_UTTERANCES);
  });
});

describe('templateUtterances', () => {
  it('yields valid, unique utterances covering each slot combination', () => {
    const out = templateUtterances(hotels);
    expect(out.length).toBeGreaterThanOrEqual(MIN_UTTERANCES);
    expect(out.length).toBeLessThanOrEqual(MAX_UTTERANCES);
    expect(new Set(out).size).toBe(out.length);
    for (const u of out) expect(validUtterance(u, hotels.slots)).toBe(true);
    expect(out).toContain('search hotels');
    expect(out).toContain('search hotels destination {destination}');
    expect(out).toContain('search hotels on {checkIn} for {guests}');
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
