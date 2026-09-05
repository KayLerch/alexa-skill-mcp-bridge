import { describe, expect, it } from 'vitest';
import { HOTELS, WEATHER } from './data.js';

/** The invariants the tools rely on, so a data edit cannot quietly break a demo turn. */
describe('hotels and weather data', () => {
  const cities = [...new Set(HOTELS.map((h) => h.destination))];

  it('covers sixty-six cities with three hotels each', () => {
    expect(cities).toHaveLength(66);
    for (const city of cities) {
      expect(
        HOTELS.filter((h) => h.destination === city),
        city,
      ).toHaveLength(3);
    }
  });

  it('has weather for every hotel city, keyed by lowercase ASCII name', () => {
    const fold = (t: string) =>
      t
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    for (const city of cities) expect(WEATHER[fold(city)], city).toBeDefined();
    expect(Object.keys(WEATHER)).toHaveLength(66);
  });

  it('lets a couple book somewhere in every city', () => {
    for (const city of cities) {
      expect(
        HOTELS.some((h) => h.destination === city && h.maxGuests >= 2),
        `${city} has nothing for two guests`,
      ).toBe(true);
    }
  });

  it('keeps names unique and numbers sane', () => {
    expect(new Set(HOTELS.map((h) => h.name)).size).toBe(HOTELS.length);
    for (const h of HOTELS) {
      expect(h.pricePerNight).toBeGreaterThan(0);
      expect(h.rating).toBeGreaterThanOrEqual(3.5);
      expect(h.rating).toBeLessThanOrEqual(5);
      expect(h.maxGuests).toBeGreaterThanOrEqual(1);
    }
    for (const w of Object.values(WEATHER)) expect(w.highC).toBeGreaterThan(w.lowC);
  });
});
