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
//   scope      — 'client' for a section under /clients/:id, 'global' for one
//                that has no client (Settings). The panel needs this: it used
//                to require a client id before rendering at all, which meant
//                a global section's rows never appeared and the panel looked
//                like it had simply not been wired up.
//   leaf       — the path segment for the section itself
//   base       — the route the rows hang off
//   defaultTab — what the page shows when ?tab= is absent, so the right row
//                lights up on a bare URL
//   groups     — { heading, rows }. A heading of null renders the rows with no
//                label above them, for a group of one.
//   rows       — { tab, label, slug?, step?, when? }
//                `tab` is what the PAGE calls the screen; `slug` is what the
//                URL calls it, and it defaults to `tab` with underscores
//                turned into hyphens. They are given separately because the
//                two have different jobs: the slug is a permalink people read
//                and type, while the key is a string compared inside a 2,000
//                line page where it often collides with something unrelated
//                ('ads' is also a connector type, 'audit' is also an API
//                path). Renaming the keys to match the slugs would mean blind
//                string surgery across six large files for no gain the URL
//                can see.
//
//                Where they differ it is because the key predates the name
//                the section settled on. Those are listed explicitly below;
//                everything else is derived.
//                step  numbers a genuine sequence (a vertical list cannot show
//                      order the way a strip can, so it has to say it)
//                when  gates a row on the viewer, for the handful that are
//                      role- or grant-dependent

// `ctx` is { readOnly, canVisualise }.
const agencyOnly = (ctx) => !ctx.readOnly;

export const SECTIONS = {
  // The client's own Dashboard.
  //
  // Setup, Connectors and Forms used to be deliberately absent from the panel,
  // reached only from the cog and the plug in the client bar, on the reasoning
  // that they are done once and then not touched. That reasoning cost them
  // their URLs: once a screen was a path segment, a slug with no row here
  // resolves to nothing and useScreen falls back to the default, so the cog
  // put /dashboard/setup in the address bar and showed Measure. A screen the
  // page renders has to have a row, or it is not addressable at all.
  dashboard: {
    key: 'dashboard',
    leaf: 'dashboard',
    title: 'Dashboard',
    scope: 'client',
    base: (id) => `/clients/${id}/dashboard`,
    defaultTab: 'measure',
    groups: [
      { heading: null, rows: [
        { tab: 'measure',  label: 'Measure' },
        { tab: 'reports',  label: 'Reports' },
        { tab: 'strategy', label: 'Strategist', slug: 'strategist' },
        { tab: 'plan',     label: 'SOSTAC', slug: 'sostac' },
      ] },
      // The cog and the plug in the client bar still jump straight here; these
      // rows are what make those jumps land, and what shows you where you are
      // once you have landed.
      // Forms is NOT here. It was, briefly: the sweep that gave Setup and
      // Connectors their rows gave one to every screen ClientDetailPage
      // rendered, and that page rendered the same <FormsTab> Convert does.
      // One screen behind two URLs, and the one it belongs to is Convert,
      // beside CRO and Email. The Dashboard render branch went with the row.
      { heading: 'Setup', rows: [
        { tab: 'details',    label: 'Setup',      slug: 'setup', when: agencyOnly },
        { tab: 'connectors', label: 'Connectors', when: agencyOnly },
      ] },
    ],
  },

  paid: {
    key: 'paid',
    leaf: 'ads',
    title: 'Paid',
    scope: 'client',
    base: (id) => `/clients/${id}/ads`,
    defaultTab: 'measure',
    groups: [
      { heading: null, rows: [{ tab: 'measure', label: 'Measure' }] },
      { heading: 'Build', rows: [
        { tab: 'brief',    label: 'Brief',    step: 1 },
        { tab: 'concepts', label: 'Draft', slug: 'draft',    step: 2 },
        { tab: 'render',   label: 'Render',   step: 3 },
        { tab: 'approve',  label: 'Approve',  step: 4 },
        { tab: 'launch',   label: 'Launch',   step: 5 },
      ] },
      { heading: 'Research', rows: [
        { tab: 'competitor_ads', label: 'Competitors', slug: 'competitors' },
        { tab: 'audiences',      label: 'Audiences' },
        { tab: 'library',        label: 'Library' },
      ] },
    ],
  },

  earned: {
    key: 'earned',
    leaf: 'pr',
    title: 'Earned',
    scope: 'client',
    base: (id) => `/clients/${id}/pr`,
    defaultTab: 'coverage',
    groups: [
      // Track held two jobs on one screen. Logging what you have won and
      // triaging what the saved searches found run on different cadences and
      // are rarely wanted at the same moment.
      { heading: 'Track', rows: [
        { tab: 'coverage', label: 'Coverage' },
        { tab: 'monitor',  label: 'Monitor' },
      ] },
      // Pitch was six jobs on one screen: the campaign list, two AI matchers,
      // journalist discovery, the contact book and thank-yous. The two
      // matchers both answer "who do I send this to" so they share a screen;
      // the contact book and the thank-yous owed are one record of the same
      // relationships, so they do too.
      // Ordered the way the work runs, which Daniel described as: build the
      // list, write the release, work on it, and only then pitch it. Campaigns
      // first was alphabetical-by-accident and put the last step at the top.
      { heading: 'Build', rows: [
        { tab: 'contacts',    label: 'Contacts' },
        { tab: 'find',        label: 'Find' },
        { tab: 'press',       label: 'Releases', slug: 'releases' },
        { tab: 'journalists', label: 'Campaigns', slug: 'campaigns' },
        { tab: 'match',       label: 'Match' },
      ] },
      { heading: 'Measure', rows: [
        { tab: 'reports', label: 'Reports' },
      ] },
    ],
  },

  shared: {
    key: 'shared',
    leaf: 'social',
    title: 'Shared',
    scope: 'client',
    base: (id) => `/clients/${id}/social`,
    // The first row, not Measure. You come to Shared to make something.
    defaultTab: 'swipe',
    groups: [
      { heading: 'Capture', rows: [
        // Side by side was a workaround for the swipe list burying Reddit.
        // Separate rows fix that directly, and they do different jobs.
        { tab: 'swipe',     label: 'Swipe' },
        { tab: 'subreddit', label: 'Reddit', slug: 'reddit' },
      ] },
      // Four steps, not five. 'reels' is the avatar-reel overlay, not the
      // Workbench — it resolves to step 1, so the Workbench row opened Ideas.
      // And 'publish' maps to the same step as 'plans', so Plan and Publish
      // were two rows onto one screen. Both now point where they say they do.
      { heading: 'Create', rows: [
        { tab: 'brainstorm', label: 'Ideas', slug: 'ideas',     step: 1 },
        { tab: 'review',     label: 'Brief', slug: 'brief',     step: 2 },
        { tab: 'produce',    label: 'Workbench', slug: 'workbench', step: 3 },
        { tab: 'plans',      label: 'Schedule', slug: 'schedule',  step: 4 },
      ] },
      // Engage held the DM bot and the feed, which is two jobs. The bot is a
      // drawer now, so the group has one job and can take its name.
      { heading: null, rows: [{ tab: 'discover', label: 'Discover' }] },
      { heading: 'Measure', rows: [
        { tab: 'perf_insights', label: 'Review', slug: 'review' },
        { tab: 'performance',   label: 'Learn', slug: 'learn' },
        { tab: 'competitors',   label: 'Compare', slug: 'compare' },
        { tab: 'audit',         label: 'Improve', slug: 'improve' },
      ] },
    ],
  },

  owned: {
    key: 'owned',
    leaf: 'seo',
    title: 'Owned',
    scope: 'client',
    base: (id) => `/clients/${id}/seo`,
    defaultTab: 'health',
    groups: [
      { heading: null, rows: [{ tab: 'health', label: 'Dashboard', slug: 'dashboard' }] },
      // No Insights row: ?tab=perf_insights renders OrganicInsightsPanel,
      // which is exactly what Dashboard renders. Two rows onto one screen
      // reads as the second one being broken. perf_insights stays a valid
      // deep link and lands on Dashboard.
      { heading: 'Watch', rows: [
        { tab: 'keywords',       label: 'Keywords' },
        { tab: 'gsc',            label: 'Search Console', slug: 'search-console' },
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
        { tab: 'planning',  label: 'Brief', slug: 'brief',     step: 3 },
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
    leaf: 'convert',
    title: 'Convert',
    scope: 'client',
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
    leaf: 'produce',
    title: 'Produce',
    scope: 'client',
    base: (id) => `/clients/${id}/produce`,
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
  // Settings. Its sections and sub-tabs were already a two-level tree in
  // SettingsPage's own SECTIONS table; this is that tree, as rows.
  settings: {
    key: 'settings',
    leaf: 'settings',
    title: 'Settings',
    scope: 'global',
    base: () => '/settings',
    defaultTab: 'costs',
    groups: [
      { heading: 'Connections', rows: [
        { tab: 'costs',        label: 'Costs & usage' },
        { tab: 'ai',           label: 'AI' },
        { tab: 'email',        label: 'Email' },
        { tab: 'ads',          label: 'Ad platforms', slug: 'ad-platforms' },
        { tab: 'commerce',     label: 'E-commerce' },
        { tab: 'seo',          label: 'SEO' },
        { tab: 'outreach',     label: 'Outreach finders' },
        { tab: 'integrations', label: 'Integrations' },
        { tab: 'other',        label: 'Other' },
      ] },
      { heading: 'Database', rows: [
        { tab: 'health',       label: 'Health' },
        { tab: 'contacts',     label: 'Journalists', slug: 'journalists' },
        { tab: 'publications', label: 'Publications' },
        { tab: 'tags',         label: 'Tags' },
        { tab: 'tasks',        label: 'Tasks' },
        { tab: 'assistant',    label: 'Assistant' },
      ] },
      { heading: 'Tools', rows: [
        { tab: 'reports',  label: 'Reports' },
        { tab: 'strategy', label: 'Strategy templates', slug: 'strategy-templates' },
        { tab: 'praddon',  label: 'PR Gmail add-on', slug: 'gmail-add-on' },
        { tab: 'checker',  label: 'Checker bench' },
      ] },
      { heading: 'Biz dev', rows: [
        { tab: 'leads',     label: 'Leads' },
        { tab: 'proposals', label: 'Proposals' },
        { tab: 'proof',     label: 'Proof library' },
        { tab: 'booking',   label: 'Booking' },
        { tab: 'tenders',   label: 'Tenders' },
      ] },
      { heading: 'Account', rows: [
        { tab: 'users',    label: 'Users & access' },
        { tab: 'security', label: 'Security' },
      ] },
    ],
  },
};

// Which section a path is in. Derived from each section's own `leaf`, so a
// section's path segment is decided in exactly one place.
const BY_LEAF = Object.fromEntries(Object.values(SECTIONS).map(s => [s.leaf, s]));

export function sectionForPath(pathname) {
  // Settings is not under /clients and has no client id.
  if (/^\/settings(\/|$)/.test(pathname)) return SECTIONS.settings;
  const m = pathname.match(/^\/clients\/([^/]+)\/([^/?]+)/);
  // /clients (the list) and a bare /clients/:id match nothing: the bare path
  // redirects to /dashboard rather than being a section of its own, so there
  // is one URL per screen instead of two for the landing.
  return m ? (BY_LEAF[m[2]] || null) : null;
}

// The screen in a path, as the page's own key. Null when the path names no
// screen or names one this section does not have.
export function screenForPath(pathname) {
  const section = sectionForPath(pathname);
  if (!section) return null;
  const m = pathname.match(/^\/clients\/[^/]+\/[^/]+\/([^/?]+)|^\/settings\/([^/?]+)/);
  const slug = m && (m[1] || m[2]);
  return slug ? tabForSlug(section, slug) : null;
}

// The rows a given viewer actually sees, groups with nothing left dropped.
export function visibleGroups(section, ctx) {
  return section.groups
    .map(g => ({ ...g, rows: g.rows.filter(r => !r.when || r.when(ctx)) }))
    .filter(g => g.rows.length > 0);
}

// A screen's URL name. Defaults to the page's own key with underscores turned
// into hyphens, which covers everything in Owned; the rows that disagree say
// so with an explicit `slug`.
export function slugOf(row) {
  return row.slug || row.tab.replace(/_/g, '-');
}

// slug -> the key the page compares against. Unknown slugs answer null so the
// caller can fall back to the section's default rather than render nothing.
export function tabForSlug(section, slug) {
  if (!section) return null;
  for (const g of section.groups) {
    const row = g.rows.find(r => slugOf(r) === slug);
    if (row) return row.tab;
  }
  return null;
}

// key -> slug, for building a link to a screen a page names by its own key.
export function slugForTab(section, tab) {
  if (!section) return null;
  for (const g of section.groups) {
    const row = g.rows.find(r => r.tab === tab);
    if (row) return slugOf(row);
  }
  return null;
}

// Every slug a section answers to. The router validates against this, so a
// path that names no screen lands on the default instead of a blank page.
export function slugsOf(section) {
  return section.groups.flatMap(g => g.rows.map(slugOf));
}

// What the current row is called, for the page to print as its heading. The
// strips used to say which screen you were on; a panel row is 170px away and
// easy to lose, so the page says it itself.
export function labelForTab(section, tab) {
  if (!section) return null;
  const key = tab || section.defaultTab;
  for (const g of section.groups) {
    const row = g.rows.find(r => r.tab === key);
    if (row) return row.label;
  }
  return null;
}

// Every tab key a section names, flattened. Used by the guard, and by a page
// that wants to validate its own ?tab= against the panel rather than keeping a
// second list that drifts.
export function tabsOf(section) {
  return section.groups.flatMap(g => g.rows.map(r => r.tab));
}

// Every screen in the product, flattened, for the search box.
//
// The search endpoint finds records; screens are matched here in the browser
// instead, because this file already knows all of them and the alternative is
// a second list on the server that drifts the first time a screen is renamed.
// Each entry carries its own section, so the caller builds the path the one
// way the panel builds it — `section.base(clientId)` plus the slug — rather
// than reassembling `clients/<id>/<leaf>/<slug>` by hand.
//
// `ctx` gates the same rows the panel gates, so a read-only login cannot find
// a screen it is not shown.
export function allScreens(ctx = {}) {
  const out = [];
  for (const section of Object.values(SECTIONS)) {
    for (const group of visibleGroups(section, ctx)) {
      for (const row of group.rows) {
        out.push({
          section,
          sectionKey: section.key,
          sectionTitle: section.title,
          scope: section.scope,
          heading: group.heading || null,
          label: row.label,
          tab: row.tab,
          slug: slugOf(row),
        });
      }
    }
  }
  return out;
}
