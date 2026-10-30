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
// `leaf` and `screen` are where a result opens. Keep each entry small: the cost
// of another one should be six lines, so that "search does not find X" is cheap
// to fix.
const ENTITIES = [
  {
    type: 'client',
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
    label: 'Coverage',
    table: 'pr_editorial_log',
    title: 'story_title',
    subtitle: 'status',
    columns: ['story_title', 'story_url'],
    leaf: 'pr',
    screen: 'coverage',
  },
  {
    type: 'campaign',
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
    label: 'Recordings',
    table: 'recordings',
    title: 'title',
    subtitle: 'status',
    columns: ['title'],
    leaf: 'produce',
    screen: 'library',
  },
  {
    type: 'transcript',
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
    label: 'Library',
    table: 'client_assets',
    title: 'title',
    columns: ['title'],
    leaf: 'produce',
    screen: 'library',
  },
];

module.exports = { ENTITIES };
