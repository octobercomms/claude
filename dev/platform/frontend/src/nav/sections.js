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
//                phone `false` leaves the row out of the phone's screen
//                      picker. The bar is mechanical, not editorial: the
//                      screen must be something a phone genuinely cannot
//                      operate — a timeline or a drag canvas — not merely
//                      something nobody would choose to do on a phone. Two
//                      rows qualify today. The route still works if you type
//                      it or follow a link, so nothing becomes unreachable;
//                      it is only absent from the list.

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
      // Four steps, not five. Approve was a step holding a three-line
      // summary and one button, between two that do real work, and a step
      // implies a decision it does not have: you press it and you get a URL.
      // It is a header button now, beside Playbook, the way Earned shares
      // coverage.
      { heading: 'Build', rows: [
        { tab: 'brief',    label: 'Brief',    step: 1 },
        { tab: 'concepts', label: 'Draft', slug: 'draft',    step: 2 },
        { tab: 'render',   label: 'Render',   step: 3 },
        { tab: 'launch',   label: 'Launch',   step: 4 },
      ] },
      // Audiences was one page doing three jobs badly. Daniel: "Shall we
      // break this page out into multiple pages? Perhaps ICP as one page?
      // Segments as another? Customers as another?" Each now answers one
      // question: who we are for, who to target next, where the ones we
      // have are.
      { heading: 'Research', rows: [
        { tab: 'competitor_ads', label: 'Competitors', slug: 'competitors' },
        { tab: 'icp',            label: 'ICP' },
        { tab: 'audiences',      label: 'Segments', slug: 'segments' },
        { tab: 'customers',      label: 'Customers' },
      ] },
      // Resize has a row of its own because the Library it used to hang off
      // is gone, and a tool reachable only from a deleted screen is not
      // reachable. It takes an upload now rather than picking from stored
      // creative: Daniel removed the library knowing that was the trade.
      { heading: null, rows: [
        { tab: 'resize', label: 'Resize' },
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
      //
      // Match sits above Find on the 31 Oct review, and the order is better
      // for it. Match reads the contacts you already have; Find goes looking
      // for new ones. With a story in hand you ask your own book first, so
      // Find is the fallback when the answer comes back thin, not the opening
      // move. The earlier reading had Match last because it is the pitch
      // step, which confused "last in the campaign" with "last to open".
      { heading: 'Build', rows: [
        { tab: 'contacts',    label: 'Contacts' },
        { tab: 'match',       label: 'Match' },
        { tab: 'find',        label: 'Find' },
        { tab: 'press',       label: 'Releases', slug: 'releases' },
        { tab: 'journalists', label: 'Campaigns', slug: 'campaigns' },
        // "Move thank-yous to a new page after campaigns." They sat under the
        // contact book on the same screen, which put a queue you work through
        // beneath a record you consult. And the order matters: a thank-you is
        // owed because a campaign landed, so it reads after Campaigns rather
        // than before Find.
        { tab: 'thanks',      label: 'Thank-yous', slug: 'thank-yous' },
      ] },
      // No Measure group. It held one row, Reports, which held one
      // per-campaign backlink table. The Campaigns reshape put per-campaign
      // attribution on each campaign's Results, leaving the screen existing
      // only for the cross-campaign total — which is now three tiles at the
      // top of Coverage, where Earned actually opens.
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
        // Discover joins them, off the 31 Oct review. It had a group of its
        // own with no heading, which is a row floating between Create and
        // Measure belonging to neither. It is the third way material comes in:
        // Swipe is what you saved, Reddit is where you go looking, Discover is
        // the feed bringing it to you. One group, three sources.
        { tab: 'discover',  label: 'Discover' },
      ] },
      // Four steps, not five. 'reels' is the avatar-reel overlay, not the
      // Workbench — it resolves to step 1, so the Workbench row opened Ideas.
      // And 'publish' maps to the same step as 'plans', so Plan and Publish
      // were two rows onto one screen. Both now point where they say they do.
      // Every row is named after the step it opens, which it was not: Ideas
      // opened "1 Create", Brief opened "2 Review", Workbench opened
      // "3 Produce". Only Schedule agreed, and "Brief" named a row while also
      // being half of a different row's subtitle, which is why the review
      // asked "is this first step Generate?" — it is, step 1 is
      // "Brief & generate".
      //
      // Step 2 is Refine rather than Review, because Measure already owns a
      // screen called Review at slug `review`, and the tab key moved with the
      // label: naming only the label and the slug would have left slug
      // 'review' still equal to this row's tab key, which is the collision
      // sectionPanel.test.mjs used to have to allowlist. Daniel's call,
      // 31 October.
      // "maybe the section changes to BUILD? otherwise we have 2 creates."
      // A group called Create holding a row called Create. BUILD would have
      // collided with Earned > Build and Paid > Build, so Make, which is what
      // Create/Refine/Produce/Schedule all are.
      //
      // Worth recording: Produce also has a Make group. That is the same
      // cross-section repeat as Earned/Paid Build, and the panel shows one
      // section at a time so the two are never on screen together — unlike
      // the Create-inside-Create this replaces, which was.
      { heading: 'Make', rows: [
        { tab: 'brainstorm', label: 'Create', slug: 'create',     step: 1 },
        { tab: 'refine',     label: 'Refine', slug: 'refine',     step: 2 },
        { tab: 'produce',    label: 'Produce', slug: 'produce',   step: 3 },
        { tab: 'plans',      label: 'Schedule', slug: 'schedule', step: 4 },
      ] },

      { heading: 'Measure', rows: [
        { tab: 'perf_insights', label: 'Review', slug: 'review' },
        { tab: 'performance',   label: 'Learn', slug: 'learn' },
        // "Hook vault — i've never understood this." It was a button on Learn
        // opening a modal of sentences with no explanation of what a hook is
        // or why you would reuse one. It is a page now, and it says so. It
        // sits after Learn because that is where it is built from — the reach
        // figures come from posts that have run — even though you reach for it
        // while writing.
        { tab: 'hooks',         label: 'Hook vault', slug: 'hook-vault' },
        { tab: 'competitors',   label: 'Compare', slug: 'compare' },
        // Improve is gone from here. "This is all the same report really" —
        // Learn said what worked and Improve said what to change next, which
        // are the two halves of one read. SocialAuditPanel now renders inside
        // Learn. An old /improve link falls back to the section default
        // rather than 404ing, which useScreen already does for any unknown
        // screen.
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
        // "CRO funnel health says little on Falcon, rename the page Optimise."
        // CRO names a discipline, not what the screen does; Optimise says what
        // you came to do. The slug moves with it, which means the two in-app
        // links and the one the backend readiness check generates all had to
        // move too — a rename that leaves a path behind is the dead-link fault
        // routeTargets direction 3 exists to catch.
        { tab: 'cro',   label: 'Optimise', slug: 'optimise' },
        { tab: 'forms', label: 'Forms' },
      ] },

      // Outreach: five rows inside Convert, not a section of its own.
      //
      // The complaint these answer is "I'm not sure where to start and what
      // I'm achieving here". Email was one row hiding five screens behind a
      // tab strip, so the destinations were invisible until you clicked in.
      // Listing them is the fix.
      //
      // It was promoted to a top-level section on 1 November and that was the
      // wrong reading of "do we make EMAIL a section, and then all the steps
      // are listed in the nav?" — the steps belong in the nav, Email belongs
      // in Convert. It also shipped with no rail entry, so for a few hours
      // the five screens had a route, a panel and no door. A group gives the
      // steps their rows without a seventh item in the rail.
      //
      // Prospects, not Leads: Leads under a client meaning the client's
      // prospects and Leads under Biz dev meaning October's own pipeline is a
      // collision a buried tab survived and a visible row would not.
      //
      // Outreach rather than Email, because only two of the five rows are
      // email. The group is finding people, writing to them, chasing the
      // replies and keeping the mailbox able to send; Email names the channel
      // that carries three of those. It is also what the page has always been
      // called in the code (ClientOutreachPage).
      { heading: 'Outreach', rows: [
        { tab: 'campaigns',   label: 'Campaigns' },
        { tab: 'contacts',    label: 'Prospects', slug: 'prospects' },
        { tab: 'tasks',       label: 'Tasks' },
        { tab: 'sending',     label: 'Sending' },
        // "find leads as a page" — the row says what you came to do. It was
        // Selective outreach, which named the mechanism, and sat inside a
        // group that now carries the word Outreach anyway.
        { tab: 'prospecting', label: 'Find leads', slug: 'find-leads' },
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
        // "Make a reel should just be Video." It is the guided route through
        // the tools end to end, so beside Record (capture one), Edit (change
        // one) and Library (find one), Video is the one that makes one.
        { tab: 'reel',       label: 'Video', when: agencyOnly, phone: false },
        { tab: 'record',     label: 'Record' },
        { tab: 'edit',       label: 'Edit',        when: agencyOnly, phone: false },
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
    // Four asks off the 31 Oct review, and one principle behind all of them:
    // "I always believe that if you can't name something, it shouldn't exist."
    //
    // COSTS is its own heading above Connections, and the row is Usage. What
    // the month has cost is not a connection, and it was the first row of a
    // list of credentials as though it were one.
    //
    // AI is split. It held eight groups doing two jobs: the models you send
    // text to, and the services that make images, video and voice. The second
    // half is called Generation rather than AI, because naming one half of a
    // pair of AI screens "AI" is the same failure as "Other" — if the label
    // does not tell you which one you want, it is not a label.
    //
    // OTHER is gone, dissolved rather than renamed. It held n8n, FlareSolverr,
    // an alert email and a report footer: four unrelated things in a drawer
    // named after the fact that nobody had placed them. Each now sits where it
    // belongs, and Scraping is a real name for FlareSolverr plus Apify (which
    // was filed under AI, though scraping TikTok is not generation).
    groups: [
      { heading: 'Costs', rows: [
        { tab: 'costs', label: 'Usage' },
        // "the models is the section selecting which model to use, and this
        // lives under COSTS... this page is doing two different things."
        // Choosing a model is a cost decision, and it belongs beside what
        // each feature has actually spent. Connections keeps AI for the
        // credentials.
        { tab: 'ai', label: 'Models', slug: 'models' },
      ] },
      { heading: 'Connections', rows: [
        { tab: 'gen',          label: 'Generation' },
        { tab: 'email',        label: 'Email' },
        { tab: 'ads',          label: 'Ad platforms', slug: 'ad-platforms' },
        { tab: 'commerce',     label: 'E-commerce' },
        { tab: 'seo',          label: 'SEO' },
        { tab: 'outreach',     label: 'Outreach finders' },
        { tab: 'scraping',     label: 'Scraping' },
        { tab: 'integrations', label: 'Integrations' },
      ] },
      { heading: 'Tools', rows: [
        { tab: 'reports',  label: 'Reports' },
        { tab: 'strategy', label: 'Strategy templates', slug: 'strategy-templates' },
        { tab: 'praddon',  label: 'PR Gmail add-on', slug: 'gmail-add-on' },
        { tab: 'checker',  label: 'Checker bench' },
      ] },
      { heading: 'Account', rows: [
        { tab: 'users',    label: 'Users & access' },
        { tab: 'security', label: 'Security' },
        { tab: 'alerts',   label: 'Alerts' },
      ] },
    ],
  },

  // Database and Biz dev used to be two groups inside Settings. Neither is
  // configuration: the media database is a working surface you edit all day,
  // and the sales pipeline is the agency's own funnel. They sat in Settings
  // because that is where their screens were first built, not because anyone
  // decided they belonged there. Both now have their own section, their own
  // path and their own nav item, and SettingsPage still renders them — the
  // screens did not move, only the way in.
  database: {
    key: 'database',
    leaf: 'database',
    title: 'Database',
    scope: 'global',
    base: () => '/database',
    defaultTab: 'health',
    groups: [
      { heading: null, rows: [
        { tab: 'health',       label: 'Health' },
        { tab: 'contacts',     label: 'Journalists', slug: 'journalists' },
        { tab: 'publications', label: 'Publications' },
        { tab: 'tags',         label: 'Tags' },
        { tab: 'tasks',        label: 'Tasks' },
        { tab: 'assistant',    label: 'Assistant' },
      ] },
    ],
  },
  bizdev: {
    key: 'bizdev',
    leaf: 'biz-dev',
    title: 'Biz dev',
    scope: 'global',
    base: () => '/biz-dev',
    defaultTab: 'leads',
    groups: [
      { heading: null, rows: [
        { tab: 'leads',     label: 'Leads' },
        { tab: 'proposals', label: 'Proposals' },
        { tab: 'proof',     label: 'Proof library' },
        { tab: 'booking',   label: 'Booking' },
        { tab: 'tenders',   label: 'Tenders' },
      ] },
    ],
  },
};

// Which section a path is in. Derived from each section's own `leaf`, so a
// section's path segment is decided in exactly one place.
const BY_LEAF = Object.fromEntries(Object.values(SECTIONS).map(s => [s.leaf, s]));

export function sectionForPath(pathname) {
  // The global sections are not under /clients and have no client id. Keyed
  // off each section's own `leaf` so a path segment is still decided in one
  // place; the literal list is only the order to try them in.
  for (const key of ['settings', 'database', 'bizdev']) {
    const leaf = SECTIONS[key].leaf;
    if (new RegExp(`^/${leaf}(/|$)`).test(pathname)) return SECTIONS[key];
  }
  const m = pathname.match(/^\/clients\/([^/]+)\/([^/?]+)/);
  // /clients (the list) and a bare /clients/:id match nothing: the bare path
  // redirects to /dashboard rather than being a section of its own, so there
  // is one URL per screen instead of two for the landing.
  return m ? (BY_LEAF[m[2]] || null) : null;
}

// The screen in a path, as the page's own key. Null when the path names no
// screen or names one this section does not have.
//
// The global branch reads the section's own `leaf` rather than naming
// /settings literally. It used to be literal, and when Database and Biz dev
// became sections of their own the literal did not grow with them: every
// /database/* and /biz-dev/* path answered null, so the panel lit Health
// while the page showed Journalists. A derived leaf cannot drift that way.
export function screenForPath(pathname) {
  const section = sectionForPath(pathname);
  if (!section) return null;
  const pattern = section.scope === 'global'
    ? new RegExp(`^/${section.leaf}/([^/?]+)`)
    : /^\/clients\/[^/]+\/[^/]+\/([^/?]+)/;
  const slug = (pathname.match(pattern) || [])[1];
  return slug ? tabForSlug(section, slug) : null;
}

// The rows a given viewer actually sees, groups with nothing left dropped.
export function visibleGroups(section, ctx) {
  return section.groups
    .map(g => ({ ...g, rows: g.rows.filter(r => !r.when || r.when(ctx)) }))
    .filter(g => g.rows.length > 0);
}

// The same list, minus the rows a phone cannot operate. Separate from
// visibleGroups rather than another flag on `ctx`, because the two answer
// different questions: `when` decides what a viewer is allowed to see, and
// this decides what fits the device. Conflating them would mean a desktop
// browser narrowed to 700px hid screens from a user who has them.
export function phoneGroups(section, ctx) {
  return visibleGroups(section, ctx)
    .map(g => ({ ...g, rows: g.rows.filter(r => r.phone !== false) }))
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
