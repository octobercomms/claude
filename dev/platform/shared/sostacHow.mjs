// How to do a SOSTAC phase, before anyone has tailored anything.
//
// Every item in the stock playbook said what to do and nothing about how. The
// guidance under an item is written per client at tailor time, because "audit
// the funnel" means something different for a tour operator and a furniture
// brand, so an untailored plan showed forty bare lines.
//
// The first attempt at fixing that added a paragraph explaining that the
// guidance would arrive later, which is not guidance. This is: the method for
// each of the six phases, and the screens in OMI that do the work. It is
// deliberately phase-level rather than item-level — a stock item has no client
// behind it, so item-level advice would be invented, and invented advice reads
// exactly like real advice. Phase-level advice is true for every item in the
// phase and says so.
//
// An item's own `how`, written at tailor time, replaces this. Where both
// exist, the tailored steps win: they know the client.

export const PHASES = [
  'Situation Analysis', 'Objectives', 'Strategy', 'Tactics', 'Action', 'Control',
];

const HOW = {
  'Situation Analysis': {
    aim: 'Write down where the client actually is, with numbers, before anyone proposes anything.',
    steps: [
      'Owned → Dashboard for traffic and rankings, Paid → Measure for spend, CAC and revenue. Take the last 12 months, not the last month: one bad month is weather, a year is climate.',
      'Owned → Quick wins ranks the pages and keywords losing position by what they cost. Note the three biggest by traffic lost, not by position.',
      'Earned → Coverage is every story they have had; Database → Journalists is everyone who has replied. Those two lists are the honest measure of their press standing.',
      'Dashboard → Setup names their competitors. Check each in Paid → Competitors to see what is actually running, and Owned → Gap for the terms they own that the client does not.',
      'Finish with one paragraph the client would recognise as their own business. If it could describe any company in the sector, it is not an audit yet.',
    ],
    omi: 'Owned → Dashboard, Owned → Quick wins, Owned → Gap, Paid → Measure, Paid → Competitors, Earned → Coverage, Database → Journalists',
  },
  'Objectives': {
    aim: 'Turn the situation into numbers someone can be held to.',
    steps: [
      'Take the baseline from the situation work and put a figure against it with a date. "More leads" is not an objective; "140 enquiries a month by March" is.',
      'Set the money first, revenue or enquiries, then the cost of getting it: target CAC, or ROAS where they buy on a platform. Paid → Measure holds what both currently run at.',
      'Add one leading indicator that moves before revenue does, so there is something to read in week three rather than month three. List growth, first-page rankings, or replies to pitches.',
      'Write what you will NOT chase this quarter. An objective with nothing excluded is a wish list.',
      'Tailoring the strategy writes these into the plan as objectives, and Dashboard → Measure then reads against them rather than against memory.',
    ],
    omi: 'Dashboard → Measure, Paid → Measure',
  },
  'Strategy': {
    aim: 'Decide who you are talking to, what you are saying, and where. Three decisions, not a plan.',
    steps: [
      'Pick the segment to win first, from Paid → Segments and Paid → ICP. One segment. A strategy that serves everyone serves nobody and costs four times as much to run.',
      'Paid → Customers is who actually buys, which is often not who the client says buys. Check the two against each other before committing.',
      'Write the positioning in a sentence the client could say out loud to a customer. If it needs a second sentence to make sense, it is not positioning yet.',
      'Rank the channels by where that segment already is, not by what the agency is good at. The situation work tells you; so does asking five customers.',
      'Set the PESO balance on Dashboard → Measure: how much of the result comes from paid, earned, shared and owned. That decides the budget split and the staffing.',
    ],
    omi: 'Paid → ICP, Paid → Segments, Paid → Customers, Dashboard → Measure',
  },
  'Tactics': {
    aim: 'The specific things that get made and run. Where the strategy becomes work.',
    steps: [
      'For each channel in the strategy, list what gets made: campaigns, pages, posts, pitches. Name the deliverable, not the activity.',
      'Paid → Brief turns the positioning into ad concepts, then Draft, Render and Launch. Shared → Create does the same for social. Earned → Campaigns is the press pitch, against an audience from Earned → Match.',
      'Owned → Brief and Owned → Draft cover the content side; Owned → Quick wins says which pages to do first.',
      'Fix the measurement before the first thing goes live: Dashboard → Connectors for the data, and the conversion tracking itself. A tactic you cannot measure is a tactic you cannot defend.',
      'Keep the list short enough to finish. Six tactics done beats twenty started, and the twenty are what agencies get fired for.',
    ],
    omi: 'Paid → Brief, Paid → Launch, Shared → Create, Earned → Campaigns, Earned → Match, Owned → Brief, Dashboard → Connectors',
  },
  'Action': {
    aim: 'Who does what, by when, for how much. The part that makes the plan happen.',
    steps: [
      'Put every tactic on a calendar with an owner and a date. Shared → Schedule holds the social calendar; a tactic with no owner is a tactic that does not happen.',
      'Set the budget against each line, and say what comes out if the budget is cut. Deciding that now is cheaper than deciding it in a panic.',
      'Brief the creative in writing, with examples. Paid → Brief and Shared → Create both take one; a verbal brief gets made twice.',
      'Agree the cadence: when work is reviewed, when the client sees it, when it goes live. Shared → Review is the client-facing step. Weekly is usually right; monthly is too slow to fix anything.',
      'Name the dependencies that sit with the client — approvals, assets, access — and get dates for those too. They are the usual reason a quarter slips.',
    ],
    omi: 'Shared → Schedule, Shared → Review, Paid → Brief, Dashboard → Reports',
  },
  'Control': {
    aim: 'Read the numbers often enough to change course while it still matters.',
    steps: [
      'Review weekly against the objectives, not against last week. Dashboard → Measure pulls the figures; the weekly read is twenty minutes, not a meeting.',
      'Each week, name the single biggest drop-off and fix that one. Owned → Quick wins and Paid → Measure both rank problems by what they cost.',
      'Shared → Learn says which posts worked and why, which is what the next batch is briefed from.',
      'Kill what is not working at the point you can prove it, not at the end of the quarter. Write down in advance what proof would look like, or it never arrives, and reinvest what you cut into what is working.',
      'Monthly, Dashboard → Reports is the record of what changed and why. Next quarter is planned from that; without it, it is planned from memory.',
    ],
    omi: 'Dashboard → Measure, Dashboard → Reports, Paid → Measure, Owned → Quick wins, Shared → Learn',
  },
};

/** The stock method for a phase, or null for a phase name we do not know. */
export function howFor(phase) {
  return HOW[String(phase || '').trim()] || null;
}

/** Does this item already carry guidance written for the client? */
export function hasTailoredHow(item) {
  return Array.isArray(item?.how) && item.how.length > 0;
}

/** Every phase has a method, which is the one thing that must stay true. */
export function coverage() {
  return PHASES.map((p) => ({ phase: p, covered: !!HOW[p] }));
}

export default HOW;
