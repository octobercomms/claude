// A whole proposal, filled in, for a practice that does not exist.
//
// It renders through the real ProposalDocument component, so this is not a mock
// of the proposal: it is the proposal, with the data a real one carries. That
// matters for judging it, because the question is never "does the layout work"
// but "does this read like Daniel wrote it, and is it too long". Lorem ipsum
// cannot answer either, so every field holds content of the length the engine
// actually produces.
//
// Thurloe Studio, Marianne Okafor and Stephen Reid, the Petersham barn and
// Carlingford Road. Invented, and deliberately recognisable as invented, so a
// sample is never mistaken for a client's proposal.
//
// The four blocks under `content` are the ones written per prospect. Everything
// under `offer` comes from the method, which is why it reads the same in every
// proposal and why it is edited once in Settings rather than per deal.

export const SAMPLE_PROPOSAL = {
  status: 'sent',
  recipient_names: 'Marianne and Stephen',
  accepted: false,
  contact_email: 'dn@octobercomms.com',
  terms_url: 'https://octobercomms.com/terms-and-conditions/',

  content: {
    company_name: 'Thurloe Studio',
    date_label: 'October 2026',
    cover_image: null,
    currency: '£',

    // Written per prospect: about them and the call, not the diagnosis.
    letter: [
      'Thank you for Tuesday. What came through was that the work you are proudest of is the part nobody outside the practice has read: two years of planning on the Petersham barn, a conservation officer talked round rather than fought, and not a word of it published anywhere a prospective client would find it.',
      'The enquiries you described, extensions under a hundred thousand, are not a lead generation problem. They are what happens when the only evidence of your range is a grid of photographs that treats a barn conversion and a side return exactly the same. This proposal fixes the evidence first, because the press and the search positions follow from it rather than the other way round.',
    ],

    // Written per prospect: the diagnosis, evidence-led.
    situation: [
      'The site shows eleven projects. Nine are photographed from the garden at the same hour, with captions that give the borough and nothing else. Petersham, which took two years and a planning appeal, carries the caption "barn conversion, Richmond" and sits sixth in the grid, below two side returns. Nothing on the page tells a reader that one of these projects was harder, larger or more valuable than the others.',
      'That is a storytelling and positioning problem, not a press problem. A journalist covering conservation work cannot pitch Petersham from what is published, because the planning narrative that makes it a story is not written down anywhere. Nor can a prospective client with a two-year listed-building project conclude you have done one.',
      'In search the consequence is measurable. Thurloe appears in the top ten for "architect Richmond" and "loft conversion architect", and nowhere in the first five pages for "conservation area architect", "listed building architect" or "barn conversion architect". The three terms you are invisible for are the three that describe the work you want. The two you rank for describe the work you said is clogging the diary.',
      'The AI answers follow the same pattern. Asked to name architects for a listed barn in south west London, neither ChatGPT nor Perplexity returns Thurloe, because there is no published account of that capability for either of them to cite. They name three practices whose project pages carry the planning detail yours leaves out.',
      'Carlingford Road completes in spring, which sets the clock. A project is publishable for roughly a quarter after completion and then becomes an archive entry. If the photography, the planning narrative and the press approaches are not ready when it finishes, the practice spends another year being found for side returns.',
    ],

    // Written per prospect: the one thing first.
    priority: {
      title: 'Publish Petersham properly, before anything else',
      text: 'One project, documented in full: the planning constraint, the structural decision, the before and after, the client in their own words, photography credited and cleared for press. That single page is the search asset, the press offer and the credibility proof a higher-bracket prospect needs, and everything in the quarter after it is easier because it exists. Petersham rather than Carlingford because it is finished, photographed and appealable: we are not waiting on a building site to start.',
    },

    email_subject: 'your proposal, as discussed',
    email_note: 'Marianne, the proposal is in the link below and it leads with the barn, as we talked about. I have put the planning narrative in month two rather than month one so the photography clearance has time to come back. Have a read and tell me what you would change.',
  },

  // From the method. Identical in every proposal that sells this level, which is
  // what makes it a product rather than bespoke consulting, and what means
  // improving this copy once improves every future proposal.
  offer: {
    slug: 'advanced',
    name: 'Earning Visibility · Advanced',
    family: 'Earning Visibility Method',
    version: 1,
    currency: 'GBP',
    symbol: '£',
    monthly: 1870,            // from the redesign's own pricing table, the level it marks most popular
    setup: 0,
    blurb: 'The level most practices take, and the one marked most popular on our pricing: three to four initiatives a quarter rather than two, paid support where it helps, and a live dashboard alongside the weekly report.',
    includes: [
      'Quarterly visibility audit across search, AI answers, press and referral',
      'Three to four active initiatives a quarter',
      'Press outreach, SEO and content, with paid support where it helps',
      'A written plan of work, rebuilt every quarter',
      'Weekly reporting plus a live dashboard, and a direct line for in-quarter changes',
    ],

    objectives: {
      short: 'Three projects documented and published, with the planning narrative written for search and cleared for press.',
      mid: 'Named coverage in the trade and design press, and top-ten positions for the project types you want to be found for.',
      long: 'Enquiries arriving pre-qualified at the project value you want, because the published work has already answered what you do and at what scale.',
    },

    // Two tiers. Commitments are October's own output, so they are promises
    // that can be kept. Reported measures are the outcome, which is influenced
    // and not controlled: promising press coverage to someone who has bought PR
    // before reads as naive or dishonest, and neither converts.
    kpis: {
      committed: [
        'Three to four active initiatives a quarter, across press, SEO, content and paid',
        'A written plan of work, rebuilt every quarter',
        'Weekly reporting plus a live dashboard, against every measure below',
      ],
      reported: [
        'Share of enquiries above £400,000. Currently one in ten, from your own enquiry form',
        'Enquiries from search for conservation and barn conversion work, against the same month last year',
        'Named-outlet coverage secured, and the referring links it carries',
        'Positions in the top ten for the six project types you want to be found for. Currently two of six',
        'Branded and direct search volume, which is the only honest awareness number',
      ],
      close: 'If the second list is not moving by the end of the first quarter we change the tactics, not the invoice.',
    },

    strategy: [
      { title: 'Evidence before outreach', text: 'Nothing is pitched that is not published. A journalist needs a story they can see, and a prospect needs proof they can read, so the documented project comes first and the press approach follows it.' },
      { title: 'Depth over volume', text: 'Three projects written properly beat eleven captioned. Each one carries the planning narrative, the constraint, the decision and the client in their own words, which is what search, AI answers and editors all reward.' },
      { title: 'Name the bracket', text: 'The site currently treats every project as equivalent. We separate the work that evidences range from the work that fills the diary, so a reader can tell within one screen what scale of project the practice handles.' },
      { title: 'Compound, do not restart', text: 'Each quarter builds on the audit baseline rather than starting a new campaign. What worked continues, what did not is replaced by the next priority.' },
    ],

    tactics: [
      { heading: 'documentation', items: ['Full write-up of three projects a quarter', 'Planning and structural narrative written for search', 'Client interview and quote, cleared', 'Photography briefed, credited and cleared for press use'] },
      { heading: 'press', items: ['Twelve named approaches a month to relevant trade and design press', 'List shared before it goes out', 'Exclusives offered where a project warrants one', 'Coverage logged with its referring links'] },
      { heading: 'search and ai answers', items: ['Project pages structured for the terms that describe your target work', 'Practice and project schema so AI answers have something to cite', 'Position tracking for six project types, reported weekly'] },
      { heading: 'reporting', items: ['Weekly report and a live dashboard', 'Quarterly audit against the baseline', 'Written plan of work rebuilt before each quarter'] },
    ],

    stages: [
      { stage: '01', when: 'month one', title: 'the audit', text: 'We check where the practice is visible right now across search, AI answers, press and referral networks, rather than assuming. This sets the baseline every quarter is measured against.' },
      { stage: '02', when: 'month two', title: 'the priority', text: 'The audit points to one lever that matters most right now. That becomes the plan of work, delivered in writing before the quarter starts, and it gets full attention.' },
      { stage: '03', when: 'month three', title: 'the review', text: 'Reported weekly throughout and reviewed against the gap named in month one. What worked continues, what did not gets replaced by the next priority, and the cycle repeats, compounding each quarter.' },
    ],
  },

  // Matched from the proof library by sector and by the problem the situation
  // names. The case study is the item October has none of yet, so this is what
  // one should look like when Daniel writes them.
  proof: {
    case_study: {
      id: 'sample-cs',
      kind: 'case_study',
      title: 'Hartwell & Co, residential architecture',
      body: 'Six years of conservation-area work and no published account of any of it, so enquiries were arriving for the smallest projects on the site. October documented three projects in full, with the planning narrative written for search, and offered two of them to trade press. Three national placements followed in six months. Enquiries above £400,000 rose from one in ten to four in ten across the following year.',
      attribution: 'Residential practice, eleven staff, south west London',
      url: null,
    },
    testimonial: {
      id: 'sample-t',
      kind: 'testimonial',
      title: 'Priya Hartwell, Hartwell & Co',
      body: 'The difference was that Daniel asked about the planning decisions, not the finishes. Nobody had written our work up that way before.',
      attribution: 'Priya Hartwell, Director, Hartwell & Co',
    },
    press: {
      id: 'sample-p',
      kind: 'press',
      title: 'Wallpaper*: Arcade at Battersea Power Station',
      body: 'Exclusive feature in Wallpaper* for Red Deer, July 2023.',
      attribution: 'Red Deer, July 2023',
    },
    // The counted record. Checkable, nobody else in the sector publishes it,
    // and each figure carries the source it came from, which is what makes the
    // proof block read as fact rather than marketing.
    credentials: [
      { id: 'sample-f1', kind: 'credential', figure: '22', title: 'Countries where client work has been published', body: 'On six continents.', source: 'October\u2019s editorial log, March 2023 to April 2026' },
      { id: 'sample-f2', kind: 'credential', figure: '216', title: 'Pieces of published coverage', body: 'March 2023 to April 2026.', source: 'October\u2019s editorial log, March 2023 to April 2026' },
      { id: 'sample-f3', kind: 'credential', figure: '150', title: 'Outlets placed in', body: 'National newspapers to trade and design titles.', source: 'October\u2019s editorial log, March 2023 to April 2026' },
      { id: 'sample-f4', kind: 'credential', figure: '18', title: 'Clients with published coverage', body: 'Furniture makers to architecture practices and festivals.', source: 'October\u2019s editorial log, March 2023 to April 2026' },
      { id: 'sample-c1', kind: 'credential', title: 'Published in', body: 'Wallpaper*, Monocle, Financial Times, The Times, The Observer, Dwell, Dezeen, Domus and Travel + Leisure, among 150 others.' },
      { id: 'sample-c2', kind: 'credential', title: 'Founded 2013 \u00b7 RSA Fellow \u00b7 IBP member', body: 'Director elected Fellow of the Royal Society of Arts in 2012. Shortlisted for Best Digital Team at the Archiboo Awards.' },
    ],
  },
};
