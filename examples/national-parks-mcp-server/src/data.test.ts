import { describe, expect, it } from 'vitest';
import { ACTIVITIES, MONTHS, OFFERED_ACTIVITIES, PARKS } from './data.js';

/**
 * The dataset is hand-assembled from nps.gov, so the invariants the tools rely on are checked
 * here rather than assumed. An unclassified month is the bug that hides: the tool would drop the
 * park from a month query instead of explaining what is closed.
 */

describe('parks data', () => {
  it('has a unique id and a spoken name per park', () => {
    const ids = PARKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const park of PARKS) {
      expect(park.name).not.toMatch(/national park/i);
      expect(park.fullName).toMatch(/National Park/);
      expect(park.states.length).toBeGreaterThan(0);
    }
  });

  it('cites a source for every park', () => {
    for (const park of PARKS) {
      expect(park.sources.length, park.name).toBeGreaterThan(0);
      for (const url of park.sources) expect(url).toMatch(/^https:\/\/www\.nps\.gov\//);
    }
  });

  it('classifies every month as full or limited access', () => {
    for (const park of PARKS) {
      const covered = new Set([...park.season.fullAccess, ...park.season.limited]);
      const missing = MONTHS.map((_, i) => i + 1).filter((m) => !covered.has(m));
      expect(missing, `${park.name} has unclassified months`).toEqual([]);
      const overlap = park.season.fullAccess.filter((m) => park.season.limited.includes(m));
      expect(overlap, `${park.name} has months in both lists`).toEqual([]);
    }
  });

  it('uses only the shared activity vocabulary, and every activity has a park', () => {
    for (const park of PARKS) {
      for (const activity of park.activities) expect(ACTIVITIES).toContain(activity);
      expect(new Set(park.activities).size).toBe(park.activities.length);
    }
    expect(OFFERED_ACTIVITIES).toEqual([...ACTIVITIES]);
  });

  it('keeps every spoken field short enough to say out loud', () => {
    for (const park of PARKS) {
      expect(park.highlight.length, park.name).toBeLessThan(120);
      expect(park.season.note.length, park.name).toBeLessThan(300);
      expect(park.highlight).not.toMatch(/[0-9]/);
    }
  });

  it('covers each activity with at least two parks, so a recommendation has a choice', () => {
    for (const activity of ACTIVITIES) {
      const parks = PARKS.filter((p) => p.activities.includes(activity));
      expect(parks.length, `only ${parks.length} park(s) offer ${activity}`).toBeGreaterThan(1);
    }
  });
});
