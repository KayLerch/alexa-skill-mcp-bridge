/** Fixed datasets so results are deterministic in tests. */

export interface Hotel {
  name: string;
  destination: string;
  pricePerNight: number;
  rating: number;
  maxGuests: number;
}

export const HOTELS: Hotel[] = [
  { name: 'Hotel Adlon', destination: 'Berlin', pricePerNight: 320, rating: 4.8, maxGuests: 4 },
  {
    name: 'Michelberger Hotel',
    destination: 'Berlin',
    pricePerNight: 140,
    rating: 4.5,
    maxGuests: 2,
  },
  { name: 'Circus Hostel', destination: 'Berlin', pricePerNight: 60, rating: 4.3, maxGuests: 6 },
  { name: 'Bayerischer Hof', destination: 'Munich', pricePerNight: 380, rating: 4.7, maxGuests: 3 },
  {
    name: 'Hotel Laimer Hof',
    destination: 'Munich',
    pricePerNight: 130,
    rating: 4.4,
    maxGuests: 2,
  },
  { name: 'The Fontenay', destination: 'Hamburg', pricePerNight: 350, rating: 4.9, maxGuests: 2 },
  {
    name: '25hours Hafencity',
    destination: 'Hamburg',
    pricePerNight: 160,
    rating: 4.4,
    maxGuests: 4,
  },
  {
    name: 'Superbude St. Pauli',
    destination: 'Hamburg',
    pricePerNight: 90,
    rating: 4.2,
    maxGuests: 6,
  },
];

export const WEATHER: Record<string, { conditions: string; highC: number; lowC: number }> = {
  berlin: { conditions: 'partly cloudy', highC: 21, lowC: 12 },
  munich: { conditions: 'sunny', highC: 24, lowC: 13 },
  hamburg: { conditions: 'light rain', highC: 18, lowC: 11 },
  london: { conditions: 'overcast', highC: 19, lowC: 12 },
  paris: { conditions: 'sunny', highC: 26, lowC: 15 },
  'new york': { conditions: 'thunderstorms', highC: 29, lowC: 21 },
  seattle: { conditions: 'drizzle', highC: 17, lowC: 10 },
  tokyo: { conditions: 'humid and clear', highC: 31, lowC: 24 },
};
