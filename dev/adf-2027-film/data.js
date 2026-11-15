// Every figure here is from the deck: Atlanta Design Festival 2027 — Direction, September 2026.
// Weekly values are the increments behind slide 03's cumulative curve; the three percentages the deck
// states (60 / 78 / 10) hold exactly against these numbers.

export const WEEKS = [
  { label: '−12', v: 100 },
  { label: '−11', v: 20 },
  { label: '−10', v: 80 },
  { label: '−9', v: 250 },
  { label: '−8', v: 500 },
  { label: '−7', v: 100 },
  { label: '−6', v: 100 },
  { label: '−5', v: 150 },
  { label: '−4', v: 120 },
  { label: '−3', v: 780 },
  { label: '−2', v: 900 },
  { label: '−1', v: 2730 },
  { label: 'EVENT', v: 8855 },
];
export const TOTAL = 14685;            // deck: 2026 closed at $14,685 on 407 tickets
export const FIRST_NINE = 1420;        // deck: 10% was in at four weeks out

export const YEARS = [
  { label: 'PEAK', v: 50000, s: '$50,000' },
  { label: '2024', v: 24000, s: '$24,000' },
  { label: '2025', v: 10000, s: '$10,000' },
  { label: '2026', v: 14685, s: '$14,685' },
];

export const REASONS = [
  { n: '01', t: 'ONE CHANNEL, AND IT IS SPENT', s: 'A single list of 9,000, remarketed annually' },
  { n: '02', t: 'NO TOP OF THE FUNNEL', s: 'Every ADF product is paid' },
  { n: '03', t: 'AN ORGANISATION OF INDIVIDUALS', s: 'No entity, no board, no continuity' },
  { n: '04', t: 'TWO PEOPLE CANNOT PROGRAM EIGHT DISCIPLINES', s: 'The ones outside our interests are absent' },
];

// The seventeen, by discipline, as the deck's field diagram lists them.
export const INSTITUTIONS = [
  { n: 'AIA ATLANTA', d: 'ARCHITECTURE' },
  { n: 'GT SCHOOL OF ARCHITECTURE', d: 'ARCHITECTURE' },
  { n: 'KENNESAW STATE', d: 'ARCHITECTURE' },
  { n: 'ARCHITECTURE + DESIGN CENTER', d: 'ARCHITECTURE' },
  { n: 'ADAC', d: 'INTERIORS' },
  { n: 'ASID GEORGIA', d: 'INTERIORS' },
  { n: 'IIDA GEORGIA', d: 'INTERIORS' },
  { n: 'AMERICAN CRAFT COUNCIL', d: 'CRAFT' },
  { n: 'ATLANTA FILM FESTIVAL', d: 'FILM + MEDIA' },
  { n: 'ATLANTA TECHNICAL COLLEGE', d: 'FILM + MEDIA' },
  { n: 'AIGA ATLANTA', d: 'GRAPHICS' },
  { n: 'SEGD ATLANTA', d: 'GRAPHICS' },
  { n: 'THE HIGH', d: 'ART + MUSEUMS' },
  { n: 'MODA', d: 'ART + MUSEUMS' },
  { n: 'SPELMAN', d: 'ART + MUSEUMS' },
  { n: 'GT SCHOOL OF INDUSTRIAL DESIGN', d: 'INDUSTRIAL' },
  { n: 'IDSA ATLANTA', d: 'INDUSTRIAL' },
];

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const FESTIVAL_MONTHS = [8, 9];   // Sept 25 – Oct 3

export const SHAPE = [
  { n: '1', t: 'SOMETHING FREE AND PUBLIC', s: 'Programd by partners, not produced by us' },
  { n: '2', t: 'EVERYONE WHO ATTENDS BECOMES A CONTACT', s: 'The value is the audience it registers' },
  { n: '3', t: 'SPONSORSHIP BECOMES SALEABLE', s: 'Several thousand people is a proposition' },
  { n: '4', t: 'THE PAID PRODUCTS MONETISE IT', s: 'Sold to people who just arrived' },
];

export const MONEY = [
  { t: 'MEMBERSHIP', v: '$750 – $2,500', s: 'Funds the platform. Recurring', w: 2 },
  { t: 'SPONSORSHIP', v: '$4,500 – $15,000', s: 'Funds the free event', w: 4 },
  { t: 'IN KIND', v: 'NO CASH', s: 'Closes fastest', w: 1 },
];

export const DOORS = [
  {
    k: 'A', t: 'STAY AS WE ARE', s: 'A COMMUNITY FESTIVAL, MODEST AND LOCAL, RUN ON GOODWILL',
    s2: 'Success is turnout. A legitimate answer, and it needs no structure, no council and no outside help.',
  },
  {
    k: 'B', t: 'CONVENE THE CITY', s: 'A FEDERATED PLATFORM, SEVENTEEN INSTITUTIONS BEHIND IT',
    s2: 'Something free at the top, the tours as the commercial engine, and a festival that outlasts us.',
  },
];
