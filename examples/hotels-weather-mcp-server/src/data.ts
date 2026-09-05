/**
 * Fixed datasets, so results are deterministic in tests and demos. Sixty-six cities, three hotels
 * each: twenty-four in the United States, eighteen European metropoles, and twenty-four across
 * Canada, Latin America, Asia, the Middle East, Africa and Oceania. Hotel names are fictional and
 * prices, ratings and weather are illustrative; nothing here describes a real business or a
 * forecast.
 *
 * Prices are in the local currency where a listener would expect it (US, Europe, Canada, Japan,
 * Singapore, Hong Kong, the Emirates, Australia, New Zealand) and in US dollars elsewhere, the way
 * international booking sites quote them. Weather keys are lowercase ASCII; the tools fold
 * diacritics before looking a city up, so "São Paulo" and "sao paulo" both resolve.
 */

export interface Hotel {
  name: string;
  destination: string;
  pricePerNight: number;
  currency: Currency;
  rating: number;
  maxGuests: number;
}

export type Currency =
  'USD' | 'EUR' | 'GBP' | 'CHF' | 'CAD' | 'JPY' | 'SGD' | 'HKD' | 'AED' | 'AUD' | 'NZD';

export interface Weather {
  conditions: string;
  highC: number;
  lowC: number;
}

type Row = [name: string, price: number, rating: number, maxGuests: number];

function city(destination: string, currency: Currency, rows: Row[]): Hotel[] {
  return rows.map(([name, pricePerNight, rating, maxGuests]) => ({
    name,
    destination,
    pricePerNight,
    currency,
    rating,
    maxGuests,
  }));
}

export const HOTELS: Hotel[] = [
  // United States
  ...city('New York', 'USD', [
    ['The Gramercy Standard', 420, 4.7, 3],
    ['Hudson Yards Lofts', 260, 4.4, 4],
    ['Bowery Pod Hotel', 140, 4.1, 2],
  ]),
  ...city('Los Angeles', 'USD', [
    ['Sunset Canyon Hotel', 380, 4.6, 4],
    ['Venice Beach House', 210, 4.3, 3],
    ['Downtown Arts Hostel', 95, 4.0, 6],
  ]),
  ...city('San Francisco', 'USD', [
    ['Nob Hill Grand', 450, 4.8, 3],
    ['Mission Courtyard Inn', 230, 4.4, 4],
    ['Fog City Rooms', 150, 4.1, 2],
  ]),
  ...city('Chicago', 'USD', [
    ['Lakeshore Tower Hotel', 340, 4.6, 4],
    ['The Wicker Park Hotel', 190, 4.4, 3],
    ['Loop Budget Suites', 110, 3.9, 5],
  ]),
  ...city('Boston', 'USD', [
    ['Beacon Hill Residence', 360, 4.7, 3],
    ['Harborside Hotel', 240, 4.5, 4],
    ['Fenway Traveler Inn', 130, 4.0, 4],
  ]),
  ...city('Seattle', 'USD', [
    ['Pike Place Grand', 330, 4.6, 3],
    ['Capitol Hill Boutique', 200, 4.4, 2],
    ['Rainier View Hostel', 85, 4.1, 6],
  ]),
  ...city('Miami', 'USD', [
    ['Ocean Drive Resort', 390, 4.5, 4],
    ['Wynwood Design Hotel', 220, 4.4, 3],
    ['Little Havana Guesthouse', 120, 4.2, 4],
  ]),
  ...city('Austin', 'USD', [
    ['South Congress Hotel', 290, 4.6, 3],
    ['Barton Springs Inn', 170, 4.3, 4],
    ['East Side Bunkhouse', 90, 4.0, 6],
  ]),
  ...city('Denver', 'USD', [
    ['Mile High Grand', 280, 4.5, 4],
    ['RiNo Warehouse Hotel', 180, 4.4, 3],
    ['Union Station Rooms', 120, 4.1, 2],
  ]),
  ...city('Washington', 'USD', [
    ['The Capitol Meridian', 410, 4.7, 3],
    ['Georgetown Row House', 250, 4.5, 4],
    ['Dupont Circle Inn', 150, 4.2, 2],
  ]),
  ...city('Las Vegas', 'USD', [
    ['The Strip Palace', 310, 4.4, 4],
    ['Fremont Street Hotel', 140, 4.1, 4],
    ['Desert Rose Motel', 70, 3.8, 5],
  ]),
  ...city('New Orleans', 'USD', [
    ['French Quarter Manor', 320, 4.6, 3],
    ['Garden District Inn', 200, 4.4, 4],
    ['Frenchmen Street Hostel', 80, 4.0, 6],
  ]),
  ...city('Atlanta', 'USD', [
    ['Peachtree Grand', 300, 4.5, 4],
    ['Midtown Arts Hotel', 180, 4.4, 3],
    ['Old Fourth Ward Inn', 110, 4.1, 2],
  ]),
  ...city('Dallas', 'USD', [
    ['Uptown Turtle Creek Hotel', 310, 4.6, 3],
    ['Deep Ellum Loft Hotel', 170, 4.3, 4],
    ['Bishop Arts Bunkhouse', 85, 4.0, 6],
  ]),
  ...city('Houston', 'USD', [
    ['Museum District Grand', 290, 4.5, 4],
    ['Montrose Boutique Hotel', 160, 4.4, 3],
    ['Downtown Budget Suites', 100, 3.9, 5],
  ]),
  ...city('Philadelphia', 'USD', [
    ['Rittenhouse Square Hotel', 330, 4.7, 3],
    ['Old City Townhouse', 190, 4.4, 4],
    ['Fishtown Rooms', 105, 4.1, 2],
  ]),
  ...city('Phoenix', 'USD', [
    ['Camelback Desert Resort', 340, 4.6, 4],
    ['Roosevelt Row Hotel', 160, 4.3, 3],
    ['Tempe Traveler Inn', 90, 4.0, 4],
  ]),
  ...city('San Diego', 'USD', [
    ['Coronado Bay Grand', 400, 4.7, 4],
    ['Gaslamp Quarter Hotel', 220, 4.4, 3],
    ['Ocean Beach Hostel', 80, 4.1, 6],
  ]),
  ...city('Portland', 'USD', [
    ['Pearl District Hotel', 270, 4.6, 3],
    ['Alberta Arts Inn', 160, 4.4, 4],
    ['Hawthorne Bunkhouse', 75, 4.1, 6],
  ]),
  ...city('Nashville', 'USD', [
    ['The Broadway Grand', 320, 4.6, 4],
    ['East Nashville Boutique', 190, 4.4, 3],
    ['Music Row Rooms', 110, 4.0, 2],
  ]),
  ...city('Honolulu', 'USD', [
    ['Waikiki Beachfront Resort', 480, 4.7, 4],
    ['Diamond Head Boutique', 260, 4.5, 3],
    ['Ala Moana Hostel', 95, 4.1, 6],
  ]),
  ...city('Orlando', 'USD', [
    ['Lake Eola Grand', 260, 4.5, 4],
    ['Winter Park Inn', 150, 4.3, 4],
    ['International Drive Motel', 75, 3.9, 5],
  ]),
  ...city('Minneapolis', 'USD', [
    ['Mill District Hotel', 250, 4.6, 3],
    ['Uptown Lakes Inn', 150, 4.3, 4],
    ['Northeast Arts Hostel', 80, 4.1, 6],
  ]),
  ...city('Salt Lake City', 'USD', [
    ['Wasatch Grand', 260, 4.5, 4],
    ['Sugar House Boutique', 150, 4.4, 3],
    ['Temple Square Rooms', 95, 4.0, 2],
  ]),

  // Europe
  ...city('London', 'GBP', [
    ['The Mayfair Crescent', 480, 4.8, 3],
    ['Shoreditch Loft Hotel', 240, 4.4, 4],
    ['Kings Cross Rooms', 130, 4.0, 2],
  ]),
  ...city('Paris', 'EUR', [
    ['Hotel Rive Gauche', 430, 4.7, 3],
    ['Le Marais Maison', 260, 4.5, 4],
    ['Montmartre Petit Hotel', 140, 4.2, 2],
  ]),
  ...city('Berlin', 'EUR', [
    ['Hotel Brandenburg Palais', 320, 4.8, 4],
    ['Kreuzberg Kollektiv Hotel', 140, 4.5, 2],
    ['Prenzlauer Berg Hostel', 60, 4.3, 6],
  ]),
  ...city('Munich', 'EUR', [
    ['Hotel Maximilianhof', 380, 4.7, 3],
    ['Glockenbach Boutique', 190, 4.4, 4],
    ['Isar River Rooms', 130, 4.4, 2],
  ]),
  ...city('Hamburg', 'EUR', [
    ['The Alster Grand', 350, 4.9, 2],
    ['Hafencity Harbour Hotel', 160, 4.4, 4],
    ['Sankt Pauli Bunk', 90, 4.2, 6],
  ]),
  ...city('Madrid', 'EUR', [
    ['Gran Via Palacio', 300, 4.6, 4],
    ['Malasaña Casa Hotel', 160, 4.4, 3],
    ['Lavapiés Hostal', 75, 4.1, 5],
  ]),
  ...city('Barcelona', 'EUR', [
    ['Passeig de Gracia Hotel', 340, 4.7, 3],
    ['El Born Boutique', 200, 4.5, 4],
    ['Barceloneta Beach Hostel', 85, 4.2, 6],
  ]),
  ...city('Rome', 'EUR', [
    ['Palazzo Trastevere', 360, 4.7, 3],
    ['Monti Guesthouse', 180, 4.4, 4],
    ['Termini Traveller Inn', 95, 4.0, 4],
  ]),
  ...city('Milan', 'EUR', [
    ['Hotel Brera Moderno', 330, 4.6, 3],
    ['Navigli Canal House', 190, 4.4, 4],
    ['Porta Garibaldi Rooms', 110, 4.1, 2],
  ]),
  ...city('Amsterdam', 'EUR', [
    ['Canal Ring Residence', 370, 4.7, 2],
    ['De Pijp Boutique Hotel', 210, 4.5, 4],
    ['Jordaan Backpackers', 70, 4.2, 6],
  ]),
  ...city('Vienna', 'EUR', [
    ['Hotel Ringstrasse Imperial', 390, 4.8, 3],
    ['Naschmarkt Design Hotel', 180, 4.4, 4],
    ['Leopoldstadt Pension', 100, 4.2, 2],
  ]),
  ...city('Prague', 'EUR', [
    ['Old Town Square Palace', 280, 4.7, 4],
    ['Vinohrady Garden Hotel', 150, 4.5, 3],
    ['Žižkov Hostel', 55, 4.1, 6],
  ]),
  ...city('Lisbon', 'EUR', [
    ['Chiado Grand Hotel', 290, 4.7, 3],
    ['Alfama Terrace House', 170, 4.5, 4],
    ['Bairro Alto Bunkhouse', 65, 4.2, 6],
  ]),
  ...city('Copenhagen', 'EUR', [
    ['Nyhavn Harbour Hotel', 340, 4.7, 4],
    ['Vesterbro Design Hotel', 200, 4.5, 2],
    ['Nørrebro Rooms', 120, 4.2, 4],
  ]),
  ...city('Stockholm', 'EUR', [
    ['Gamla Stan Palace', 350, 4.7, 3],
    ['Södermalm Loft Hotel', 210, 4.5, 4],
    ['Vasastan Hostel', 95, 4.1, 6],
  ]),
  ...city('Dublin', 'EUR', [
    ['The Merrion Square Hotel', 330, 4.7, 3],
    ['Temple Bar Townhouse', 190, 4.3, 4],
    ['Smithfield Lodge', 110, 4.1, 2],
  ]),
  ...city('Brussels', 'EUR', [
    ['Grand Place Hotel', 290, 4.6, 3],
    ['Ixelles Maison', 160, 4.4, 4],
    ['Saint-Gilles Guesthouse', 90, 4.2, 2],
  ]),
  ...city('Zurich', 'CHF', [
    ['Bahnhofstrasse Grand', 460, 4.8, 3],
    ['Lake Zurich Residence', 280, 4.6, 4],
    ['Kreis Five Hostel', 120, 4.2, 6],
  ]),

  // Canada and Latin America
  ...city('Toronto', 'CAD', [
    ['Yorkville Grand', 380, 4.7, 3],
    ['Distillery District Hotel', 220, 4.4, 4],
    ['Kensington Market Rooms', 110, 4.1, 2],
  ]),
  ...city('Vancouver', 'CAD', [
    ['Coal Harbour Residence', 390, 4.7, 4],
    ['Gastown Boutique Hotel', 230, 4.5, 3],
    ['Commercial Drive Hostel', 90, 4.1, 6],
  ]),
  ...city('Mexico City', 'USD', [
    ['Polanco Grand Hotel', 260, 4.7, 3],
    ['Roma Norte Casa', 140, 4.5, 4],
    ['Coyoacán Guesthouse', 60, 4.2, 4],
  ]),
  ...city('São Paulo', 'USD', [
    ['Jardins Executive Hotel', 240, 4.6, 3],
    ['Vila Madalena Boutique', 130, 4.4, 4],
    ['Pinheiros Hostel', 45, 4.1, 6],
  ]),
  ...city('Rio de Janeiro', 'USD', [
    ['Copacabana Palace View', 320, 4.6, 4],
    ['Ipanema Beach House', 180, 4.4, 3],
    ['Santa Teresa Pousada', 70, 4.2, 4],
  ]),
  ...city('Buenos Aires', 'USD', [
    ['Recoleta Grand', 230, 4.7, 3],
    ['Palermo Soho Boutique', 120, 4.5, 4],
    ['San Telmo Hostel', 40, 4.2, 6],
  ]),

  // Asia
  ...city('Tokyo', 'JPY', [
    ['Ginza Imperial Tower', 62000, 4.8, 3],
    ['Shinjuku Garden Hotel', 26000, 4.5, 2],
    ['Asakusa Ryokan Rooms', 9000, 4.3, 4],
  ]),
  ...city('Osaka', 'JPY', [
    ['Umeda Sky Grand', 48000, 4.7, 3],
    ['Namba Canal Hotel', 21000, 4.4, 4],
    ['Shinsekai Guesthouse', 7500, 4.2, 6],
  ]),
  ...city('Seoul', 'USD', [
    ['Gangnam Grand Hotel', 280, 4.6, 3],
    ['Hongdae Design Hotel', 140, 4.4, 4],
    ['Bukchon Hanok Stay', 80, 4.3, 2],
  ]),
  ...city('Beijing', 'USD', [
    ['Wangfujing Palace Hotel', 260, 4.6, 4],
    ['Hutong Courtyard House', 130, 4.5, 3],
    ['Sanlitun Backpackers', 45, 4.0, 6],
  ]),
  ...city('Shanghai', 'USD', [
    ['The Bund Grand', 300, 4.7, 3],
    ['French Concession Boutique', 160, 4.5, 4],
    ['Jing’an Rooms', 60, 4.1, 2],
  ]),
  ...city('Hong Kong', 'HKD', [
    ['Victoria Harbour Grand', 2800, 4.7, 3],
    ['Sheung Wan Design Hotel', 1400, 4.4, 4],
    ['Mong Kok Budget Rooms', 600, 4.0, 2],
  ]),
  ...city('Singapore', 'SGD', [
    ['Marina Bay Residence', 450, 4.8, 4],
    ['Tiong Bahru Boutique', 220, 4.5, 3],
    ['Little India Hostel', 60, 4.2, 6],
  ]),
  ...city('Bangkok', 'USD', [
    ['Riverside Grand Hotel', 180, 4.7, 4],
    ['Sukhumvit Design Hotel', 90, 4.4, 3],
    ['Khao San Guesthouse', 25, 4.1, 6],
  ]),
  ...city('Mumbai', 'USD', [
    ['Colaba Heritage Hotel', 220, 4.6, 3],
    ['Bandra Sea View Hotel', 120, 4.4, 4],
    ['Fort District Rooms', 45, 4.0, 2],
  ]),
  ...city('Delhi', 'USD', [
    ['Lutyens Garden Hotel', 200, 4.6, 4],
    ['Hauz Khas Boutique', 100, 4.4, 3],
    ['Paharganj Backpackers', 30, 3.9, 6],
  ]),

  // Middle East and Africa
  ...city('Dubai', 'AED', [
    ['Palm Jumeirah Resort', 1500, 4.8, 4],
    ['Downtown Skyline Hotel', 700, 4.5, 3],
    ['Deira Creek Hotel', 280, 4.1, 4],
  ]),
  ...city('Istanbul', 'USD', [
    ['Bosphorus Palace Hotel', 260, 4.7, 3],
    ['Karaköy Boutique', 130, 4.5, 4],
    ['Sultanahmet Guesthouse', 55, 4.2, 4],
  ]),
  ...city('Cairo', 'USD', [
    ['Nile Corniche Grand', 190, 4.5, 4],
    ['Zamalek Garden Hotel', 100, 4.4, 3],
    ['Downtown Cairo Hostel', 30, 4.0, 6],
  ]),
  ...city('Cape Town', 'USD', [
    ['Table Mountain Lodge', 260, 4.8, 3],
    ['Waterfront Harbour Hotel', 150, 4.5, 4],
    ['Long Street Backpackers', 35, 4.1, 6],
  ]),
  ...city('Nairobi', 'USD', [
    ['Karen Blixen Garden Hotel', 210, 4.6, 4],
    ['Westlands Business Hotel', 110, 4.3, 3],
    ['Kilimani Guesthouse', 50, 4.1, 2],
  ]),

  // Oceania
  ...city('Sydney', 'AUD', [
    ['Circular Quay Grand', 420, 4.7, 3],
    ['Surry Hills Boutique', 230, 4.5, 4],
    ['Bondi Beach Backpackers', 90, 4.2, 6],
  ]),
  ...city('Melbourne', 'AUD', [
    ['Collins Street Residence', 380, 4.7, 3],
    ['Fitzroy Laneway Hotel', 210, 4.5, 4],
    ['St Kilda Hostel', 80, 4.1, 6],
  ]),
  ...city('Auckland', 'NZD', [
    ['Viaduct Harbour Hotel', 380, 4.6, 4],
    ['Ponsonby Boutique', 210, 4.4, 3],
    ['Karangahape Road Rooms', 80, 4.1, 2],
  ]),
];

/** Typical conditions per city, keyed by lowercase ASCII name. Illustrative, not a forecast. */
export const WEATHER: Record<string, Weather> = {
  // United States
  'new york': { conditions: 'partly cloudy', highC: 24, lowC: 16 },
  'los angeles': { conditions: 'sunny', highC: 27, lowC: 17 },
  'san francisco': { conditions: 'morning fog, clearing later', highC: 19, lowC: 12 },
  chicago: { conditions: 'windy with scattered clouds', highC: 22, lowC: 13 },
  boston: { conditions: 'clear', highC: 21, lowC: 13 },
  seattle: { conditions: 'drizzle', highC: 17, lowC: 10 },
  miami: { conditions: 'humid with afternoon showers', highC: 31, lowC: 25 },
  austin: { conditions: 'hot and sunny', highC: 34, lowC: 23 },
  denver: { conditions: 'sunny with a chance of thunderstorms', highC: 28, lowC: 14 },
  washington: { conditions: 'hazy and warm', highC: 29, lowC: 20 },
  'las vegas': { conditions: 'clear and hot', highC: 38, lowC: 26 },
  'new orleans': { conditions: 'thunderstorms', highC: 32, lowC: 25 },
  atlanta: { conditions: 'warm and humid', highC: 30, lowC: 21 },
  dallas: { conditions: 'hot with a few clouds', highC: 35, lowC: 24 },
  houston: { conditions: 'humid with scattered storms', highC: 33, lowC: 25 },
  philadelphia: { conditions: 'partly sunny', highC: 26, lowC: 17 },
  phoenix: { conditions: 'clear and very hot', highC: 41, lowC: 29 },
  'san diego': { conditions: 'sunny and mild', highC: 24, lowC: 17 },
  portland: { conditions: 'light rain', highC: 20, lowC: 12 },
  nashville: { conditions: 'warm with evening storms', highC: 30, lowC: 20 },
  honolulu: { conditions: 'sunny with trade winds', highC: 30, lowC: 24 },
  orlando: { conditions: 'humid with afternoon thunderstorms', highC: 32, lowC: 24 },
  minneapolis: { conditions: 'clear and breezy', highC: 23, lowC: 12 },
  'salt lake city': { conditions: 'sunny and dry', highC: 29, lowC: 15 },

  // Europe
  london: { conditions: 'overcast', highC: 19, lowC: 12 },
  paris: { conditions: 'sunny', highC: 26, lowC: 15 },
  berlin: { conditions: 'partly cloudy', highC: 21, lowC: 12 },
  munich: { conditions: 'sunny', highC: 24, lowC: 13 },
  hamburg: { conditions: 'light rain', highC: 18, lowC: 11 },
  madrid: { conditions: 'hot and dry', highC: 34, lowC: 20 },
  barcelona: { conditions: 'sunny with a sea breeze', highC: 28, lowC: 21 },
  rome: { conditions: 'sunny', highC: 31, lowC: 20 },
  milan: { conditions: 'hazy sunshine', highC: 30, lowC: 20 },
  amsterdam: { conditions: 'showers', highC: 19, lowC: 12 },
  vienna: { conditions: 'partly cloudy', highC: 25, lowC: 15 },
  prague: { conditions: 'clear', highC: 24, lowC: 13 },
  lisbon: { conditions: 'sunny and breezy', highC: 28, lowC: 18 },
  copenhagen: { conditions: 'cloudy with a stiff wind', highC: 18, lowC: 11 },
  stockholm: { conditions: 'clear and cool', highC: 20, lowC: 11 },
  dublin: { conditions: 'light rain', highC: 17, lowC: 10 },
  brussels: { conditions: 'overcast', highC: 20, lowC: 12 },
  zurich: { conditions: 'sunny with cloud over the Alps', highC: 24, lowC: 13 },

  // Canada and Latin America
  toronto: { conditions: 'partly cloudy', highC: 24, lowC: 15 },
  vancouver: { conditions: 'light rain', highC: 19, lowC: 12 },
  'mexico city': { conditions: 'sunny mornings, afternoon showers', highC: 24, lowC: 12 },
  'sao paulo': { conditions: 'cloudy and mild', highC: 25, lowC: 16 },
  'rio de janeiro': { conditions: 'sunny and humid', highC: 30, lowC: 22 },
  'buenos aires': { conditions: 'mild with scattered clouds', highC: 22, lowC: 13 },

  // Asia
  tokyo: { conditions: 'humid and clear', highC: 31, lowC: 24 },
  osaka: { conditions: 'hot and humid', highC: 32, lowC: 25 },
  seoul: { conditions: 'warm with haze', highC: 29, lowC: 20 },
  beijing: { conditions: 'hazy sunshine', highC: 31, lowC: 21 },
  shanghai: { conditions: 'humid with showers', highC: 32, lowC: 25 },
  'hong kong': { conditions: 'hot and humid, chance of thunderstorms', highC: 32, lowC: 27 },
  singapore: { conditions: 'humid with afternoon thunderstorms', highC: 32, lowC: 26 },
  bangkok: { conditions: 'hot and humid, evening storms', highC: 34, lowC: 27 },
  mumbai: { conditions: 'monsoon showers', highC: 30, lowC: 26 },
  delhi: { conditions: 'very hot and hazy', highC: 39, lowC: 28 },

  // Middle East and Africa
  dubai: { conditions: 'clear and very hot', highC: 41, lowC: 30 },
  istanbul: { conditions: 'sunny with a breeze off the Bosphorus', highC: 28, lowC: 20 },
  cairo: { conditions: 'clear and hot', highC: 36, lowC: 23 },
  'cape town': { conditions: 'windy with sunny spells', highC: 20, lowC: 12 },
  nairobi: { conditions: 'mild with scattered clouds', highC: 24, lowC: 13 },

  // Oceania
  sydney: { conditions: 'sunny', highC: 23, lowC: 15 },
  melbourne: { conditions: 'changeable, showers possible', highC: 19, lowC: 11 },
  auckland: { conditions: 'showers clearing', highC: 19, lowC: 12 },
};
