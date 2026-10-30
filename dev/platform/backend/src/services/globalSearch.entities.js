// What each kind of record is, where it lives, and what you would type to find
// it. Data, in a file of its own with no requires at all.
//
// Separate from globalSearch.js because two different tests need it and only
// one of them can load that file. The frontend's routeTargets.test.mjs checks
// every entity's (leaf, screen) against nav/sections.js — a renamed screen
// would otherwise leave search pointing at a slug that resolves to the section
// default, with no error. That test runs in the frontend CI job, which installs
// only the frontend's dependencies, so requiring the service there reached
// src/db.js and failed on a missing `pg`. It passed locally, where the
// backend's node_modules happen to exist.
//
// tests/global-search.test.js asserts this file stays free of requires, so the
// next thing added to it cannot quietly reintroduce that.
//
// `columns` are searched; `title` names the one shown, and must be among them.
// `leaf` and `screen` are where a result opens.
//
// `opens` says what happens once you are there, and every entity declares it:
//
//   'record'  the screen has a view of one record and opens it, from the id in
//             `?open=`. Contacts, releases, coverage, campaigns, transcripts.
//   'reveal'  the screen has no single-record view, so the row is scrolled to
//             and marked for a moment. Recordings and assets: a recording row
//             is rename / copy link / export, and an asset is a card.
//   'screen'  the screen IS the record. Only clients, whose result opens their
//             own dashboard; `?open=` would say nothing the path does not.
//
// A test asserts every entity declares one of the three, so a kind added later
// has to decide rather than silently landing on a list.
//
// Keep each entry small: the cost of another one should be six lines, so that
// "search does not find X" is cheap to fix.
const ENTITIES = [
  {
    type: 'client',
    opens: 'screen',
    label: 'Clients',
    table: 'clients',
    // A client is scoped by its own id rather than a client_id column.
    scopeColumn: 'id',
    title: 'name',
    columns: ['name'],
    leaf: 'dashboard',
    screen: 'measure',
    // The row IS the client, so the link target is its own id.
    clientIdExpr: 'id',
  },
  {
    type: 'contact',
    opens: 'record',
    label: 'Journalists & contacts',
    table: 'outreach_contacts',
    title: 'name',
    subtitle: 'company',
    columns: ['name', 'company', 'email'],
    leaf: 'pr',
    screen: 'contacts',
  },
  {
    type: 'release',
    opens: 'record',
    label: 'Press releases',
    table: 'pr_press_releases',
    title: 'title',
    subtitle: 'status',
    columns: ['title'],
    leaf: 'pr',
    screen: 'releases',
  },
  {
    type: 'coverage',
    opens: 'record',
    label: 'Coverage',
    table: 'pr_editorial_log',
    // The Coverage screen's own list is `status NOT IN ('new','dismissed')` —
    // a 'new' row is in the Monitor review queue and has never been confirmed
    // as coverage. Searching the whole table offered rows whose result opened
    // a list they were not in.
    where: "status NOT IN ('new','dismissed')",
    title: 'story_title',
    subtitle: 'status',
    columns: ['story_title', 'story_url'],
    leaf: 'pr',
    screen: 'coverage',
  },
  {
    type: 'campaign',
    opens: 'record',
    label: 'Campaigns',
    table: 'outreach_campaigns',
    title: 'name',
    subtitle: 'status',
    columns: ['name'],
    leaf: 'pr',
    screen: 'campaigns',
  },
  {
    type: 'recording',
    opens: 'reveal',
    label: 'Recordings',
    table: 'recordings',
    title: 'title',
    subtitle: 'status',
    columns: ['title'],
    leaf: 'produce',
    // 'record', not 'library': Produce has both, and the library lists
    // client_assets. This said 'library' at first — a valid slug of the right
    // section, which is all the route test can check, so a recording result
    // opened a screen that lists a different table entirely. The browser drive
    // is what catches that now: it opens one result of every kind and asserts
    // the record is actually there.
    screen: 'record',
  },
  {
    type: 'transcript',
    opens: 'record',
    label: 'Transcripts',
    table: 'transcripts',
    title: 'title',
    subtitle: 'status',
    columns: ['title'],
    leaf: 'produce',
    screen: 'transcribe',
  },
  {
    type: 'asset',
    opens: 'reveal',
    label: 'Library',
    table: 'client_assets',
    title: 'title',
    columns: ['title'],
    leaf: 'produce',
    screen: 'library',
  },
];

module.exports = { ENTITIES };
