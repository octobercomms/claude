// What the section panel holds, for every section.
//
// One directory per section, rendered as a narrow panel beside the nav rather
// than a horizontal strip above the page. The strip is why Owned ended up with
// its tools two levels deep inside accordions: 29 destinations do not fit a
// row, so they got folded away, and a page that holds four jobs needs an
// accordion to separate them. Give each job a row with its own ?tab= and the
// accordion has nothing left to do.
//
// This file is the single source of truth. It is deliberately literal — a row
// per destination, written out — so that a destination with no way in shows up
// as a missing line here rather than as a working page nobody can open. That
// failure has happened in this codebase three times. tests/sectionPanel.test.mjs
// checks it both ways: every tab a page accepts has a row, and every row names
// a tab that page accepts.
//
//   base       — the route the rows hang off
//   defaultTab — what the page shows when ?tab= is absent, so the right row
//                lights up on a bare URL
//   groups     — { heading, rows }. A heading of null renders the rows with no
//                label above them, for a group of one.
//   rows       — { tab, label, step?, when? }
//                step  numbers a genuine sequence (a vertical list cannot show
//                      order the way a strip can, so it has to say it)
//                when  gates a row on the viewer, for the handful that are
//                      role- or grant-dependent

// `ctx` is { readOnly, canVisualise }.
const agencyOnly = (ctx) => !ctx.readOnly;

export const SECTIONS = {
  paid: {
    key: 'paid',
    title: 'Paid',
    base: (id) => `/clients/${id}/ads`,
    defaultTab: 'measure',
    groups: [
      { heading: null, rows: [{ tab: 'measure', label: 'Measure' }] },
      { heading: 'Build', rows: [
        { tab: 'brief',    label: 'Brief',    step: 1 },
        { tab: 'concepts', label: 'Draft',    step: 2 },
        { tab: 'render',   label: 'Render',   step: 3 },
        { tab: 'approve',  label: 'Approve',  step: 4 },
        { tab: 'launch',   label: 'Launch',   step: 5 },
      ] },
      { heading: 'Research', rows: [
        { tab: 'competitor_ads', label: 'Competitors' },
        { tab: 'audiences',      label: 'Audiences' },
        { tab: 'library',        label: 'Library' },
      ] },
    ],
  },

  earned: {
    key: 'earned',
    title: 'Earned',
    base: (id) => `/clients/${id}/pr`,
    defaultTab: 'coverage',
    groups: [
      // Track was behind a "Health" tab that held one thing. It is the page.
      { heading: null, rows: [{ tab: 'coverage', label: 'Track' }] },
      { heading: 'Build', rows: [
        { tab: 'journalists', label: 'Pitch' },
        { tab: 'press',       label: 'Releases' },
      ] },
      { heading: 'Measure', rows: [
        { tab: 'reports', label: 'Reports' },
      ] },
    ],
  },

  shared: {
    key: 'shared',
    title: 'Shared',
    base: (id) => `/clients/${id}/social`,
    defaultTab: 'perf_insights',
    groups: [
      { heading: 'Capture', rows: [
        // Side by side was a workaround for the swipe list burying Reddit.
        // Separate rows fix that directly, and they do different jobs.
        { tab: 'swipe',     label: 'Swipe' },
        { tab: 'subreddit', label: 'Reddit' },
      ] },
      { heading: 'Create', rows: [
        { tab: 'brainstorm', label: 'Ideas',    step: 1 },
        { tab: 'review',     label: 'Brief',    step: 2 },
        { tab: 'reels',      label: 'Workbench', step: 3 },
        { tab: 'plans',      label: 'Plan',     step: 4 },
        { tab: 'publish',    label: 'Publish',  step: 5 },
      ] },
      // Engage held the DM bot and the feed, which is two jobs. The bot is a
      // drawer now, so the group has one job and can take its name.
      { heading: null, rows: [{ tab: 'discover', label: 'Discover' }] },
      { heading: 'Measure', rows: [
        { tab: 'perf_insights', label: 'Review' },
        { tab: 'performance',   label: 'Learn' },
        { tab: 'competitors',   label: 'Compare' },
        { tab: 'audit',         label: 'Improve' },
      ] },
    ],
  },

  owned: {
    key: 'owned',
    title: 'Owned',
    base: (id) => `/clients/${id}/seo`,
    defaultTab: 'health',
    groups: [
      { heading: null, rows: [{ tab: 'health', label: 'Dashboard' }] },
      { heading: 'Watch', rows: [
        { tab: 'perf_insights',  label: 'Insights' },
        { tab: 'keywords',       label: 'Keywords' },
        { tab: 'gsc',            label: 'Search Console' },
        { tab: 'ai_visibility',  label: 'AI visibility' },
        { tab: 'authority',      label: 'Authority' },
        { tab: 'backlinks',      label: 'Backlinks' },
        { tab: 'drift',          label: 'Drift' },
      ] },
      { heading: 'Fix', rows: [
        { tab: 'site_audit',        label: 'Site audit' },
        { tab: 'content_audit',     label: 'Content audit' },
        { tab: 'keyword_footprint', label: 'Keyword footprint' },
        { tab: 'quick_wins',        label: 'Quick wins' },
        { tab: 'ctr_boost',         label: 'CTR boost' },
        { tab: 'ai_seo',            label: 'AI SEO' },
        { tab: 'agent_ready',       label: 'Agent ready' },
      ] },
      { heading: 'Produce', rows: [
        { tab: 'topic_map', label: 'Topic map', step: 1 },
        { tab: 'find',      label: 'Find',      step: 2 },
        { tab: 'planning',  label: 'Brief',     step: 3 },
        { tab: 'draft',     label: 'Draft',     step: 4 },
        { tab: 'publish',   label: 'Publish',   step: 5 },
        { tab: 'promote',   label: 'Promote',   step: 6 },
      ] },
      { heading: 'Local', rows: [
        { tab: 'local_gap',      label: 'Gap' },
        { tab: 'local_schema',   label: 'Schema' },
        { tab: 'local_keywords', label: 'Keywords' },
        { tab: 'local_xray',     label: 'X-ray' },
        { tab: 'local_playbook', label: 'Playbook' },
        { tab: 'local_outliers', label: 'Outliers' },
        { tab: 'local_gbp',      label: 'Google Business' },
      ] },
    ],
  },

  convert: {
    key: 'convert',
    title: 'Convert',
    base: (id) => `/clients/${id}/convert`,
    defaultTab: 'cro',
    groups: [
      { heading: null, rows: [
        { tab: 'cro',   label: 'CRO' },
        { tab: 'forms', label: 'Forms' },
        { tab: 'email', label: 'Email' },
      ] },
    ],
  },

  produce: {
    key: 'produce',
    title: 'Produce',
    base: (id) => `/clients/${id}/video`,
    defaultTab: 'reel',
    groups: [
      { heading: 'Make', rows: [
        { tab: 'reel',       label: 'Make a reel', when: agencyOnly },
        { tab: 'record',     label: 'Record' },
        { tab: 'edit',       label: 'Edit',        when: agencyOnly },
        { tab: 'design',     label: 'Design',      when: agencyOnly },
        { tab: 'visualise',  label: 'Visualise',   when: (ctx) => !!ctx.canVisualise },
        { tab: 'transcribe', label: 'Transcribe',  when: agencyOnly },
      ] },
      { heading: null, rows: [{ tab: 'library', label: 'Library' }] },
    ],
  },
};

// Which section a path is in. Ordered longest-first so /clients/:id/seo cannot
// be swallowed by a shorter prefix if one is ever added.
export function sectionForPath(pathname) {
  const m = pathname.match(/^\/clients\/([^/]+)(?:\/([^/?]+))?/);
  if (!m) return null;
  const leaf = m[2] || '';
  const byLeaf = {
    ads: 'paid', pr: 'earned', social: 'shared', seo: 'owned', video: 'produce',
    convert: 'convert',
  };
  const key = byLeaf[leaf];
  return key ? SECTIONS[key] : null;
}

// The rows a given viewer actually sees, groups with nothing left dropped.
export function visibleGroups(section, ctx) {
  return section.groups
    .map(g => ({ ...g, rows: g.rows.filter(r => !r.when || r.when(ctx)) }))
    .filter(g => g.rows.length > 0);
}

// Every tab key a section names, flattened. Used by the guard, and by a page
// that wants to validate its own ?tab= against the panel rather than keeping a
// second list that drifts.
export function tabsOf(section) {
  return section.groups.flatMap(g => g.rows.map(r => r.tab));
}
