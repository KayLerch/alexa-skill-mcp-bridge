/**
 * US National Park facts, extracted from nps.gov on 2026-09-05.
 *
 * Source: National Park Service (nps.gov). Works of the US Government are not under copyright
 * (17 U.S.C. § 105), and the fields here are plain facts. Text and numbers only: no images, no
 * NPS marks. This is an unofficial demo dataset and is not affiliated with or endorsed by the
 * National Park Service.
 *
 * Every row lists the pages it came from. `activities` and `season.note` are the pages' own
 * statements, normalized to the vocabulary below; `openAllYear` and the month arrays are a coarse
 * reading of that note, so the tools can answer "which park in June" without re-parsing prose.
 * When a page did not state something, the field is left empty rather than guessed.
 *
 * To refresh or extend: open the `sources` of a row, re-read those fields, and edit here. Adding
 * a park is a data change only.
 */

export const ACTIVITIES = [
  'hiking',
  'wildlife watching',
  'fishing',
  'stargazing',
  'paddling',
  'scenic driving',
  'camping',
  'biking',
  'climbing',
  'winter sports',
  'ranger programs',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export type Month = (typeof MONTHS)[number];

export interface Season {
  /** The park itself is open all year, whatever the roads are doing. */
  openAllYear: boolean;
  /** One spoken sentence, from the park's own operating-hours page. */
  note: string;
  /** Months when the main roads and services are open. */
  fullAccess: number[];
  /** Months when roads, services or programs are cut back. */
  limited: number[];
  /** Months the park itself calls out as best or busiest. Empty when the page did not say. */
  highlighted: number[];
}

export interface Park {
  /** NPS park code, and the id an Alexa slot resolves to. */
  id: string;
  /** How the name is spoken. */
  name: string;
  fullName: string;
  states: string[];
  activities: Activity[];
  /** What this park is known for, read off its own highlight. Ranks recommendations. */
  signature: Activity[];
  season: Season;
  /** One line for the spoken answer. */
  highlight: string;
  sources: string[];
}

export const PARKS: Park[] = [
  {
    id: 'yose',
    name: 'Yosemite',
    fullName: 'Yosemite National Park',
    states: ['California'],
    activities: [
      'hiking',
      'climbing',
      'camping',
      'fishing',
      'stargazing',
      'biking',
      'winter sports',
      'scenic driving',
      'wildlife watching',
      'paddling',
      'ranger programs',
    ],
    signature: ['climbing', 'hiking'],
    season: {
      openAllYear: true,
      note: 'Open around the clock all year, but some roads stay closed for snow from about November into May or June. Most people come between April and October.',
      fullAccess: [6, 7, 8, 9, 10],
      limited: [11, 12, 1, 2, 3, 4, 5],
      highlighted: [4, 5, 6, 7, 8, 9, 10],
    },
    highlight: 'Waterfalls in spring, granite walls, and the high country once Tioga Road opens.',
    sources: [
      'https://www.nps.gov/yose/planyourvisit/hours.htm',
      'https://www.nps.gov/yose/planyourvisit/things2do.htm',
      'https://www.nps.gov/yose/planyourvisit/index.htm',
    ],
  },
  {
    id: 'yell',
    name: 'Yellowstone',
    fullName: 'Yellowstone National Park',
    states: ['Wyoming', 'Montana', 'Idaho'],
    activities: [
      'wildlife watching',
      'hiking',
      'fishing',
      'camping',
      'biking',
      'winter sports',
      'paddling',
      'ranger programs',
    ],
    signature: ['wildlife watching', 'hiking'],
    season: {
      openAllYear: true,
      note: 'Open all year, but services are limited from early November through late April, and most facilities run May to October.',
      fullAccess: [5, 6, 7, 8, 9, 10],
      limited: [11, 12, 1, 2, 3, 4],
      highlighted: [],
    },
    highlight: 'Geysers and hot springs, and the easiest wildlife watching of any park.',
    sources: [
      'https://www.nps.gov/yell/planyourvisit/hours.htm',
      'https://www.nps.gov/yell/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'glac',
    name: 'Glacier',
    fullName: 'Glacier National Park',
    states: ['Montana'],
    activities: [
      'scenic driving',
      'hiking',
      'camping',
      'fishing',
      'paddling',
      'biking',
      'winter sports',
      'ranger programs',
    ],
    signature: ['scenic driving', 'hiking'],
    season: {
      openAllYear: true,
      note: 'Open all year, but the season runs late May through September, and Going-to-the-Sun Road is usually fully open from late June until the third Monday in October.',
      fullAccess: [7, 8, 9],
      limited: [10, 11, 12, 1, 2, 3, 4, 5, 6],
      highlighted: [7, 8, 9],
    },
    highlight: 'Going-to-the-Sun Road climbing over the Continental Divide to Logan Pass.',
    sources: [
      'https://www.nps.gov/glac/planyourvisit/hours.htm',
      'https://www.nps.gov/glac/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'grca',
    name: 'Grand Canyon',
    fullName: 'Grand Canyon National Park',
    states: ['Arizona'],
    activities: ['hiking', 'scenic driving', 'paddling', 'biking', 'ranger programs'],
    signature: ['hiking', 'scenic driving'],
    season: {
      openAllYear: true,
      note: 'The South Rim is open around the clock all year, and reservations are recommended in spring, summer and fall.',
      fullAccess: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      limited: [],
      highlighted: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    },
    highlight: 'A mile deep and ten miles across, with the rim walk open every day of the year.',
    sources: [
      'https://www.nps.gov/grca/planyourvisit/hours.htm',
      'https://www.nps.gov/grca/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'ever',
    name: 'Everglades',
    fullName: 'Everglades National Park',
    states: ['Florida'],
    activities: [
      'paddling',
      'wildlife watching',
      'fishing',
      'hiking',
      'camping',
      'biking',
      'stargazing',
      'ranger programs',
    ],
    signature: ['paddling', 'wildlife watching'],
    season: {
      openAllYear: true,
      note: 'Open every day. In the dry season from November through March wildlife is plentiful and ranger programs are widely available; the wet season runs April through October with fewer programs.',
      fullAccess: [11, 12, 1, 2, 3],
      limited: [4, 5, 6, 7, 8, 9, 10],
      highlighted: [11, 12, 1, 2, 3],
    },
    highlight:
      'Sawgrass, mangroves and paddling trails, with a month of night-sky events every April.',
    sources: [
      'https://www.nps.gov/ever/planyourvisit/hours.htm',
      'https://www.nps.gov/ever/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'katm',
    name: 'Katmai',
    fullName: 'Katmai National Park and Preserve',
    states: ['Alaska'],
    activities: [
      'wildlife watching',
      'fishing',
      'hiking',
      'camping',
      'paddling',
      'ranger programs',
    ],
    signature: ['fishing', 'wildlife watching'],
    season: {
      openAllYear: false,
      note: 'Services at Brooks Camp run from the first of June to mid-September. Prime bear viewing is July and September, and most visitors come between June and October.',
      fullAccess: [6, 7, 8, 9],
      limited: [10, 11, 12, 1, 2, 3, 4, 5],
      highlighted: [7, 9],
    },
    highlight: 'Brown bears fishing for salmon at Brooks Falls, a short flight from Anchorage.',
    sources: [
      'https://www.nps.gov/katm/planyourvisit/hours.htm',
      'https://www.nps.gov/katm/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'grba',
    name: 'Great Basin',
    fullName: 'Great Basin National Park',
    states: ['Nevada'],
    activities: ['stargazing', 'hiking', 'fishing', 'camping', 'winter sports', 'ranger programs'],
    signature: ['stargazing', 'camping'],
    season: {
      openAllYear: true,
      note: 'The grounds are open around the clock all year to hiking, stargazing and camping. Summer has the best stargazing, fall colour starts in the second or third week of September, and winter brings snow for skiing and snowshoeing.',
      fullAccess: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      limited: [],
      highlighted: [6, 7, 8, 9],
    },
    highlight: 'Among the darkest night skies in the country, plus Lehman Caves and bristlecones.',
    sources: [
      'https://www.nps.gov/grba/planyourvisit/hours.htm',
      'https://www.nps.gov/grba/learn/nature/lightscape.htm',
      'https://www.nps.gov/grba/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'acad',
    name: 'Acadia',
    fullName: 'Acadia National Park',
    states: ['Maine'],
    activities: [
      'hiking',
      'biking',
      'wildlife watching',
      'stargazing',
      'paddling',
      'ranger programs',
    ],
    signature: ['biking', 'hiking'],
    season: {
      openAllYear: false,
      note: 'The Park Loop Road is open from the middle of April to the first of December, most facilities run May through October, and the Schoodic roads stay open all year.',
      fullAccess: [5, 6, 7, 8, 9, 10],
      limited: [11, 12, 1, 2, 3, 4],
      highlighted: [],
    },
    highlight: 'Granite coast, forty-five miles of carriage roads, and tide pools at low tide.',
    sources: [
      'https://www.nps.gov/acad/planyourvisit/hours.htm',
      'https://www.nps.gov/acad/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'zion',
    name: 'Zion',
    fullName: 'Zion National Park',
    states: ['Utah'],
    activities: [
      'hiking',
      'climbing',
      'biking',
      'camping',
      'stargazing',
      'wildlife watching',
      'ranger programs',
    ],
    signature: ['climbing', 'hiking'],
    season: {
      openAllYear: true,
      note: 'Open around the clock every day of the year. A free shuttle runs up Zion Canyon for most of the year, and while it runs, cars cannot drive the scenic drive.',
      fullAccess: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      limited: [],
      highlighted: [],
    },
    highlight: 'Sandstone walls a thousand feet high, the Narrows, and permits for canyoneering.',
    sources: [
      'https://www.nps.gov/zion/planyourvisit/hours.htm',
      'https://www.nps.gov/zion/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'romo',
    name: 'Rocky Mountain',
    fullName: 'Rocky Mountain National Park',
    states: ['Colorado'],
    activities: ['hiking', 'wildlife watching', 'scenic driving', 'camping', 'ranger programs'],
    signature: ['scenic driving', 'hiking'],
    season: {
      openAllYear: true,
      note: 'Open all year, weather permitting, but Trail Ridge Road is closed to through travel from the middle of October to late May. Timed entry reservations apply from late May through October.',
      fullAccess: [6, 7, 8, 9, 10],
      limited: [11, 12, 1, 2, 3, 4, 5],
      highlighted: [6, 7, 8, 9, 10],
    },
    highlight: 'Trail Ridge Road climbing above the treeline once the snow clears in late May.',
    sources: [
      'https://www.nps.gov/romo/planyourvisit/hours.htm',
      'https://www.nps.gov/romo/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'olym',
    name: 'Olympic',
    fullName: 'Olympic National Park',
    states: ['Washington'],
    activities: [
      'hiking',
      'wildlife watching',
      'fishing',
      'paddling',
      'camping',
      'stargazing',
      'winter sports',
      'ranger programs',
    ],
    signature: ['hiking', 'fishing'],
    season: {
      openAllYear: true,
      note: 'Open around the clock all year. From October through May some roads, campgrounds and facilities are closed or on reduced hours, and the most popular months are June through September.',
      fullAccess: [6, 7, 8, 9],
      limited: [10, 11, 12, 1, 2, 3, 4, 5],
      highlighted: [6, 7, 8, 9],
    },
    highlight:
      'Rainforest, wild coast and glaciated peaks in one park, with fishing in all seasons.',
    sources: [
      'https://www.nps.gov/olym/planyourvisit/hours.htm',
      'https://www.nps.gov/olym/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'jotr',
    name: 'Joshua Tree',
    fullName: 'Joshua Tree National Park',
    states: ['California'],
    activities: [
      'climbing',
      'hiking',
      'stargazing',
      'camping',
      'biking',
      'wildlife watching',
      'ranger programs',
    ],
    signature: ['climbing', 'stargazing'],
    season: {
      openAllYear: true,
      note: 'Summers are hot, over a hundred degrees in the day and not much below seventy five at night. Temperatures are most comfortable in spring and fall.',
      fullAccess: [1, 2, 3, 4, 5, 10, 11, 12],
      limited: [6, 7, 8, 9],
      highlighted: [3, 4, 5, 10, 11],
    },
    highlight: 'Eight thousand climbing routes, Joshua trees, and outstanding night skies.',
    sources: [
      'https://www.nps.gov/jotr/planyourvisit/hours.htm',
      'https://www.nps.gov/jotr/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'grsm',
    name: 'Great Smoky Mountains',
    fullName: 'Great Smoky Mountains National Park',
    states: ['Tennessee', 'North Carolina'],
    activities: ['hiking', 'wildlife watching', 'fishing', 'scenic driving', 'camping', 'biking'],
    signature: ['wildlife watching', 'fishing'],
    season: {
      openAllYear: true,
      note: 'Open around the clock, every day of the year. Some secondary roads, campgrounds and visitor centres follow seasonal schedules.',
      fullAccess: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      limited: [],
      highlighted: [],
    },
    highlight:
      'Twenty nine hundred miles of streams, black bears and elk, and the Cades Cove loop.',
    sources: [
      'https://www.nps.gov/grsm/planyourvisit/hours.htm',
      'https://www.nps.gov/grsm/planyourvisit/things2do.htm',
    ],
  },
  {
    id: 'brca',
    name: 'Bryce Canyon',
    fullName: 'Bryce Canyon National Park',
    states: ['Utah'],
    activities: [
      'hiking',
      'scenic driving',
      'camping',
      'biking',
      'winter sports',
      'ranger programs',
    ],
    signature: ['hiking', 'winter sports'],
    season: {
      openAllYear: true,
      note: 'The park is open around the clock all year. The most popular months are May through September, the shuttle runs from April into October, and winter storms can close roads until they are plowed.',
      fullAccess: [4, 5, 6, 7, 8, 9, 10],
      limited: [11, 12, 1, 2, 3],
      highlighted: [5, 6, 7, 8, 9],
    },
    highlight: 'Hoodoos below the rim, and cross country skiing along it once the snow falls.',
    sources: [
      'https://www.nps.gov/brca/planyourvisit/hours.htm',
      'https://www.nps.gov/brca/planyourvisit/things2do.htm',
    ],
  },
];

/** Every activity that at least one park offers, for the tool schema's enum. */
export const OFFERED_ACTIVITIES: Activity[] = ACTIVITIES.filter((a) =>
  PARKS.some((p) => p.activities.includes(a)),
);
