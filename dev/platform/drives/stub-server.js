// The browser-drive stub.
//
// A fake OMI backend on port 4599 serving the REAL built frontend out of
// frontend/dist, so a drive exercises the shipped bundle rather than a dev
// server. Every route answers a shape the real API answers, and several of
// them reproduce a specific bug that was once live, which is why some of the
// fixtures look odd: STUB_META_SPEND=0 is Falcon's zero-spend Meta account,
// STUB_SUBS=1 starts the subreddit list populated.
//
// Run it:   node dev/platform/drives/stub-server.js
// Build first:  cd dev/platform/frontend && npx vite build
//
// It imports the real adsCurrency resolver rather than a hand-written copy,
// so a drive checks the shipped rule and not a convenient version of it.
//
// See docs/omi/browser-drives.md for why these exist and how to write one.

const http = require('http');
let LAST_SOCIAL_EXPORT = null;
let LAST_REPORT = null;
// The stored subreddit list. Starts empty, which is the state the screen's
// first action exists for; STUB_SUBS=1 starts it populated.
let SUBS = process.env.STUB_SUBS === '1' ? [
  { id: 's1', name: 'GardeningUK', why: 'Where owners ask what a garden should cost.', focus: null, time_window: 'month', source: 'suggest', researched_at: null },
  { id: 's2', name: 'LandscapeArchitecture', why: 'Practitioners, not students.', focus: 'pricing', time_window: 'year', source: 'suggest', researched_at: '2026-10-20T10:00:00Z' },
] : [];
let SUBS_SUGGEST_CALLS = 0;
// The nine setup scans. `present` and `missing` are what the real catalogue
// computes; the drive checks the picker, so the state is set here.
const SCAN_CAT = () => ({
  client: { id: 'c1', name: 'Hillcroft Gardens', domain: 'hillcroftgardens.co.uk' },
  scans: [
    { key: 'competitors', label: 'Competitors', what: 'who this client is up against, saved to the competitor list', feature: 'competitor_suggest', needs: [], present: SCAN_RUN.has('competitors'), missing: [], missing_labels: [], wants_service_city: false },
    { key: 'subreddits', label: 'Subreddits', what: 'the subreddits where this client\'s buyers gather', feature: 'subreddit_suggest', needs: [], present: SCAN_RUN.has('subreddits'), missing: [], missing_labels: [], wants_service_city: false },
    { key: 'ai_seo', label: 'Starter keywords', what: 'keyword targets drawn from the brief and the website', feature: 'ai_seo_keywords', needs: ['domain'], present: SCAN_RUN.has('ai_seo'), missing: [], missing_labels: [], wants_service_city: false },
    { key: 'schema', label: 'Schema audit', what: 'every schema type on the site\'s pages, graded', feature: 'local_seo_schema_audit', needs: ['domain'], present: SCAN_RUN.has('schema'), missing: [], missing_labels: [], wants_service_city: false },
    { key: 'local_gap', label: 'Competition gap', what: 'the content and trust gaps against the competitor sites', feature: 'local_seo_competition_gap', needs: ['competitors'], present: SCAN_RUN.has('local_gap'), missing: ['competitors'], missing_labels: ['at least one competitor (tick Competitors too and it runs first)'], wants_service_city: false },
    { key: 'business_xray', label: 'Competitor X-ray', what: 'this site against the competitors, side by side', feature: 'local_seo_competitor_xray', needs: ['domain', 'competitors'], present: SCAN_RUN.has('business_xray'), missing: ['competitors'], missing_labels: ['at least one competitor (tick Competitors too and it runs first)'], wants_service_city: false },
    { key: 'keyword_sniper', label: 'Buyer-intent keywords', what: '20 high-intent local keywords for the service and city', feature: 'local_seo_buyer_intent', needs: ['service_city'], present: SCAN_RUN.has('keyword_sniper'), missing: ['service_city'], missing_labels: ['a service and a city'], wants_service_city: true },
    { key: 'gbp_playbook', label: 'GBP ranking playbook', what: 'the levers the local map pack rewards', feature: 'local_seo_ranking_playbook', needs: ['service_city'], present: SCAN_RUN.has('gbp_playbook'), missing: ['service_city'], missing_labels: ['a service and a city'], wants_service_city: true },
    { key: 'ranking_outliers', label: 'Ranking outliers', what: 'who ranks despite weak signals, and the one lever carrying them', feature: 'local_seo_ranking_outliers', needs: ['service_city'], present: SCAN_RUN.has('ranking_outliers'), missing: ['service_city'], missing_labels: ['a service and a city'], wants_service_city: true },
  ],
});
let SCAN_RUN = new Set();
let LAST_SCAN_POST = null;
const fs = require('fs');
const path = require('path');
// Resolved from this file, so the stub runs in any checkout rather than
// only in the container it was written in.
const DIST = path.join(__dirname, '..', 'frontend', 'dist');

// The Launch step's backfill: whether it has run in this process, and what
// it should answer. Switched at runtime through /api/stub/backfill-mode, so
// the three outcomes (all kept, none kept, some kept with more to go) can be
// driven against one stub instead of one stub per port.
let backfilled = false;
let backfillMode = process.env.STUB_BACKFILL || 'all';
// The real resolver, so the drive exercises the shipped rule rather than a
// hand-written copy of what I hope it returns.
const { summariseAdsCurrency } = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'adsCurrency'));
// The real model list and feature groups, for the same reason: a drive that
// checks the Models screen should see the groups OMI actually routes, not a
// convenient five. getMap() reads the database, so the saved routing is the
// one thing supplied here — empty, which is every feature on the default.
const aiModels = require(path.join(__dirname, '..', 'backend', 'src', 'services', 'aiModels'));

// Two Google accounts on different currencies (a UK + US setup, which is the
// ordinary case) and one Meta account in USD.
const GOOGLE_ADS = [
  { connector_id: 'g1', store_label: 'UK', data: { currency: 'GBP', results: [
    { campaign: { name: 'Brand UK' }, metrics: { costMicros: '1200000000', clicks: '900', conversions: 12, conversionsValue: 4800, impressions: '40000' } },
  ] } },
  { connector_id: 'g2', store_label: 'US', data: { currency: 'USD', results: [
    { campaign: { name: 'Brand US' }, metrics: { costMicros: '900000000', clicks: '600', conversions: 7, conversionsValue: 2800, impressions: '30000' } },
  ] } },
];
// STUB_META_SPEND=0 reproduces Falcon: a Meta account that is connected and
// spent nothing, which is the case that printed a "Combined" strip identical
// to the Google one.
const META_SPEND = process.env.STUB_META_SPEND != null ? process.env.STUB_META_SPEND : '250.00';
const META_ADS = [
  { connector_id: 'm1', store_label: 'US social', data: { currency: 'USD', data: [
    { campaign_name: 'Prospecting', spend: META_SPEND, impressions: '80000', clicks: '1200', action_values: [{ action_type: 'purchase', value: META_SPEND === '0' ? '0' : '1100' }] },
  ] } },
];

const C = [
  { id: 'c1', name: 'Oculi Mundi', slug: 'oculi-mundi', active: true },
  { id: 'c2', name: 'Hillcroft Gardens', slug: 'hillcroft-gardens', active: true },
  { id: 'c3', name: 'Falcon Interiors', slug: 'falcon-interiors', active: true },
  { id: 'c4', name: 'Old Retainer Ltd', slug: 'old-retainer', active: false },
];

// Shared → Measure. Shaped exactly as socialBaseline.rank() and
// getFrameworkBreakdown() return, so the drive exercises the real derivation
// rather than a convenient version of it: one heater on a cohort baseline,
// one on the wider account baseline, one post with no baseline at all, and
// frameworks on both sides of the band plus two that are too thin to read.
const WINNERS = [
  { id: 'w1', platform: 'instagram', kind: 'reel', hook: 'We costed three kitchens and published the invoices',
    is_heater: true, reach_multiple: 4.2, baseline_scope: 'cohort' },
  { id: 'w2', platform: 'linkedin', kind: 'post', hook: 'The quote you were given is not the price',
    is_heater: true, reach_multiple: 2.6, baseline_scope: 'account' },
  { id: 'w3', platform: 'instagram', kind: 'post', hook: 'A quiet one',
    is_heater: false, reach_multiple: null, baseline_scope: 'none' },
];
const FRAMEWORKS = [
  { framework: 'Teardown', avg_engagement_rate: 7.8, posts: 9 },
  { framework: 'Behind the scenes', avg_engagement_rate: 4.1, posts: 6 },
  { framework: 'Listicle', avg_engagement_rate: 1.2, posts: 5 },
  { framework: 'Quote card', avg_engagement_rate: 12.0, posts: 2 },
  { framework: '(unspecified)', avg_engagement_rate: 9.9, posts: 8 },
];

const API = {
  '/api/auth/me': { id: 'u1', username: 'daniel', role: 'admin' },
  // loadAll() has no .catch on batches or competitors, so Promise.all rejects
  // and NOTHING on the page gets set — including the winners below, which is
  // why the decisions block showed its empty state while the stub was happily
  // serving data.
  '/api/social/clients/c1/batches': [
    { id: 'sb1', brief: 'Autumn planting', created_at: new Date().toISOString(), post_count: 2 },
  ],
  '/api/social/clients/c1/posts': [
    { id: 'sp1', batch_id: 'sb1', client_id: 'c1', position: 0, kind: 'post', platform: 'instagram',
      hook: 'The one bed rule', caption: 'Start with one bed, not the whole garden.',
      hashtags: ['gardendesign'], status: 'draft', image_urls: [] },
    { id: 'sp2', batch_id: 'sb1', client_id: 'c1', position: 1, kind: 'reel', platform: 'tiktok',
      hook: 'Autumn is the planting season', caption: 'Nobody believes this until the second spring.',
      hashtags: [], status: 'draft', image_urls: [] },
  ],
  '/api/social/clients/c1/competitors': { competitors: [] },
  // The recorded reel-check judgements, keyed by post. sp1 failed two and had
  // its words, sp2 was never transcribed so four are unjudged.
  '/api/social/clients/c1/reel-checks': { byPost: {
    sp1: {
      post_id: 'sp1', passed: 5, unknown: 0, total: 7, template: 'institution', duration_s: 34,
      checks: [
        { key: 'hook_timing', pass: true }, { key: 'hook_is_a_fact', pass: false },
        { key: 'stated_flatly', pass: true }, { key: 'captions', pass: true },
        { key: 'not_about_us', pass: false }, { key: 'one_idea', pass: true },
        { key: 'says_a_term_we_rank_for', pass: true },
      ],
    },
    sp2: {
      post_id: 'sp2', passed: 3, unknown: 4, total: 7, template: null, duration_s: 52,
      checks: [
        { key: 'hook_timing', pass: null }, { key: 'hook_is_a_fact', pass: null },
        { key: 'stated_flatly', pass: null }, { key: 'captions', pass: true },
        { key: 'not_about_us', pass: null }, { key: 'one_idea', pass: true },
        { key: 'says_a_term_we_rank_for', pass: true },
      ],
    },
  } },
  // The vault. STUB_HOOKS=1 serves a populated one; empty by default, which is
  // the case the worked examples exist for.
  '/api/social/clients/c1/hooks': process.env.STUB_HOOKS === '1' ? [
    { hook: 'The client asked for one room. We rebuilt the roof.', framework: 'PAS',
      platform: 'instagram', kind: 'post', best_reach: 41200, use_count: 3 },
    { hook: 'Three questions before you sign anything.', framework: 'AIDA',
      platform: 'linkedin', kind: 'post', best_reach: 8800, use_count: 1 },
  ] : [],
  '/api/social/clients/c1/winners': WINNERS,
  '/api/social/clients/c1/framework-breakdown': FRAMEWORKS,
  // Settings. Without these the page's own loader rejects unhandled, which
  // shows up as a page error in every drive that visits /settings for any
  // reason — it is the stub missing fixtures, not the page being broken.
  '/api/users': [{ id: 'u1', username: 'daniel', role: 'admin', client_id: null }],
  '/api/settings/platform-keys': { keys: [], categories: [] },
  // Which model runs each feature. The Models screen under Costs renders
  // this; the AI screen under Connections renders credentials and must not
  // render any of it.
  '/api/settings/ai-models': {
    models: aiModels.MODELS,
    default: aiModels.DEFAULT_MODEL,
    features: aiModels.FEATURES,
    map: {},
  },
  // The mailboxes OMI reads. Three rows, one of each state the panel has to
  // tell apart: a Google mailbox with a grant, one still waiting for its
  // grant, and an old app-password mailbox.
  '/api/settings/inboxes': { inboxes: [
    { id: 'i1', label: 'press@', host: 'imap.gmail.com', port: 993,
      username: 'press@octobercomms.com', active: true, poll_replies: true, scan_ooo: true,
      known_senders_only: false, auth_type: 'google_oauth', has_oauth: true, has_password: false,
      oauth_email: 'press@octobercomms.com', oauth_connected_at: new Date().toISOString(),
      last_ok_at: new Date().toISOString(), last_error: null, matched: 41, unsubscribed: 3, ooo_queued: 7 },
    { id: 'i2', label: 'hello@', host: 'imap.gmail.com', port: 993,
      username: 'hello@octobercomms.com', active: true, poll_replies: true, scan_ooo: true,
      known_senders_only: false, auth_type: 'google_oauth', has_oauth: false, has_password: false,
      oauth_email: null, oauth_connected_at: null, last_ok_at: null,
      last_error: '"hello@" is set to use Google sign-in but has no grant stored. Connect it in Settings → Keys → Mailboxes.',
      matched: 0, unsubscribed: 0, ooo_queued: 0 },
    { id: 'i3', label: 'studio@', host: 'imap.fastmail.com', port: 993,
      username: 'studio@octobercomms.com', active: true, poll_replies: true, scan_ooo: false,
      known_senders_only: true, auth_type: 'password', has_oauth: false, has_password: true,
      oauth_email: null, oauth_connected_at: null, last_ok_at: new Date(Date.now() - 36e5).toISOString(),
      last_error: null, matched: 9, unsubscribed: 0, ooo_queued: 0 },
  ] },
  // ── Earned + Produce, enough to open one record of every searchable kind ──
  '/api/pr/clients/c1/press-releases': { items: [
    { id: 'p1', title: 'Atlas launch coverage', status: 'draft', updated_at: new Date().toISOString() },
    { id: 'p2', title: 'Second release', status: 'draft', updated_at: new Date().toISOString() },
  ] },
  '/api/pr/clients/c1/editorial-log': { items: [
    { id: 'e1', story_title: 'Atlas in Wallpaper', status: 'published', status_label: 'Published',
      outlet: 'Wallpaper', journalist: 'Amy Frearson', country: 'UK', story_url: 'https://example.com/a',
      issue_date: '2026-09-01', request_date: null, notes_outcome: '', pitch_request: '' },
    { id: 'e2', story_title: 'Another story', status: 'published', status_label: 'Published',
      outlet: 'Dezeen', journalist: '', country: 'UK', story_url: '', issue_date: null,
      request_date: null, notes_outcome: '', pitch_request: '' },
  ] },
  '/api/pr/clients/c1/journalists': { items: [
    { id: 'j1', name: 'Amy Frearson', outlet: 'Dezeen', email: 'a@b.c' },
  ] },
  '/api/pr/clients/c1/warm-journalists': { items: [] },
  '/api/pr/clients/c1/journalist-suggestions': { items: [] },
  '/api/pr/clients/c1/thank-opportunities': { items: [] },
  '/api/pr/clients/c1/thank-settings': { thank_stage: 'off', stages: [], record: null },
  '/api/pr/clients/c1/searches': { items: [], serper_configured: true },
  '/api/pr/clients/c1/review-queue': { items: [] },
  '/api/pr/clients/c1/report-settings': {},
  '/api/pr/clients/c1/stats': {},
  // Owned → Fix. Two rows each, enough to measure the row actions.
  '/api/seo/clients/c1/quick-wins': { wins: [
    { id: 'w1', keyword: 'garden room planning', current_position: 12, previous_position: 15, trend: 3, effort_score: 2, target_url: 'https://example.com/a', intent: 'informational' },
    { id: 'w2', keyword: 'oak frame extension cost', current_position: 18, previous_position: 18, trend: 0, effort_score: 7, target_url: 'https://example.com/b', intent: 'commercial' },
  ] },
  '/api/seo/clients/c1/ctr-opportunities': { opportunities: [
    { id: 'o1', query: 'garden room planning', impressions: 4200, clicks: 44, ctr: 0.0105, expected_ctr: 0.041, missed_clicks: 128, position: 6.2, url: 'https://example.com/a' },
  ], days: 28, startDate: '2026-10-03', endDate: '2026-10-31' },
  // Campaign detail, enough for both halves of it to render.
  '/api/press/clients/c1/warm-config': { threshold: 2, enabled: true },
  '/api/press/clients/c1/sender': { from_name: 'October', from_email: 'pr@octobercomms.com', verified: true },
  '/api/press/audience': { contacts: [], tags: [] },
  '/api/press/journalists': { items: [] },
  // Four campaigns covering every state the list has to draw: mid-send,
  // paused, finished, and a draft with no campaign_id at all.
  '/api/press/clients/c1/releases': [
    { id: 'k1', campaign_id: 'k1', title: 'Atlas launch coverage', display_name: 'Atlas launch pitch',
      campaign_status: 'live', created_at: new Date().toISOString(),
      stat_sent: 12, stat_first_total: 40, stat_pending: 28, stat_opened: 5, stat_clicked: 2,
      stat_failed: 1, stat_eta_seconds: 900 },
    { id: 'k2', campaign_id: 'k2', title: 'Hillcroft spring planting',
      campaign_status: 'paused', created_at: new Date().toISOString(),
      stat_sent: 30, stat_first_total: 90, stat_pending: 60, stat_opened: 9, stat_clicked: 3, stat_failed: 0 },
    { id: 'k3', campaign_id: 'k3', title: 'Northgate Studio shingle house',
      campaign_status: 'live', created_at: new Date().toISOString(),
      stat_sent: 55, stat_first_total: 55, stat_pending: 0, stat_opened: 21, stat_clicked: 8, stat_failed: 0 },
    { id: 'k4', title: 'Untitled draft', created_at: new Date().toISOString() },
  ],
  '/api/outreach/contacts': [],
  '/api/transcripts': { items: [
    { id: 't1', title: 'Atlas walkthrough notes', status: 'ready', named: true, speakers: ['s0', 's1'] },
    { id: 't2', title: 'Another transcript', status: 'ready', named: true, speakers: ['s0'] },
  ] },
  '/api/recordings': [
    { id: 'v1', title: 'Atlas walkthrough', status: 'ready', created_at: new Date().toISOString(), duration_s: 61, view_count: 2, client_ids: ['c1'] },
    { id: 'v2', title: 'Another recording', status: 'ready', created_at: new Date().toISOString(), duration_s: 30, view_count: 0, client_ids: ['c1'] },
  ],
  '/api/clients/c1/assets': { assets: [
    { id: 'as1', title: 'Atlas hero still', kind: 'image', url: '/vite.svg', source: 'produce' },
    { id: 'as2', title: 'Another asset', kind: 'image', url: '/vite.svg', source: 'produce' },
  ], counts: {}, sources: ['produce'] },
  '/api/clients': C,
  '/api/dashboard': {
    clients: [
      { ...C[0], connectors: [{ type: 'ga4', status: 'active' }, { type: 'meta_ads', status: 'active' }], last_report: { id: 'r1', report_type: 'monthly', status: 'skipped_no_recipients', created_at: '2026-10-19' }, strategy: { template_name: 'Design-led DTC', done: 3, total: 5, pct: 60 } },
      { ...C[1], connectors: [{ type: 'ga4', status: 'active' }, { type: 'meta_ads', status: 'expired' }], last_report: null, strategy: { template_name: 'Local service growth', done: 5, total: 5, pct: 100 } },
      { ...C[2], connectors: [], last_report: null, strategy: null },
    ],
    alerts: { expired_meta_tokens: [{ id: 'x1', client_id: 'c2', client_name: 'Hillcroft Gardens', connector_type: 'meta_ads' }] },
    upcoming_reports: [],
    recent_reports: [
      { id: 'r1', client_id: 'c1', client_name: 'Oculi Mundi', report_type: 'monthly', status: 'sent', created_at: '2026-10-01', sent_at: '2026-10-02', period_start: '2026-09-01', period_end: '2026-09-30' },
    ],
    report_health: { sent: 1, skipped_no_recipients: 9, failed: 0, total: 10 },
    api_spend: { totals: { USD: 42.5 }, period_start: '2026-10-01' },
  },
  // Strategy templates, so the list-and-editor split on
  // Settings → Tools → Strategy templates can be driven.
  '/api/strategy/meta': {
    business_types: [{ value: 'ecommerce', label: 'E-commerce' }, { value: 'service', label: 'Service' }],
    lifecycle_stages: [{ value: 'launch', label: 'Launch' }, { value: 'growth', label: 'Growth' }],
  },
  '/api/strategy/templates': { templates: [
    { id: 'st1', name: 'Design-led DTC', business_type: 'ecommerce', lifecycle_stage: 'growth',
      summary: 'Build demand on craft, convert on clarity.', is_seed: true,
      phases: [{ title: 'Foundations', items: ['Audit the product pages', 'Fix the size guide'] }] },
    { id: 'st2', name: 'Local service growth', business_type: 'service', lifecycle_stage: 'launch',
      summary: 'Own the postcode before the category.', is_seed: false,
      phases: [{ title: 'Groundwork', items: ['Claim the GBP listing'] }] },
  ] },
  '/api/strategy/overview': { clients: [{ client_id: 'c1', client_name: 'Oculi Mundi', business_type: 'ecommerce', lifecycle_stage: 'growth', template_name: 'Design-led DTC', pct: 60, done: 3, total: 5 }] },
  // pitched_rds is the honest figure (a domain matching an outlet the
  // campaign emailed); new_rds is every domain the site gained in the window
  // and is context, not a result.
  '/api/press/attribution/leaderboard': { campaigns: [
    { press_release_id: 'p1', client_id: 'c1', client_name: 'Oculi Mundi', title: 'Atlas launch', new_rds: 7, dofollow_rds: 4, pitched_rds: 3, recipients: 90, rds_per_recipient: 0.08 },
    { press_release_id: 'p2', client_id: 'c1', client_name: 'Oculi Mundi', title: 'Second edition', new_rds: 2, dofollow_rds: 1, pitched_rds: 1, recipients: 30, rds_per_recipient: 0.03 },
  ] },
  '/api/settings/workspace-links': { projects: '', docs: '' },
  '/api/reports': [
    { id: 'r1', client_id: 'c1', client_name: 'Oculi Mundi', report_type: 'weekly', status: 'skipped_no_recipients', created_at: '2026-10-19', sent_at: null, period_start: '2026-10-12', period_end: '2026-10-18' },
    { id: 'r2', client_id: 'c2', client_name: 'Hillcroft Gardens', report_type: 'weekly', status: 'sent', created_at: '2026-10-19', sent_at: '2026-10-19', period_start: '2026-10-12', period_end: '2026-10-18' },
  { id: 'r3', client_id: 'c1', client_name: 'Oculi Mundi', report_type: 'monthly', status: 'failed', created_at: '2026-10-01', generated_at: '2026-10-01', period_start: '2026-09-01', period_end: '2026-09-30', error_log: 'GA4 token expired' },
  ],
  '/api/platform-keys': { keys: [], categories: [] },
  '/api/strategist/clients/c1/briefings': [
    { id: 'b1', period_start: '2026-10-22', period_end: '2026-10-29', status: 'completed', trigger: 'weekly_cron', generated_at: new Date().toISOString(), read_at: null },
    { id: 'b0', period_start: '2026-10-15', period_end: '2026-10-22', status: 'completed', trigger: 'weekly_cron', generated_at: new Date(Date.now() - 7*86400000).toISOString(), read_at: new Date().toISOString() },
  ],
  '/api/strategist/clients/c1/steer': [],
  // A second client with its own briefing, so switching between them can be
  // driven. c1's queue talks about enamelware; c2's about tours. Either
  // showing up under the other is the bug.
  '/api/clients/c2': { id: 'c2', name: 'Hillcroft Gardens', slug: 'hillcroft-gardens', active: true, report_recipients: { weekly: [], monthly: [] }, report_schedule: {}, report_sections: {} },
  '/api/strategist/clients/c2/steer': [],
  '/api/strategist/clients/c2/briefings': [
    { id: 'b2', period_start: '2026-10-22', period_end: '2026-10-29', status: 'completed', trigger: 'weekly_cron', generated_at: new Date().toISOString(), read_at: null },
  ],
  '/api/strategist/briefings/b2': {
    id: 'b2', client_id: 'c2', status: 'completed', period_start: '2026-10-22', period_end: '2026-10-29',
    generated_at: new Date().toISOString(),
    synthesis: '### What changed\n\n- Hillcroft is a different client entirely.',
    sections: [{ pillar: 'owned', label: 'Owned', ok: true, markdown: 'Hillcroft owned analysis.' }],
    recommendations: [
      { id: 'h1', pillar: 'owned', priority: 'crucial', position: 1, text: 'Replant the border beds', rationale: 'Hillcroft only.', done: false, first_raised_at: new Date().toISOString(), carried_from: null },
    ],
  },
  '/api/clients/c2/readiness': { score: { done: 1, total: 10 }, checks: [] },
  '/api/connectors/client/c2': [],
  '/api/connectors/client/c2/health': { total: 1, active: 1, errored: 0, expired: 0, worst: 'ok' },
  '/api/reports/client/c2': [],
  '/api/report-templates/client/c2': { weekly: null, monthly: null },
  '/api/strategy/clients/c2/strategy': { strategy: null },
  '/api/strategist/clients/c1/queue': { briefing_id: 'b1', generated_at: new Date().toISOString(), items: [
    { id: 'q1', pillar: 'paid',   priority: 'crucial', position: 1, text: 'Fix the Meta Pixel on Summer Sale', rationale: '4,360 clicks at zero conversions.', done: false, first_raised_at: new Date(Date.now() - 23*86400000).toISOString() },
    { id: 'q2', pillar: 'cross',  priority: 'crucial', position: 2, text: 'Get GA4 attributing revenue across all six stores', rationale: 'No baseline until we know which store earned it.', done: false, first_raised_at: new Date(Date.now() - 2*86400000).toISOString() },
    { id: 'q4', pillar: 'owned',  priority: 'nice',    position: 3, text: 'Refresh the three Atlas product pages', rationale: 'Organic fell 18% on those three.', done: false, first_raised_at: new Date(Date.now() - 9*86400000).toISOString() },
  ] },
  '/api/strategist/briefings/b1': {
    id: 'b1', client_id: 'c1', status: 'completed', period_start: '2026-10-22', period_end: '2026-10-29',
    generated_at: new Date().toISOString(),
    synthesis: '### What changed\n\n- The Meta Pixel is still dead; a third week of 4,360 clicks at zero conversions.\n- Google Ads data came back on the UK account on 24 Oct.\n\n### The queue\n\n- [CRUCIAL][A1] Fix the Meta Pixel on Summer Sale :: 4,360 clicks at zero conversions.\n- [NICE] Draft the retargeting plan :: ready for when conversions register.',
    sections: [
      { pillar: 'paid', label: 'Paid', ok: true, markdown: '### The state of play\nSpend held at £2,140 with a 3.5% CTR.' },
      { pillar: 'earned', label: 'Earned', ok: false, markdown: '' },
      { pillar: 'shared', label: 'Shared', ok: false, markdown: '' },
      { pillar: 'owned', label: 'Owned', ok: false, markdown: '' },
    ],
    recommendations: [
      { id: 'q1', pillar: 'paid', priority: 'crucial', position: 1, text: 'Fix the Meta Pixel on Summer Sale', rationale: '4,360 clicks at zero conversions is a tracking failure, not a performance result.', done: false, first_raised_at: new Date(Date.now() - 23*86400000).toISOString(), carried_from: 'old-1' },
      { id: 'q2', pillar: 'cross', priority: 'crucial', position: 2, text: 'Get GA4 attributing revenue across all six stores', rationale: 'Until we know which store earned the £140,967 there is no baseline.', done: false, first_raised_at: new Date(Date.now() - 2*86400000).toISOString(), carried_from: null },
      { id: 'q3', pillar: 'paid', priority: 'nice', position: 3, text: 'Draft the retargeting plan', rationale: 'Shovel-ready saves a month once tracking is live.', done: true, first_raised_at: new Date(Date.now() - 40*86400000).toISOString(), carried_from: null },
    ],
  },
  '/api/reports/client/c1': [
    { id: 'r1', report_type: 'weekly', status: 'sent', period_start: '2026-10-12', generated_at: '2026-10-19' },
    { id: 'r2', report_type: 'monthly', status: 'failed', period_start: '2026-09-01', generated_at: '2026-10-01', error_log: 'GA4 token expired' },
  ],
  '/api/report-templates/client/c1': { weekly: null, monthly: null },
  // The shape the page actually fetches: one call per type, { template }.
  // Six weekly sections and twenty monthly, so both the plain list and the
  // --long two-column split render.
  '/api/clients/c1/report-template/weekly': {
    template: { sections: Array.from({ length: 6 }, (_, i) => ({ id: 'w' + i, title: 'Revenue and orders ' + (i + 1), type: 'kpi' })) },
  },
  '/api/clients/c1/report-template/monthly': {
    template: { sections: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, title: 'Channel performance ' + (i + 1), type: 'chart' })) },
  },
  '/api/clients/c1': { id: 'c1', name: 'Oculi Mundi', slug: 'oculi-mundi', active: true, report_recipients: { weekly: [], monthly: ['a@b.c'] }, report_schedule: {}, report_sections: {}, briefing_field: '', domain: 'oculimundi.com' },
  // Worked examples: c1 has Paid only, c3 has none. STUB_WE_FAIL makes one
  // pillar fail, which is the case the panel must report rather than swallow.
  '/api/clients/c1/worked-examples': { missing: 3, results: [
    { pillar: 'paid', label: 'Paid', what: 'a batch of ad concepts', present: true, id: 'ba1' },
    { pillar: 'shared', label: 'Shared', what: 'a batch of social posts', present: false, id: null },
    { pillar: 'owned', label: 'Owned', what: 'a drafted article', present: false, id: null },
    { pillar: 'earned', label: 'Earned', what: 'a drafted press release', present: false, id: null },
  ] },
  '/api/clients/c3/worked-examples': { missing: 4, results: [
    { pillar: 'paid', label: 'Paid', what: 'a batch of ad concepts', present: false, id: null },
    { pillar: 'shared', label: 'Shared', what: 'a batch of social posts', present: false, id: null },
    { pillar: 'owned', label: 'Owned', what: 'a drafted article', present: false, id: null },
    { pillar: 'earned', label: 'Earned', what: 'a drafted press release', present: false, id: null },
  ] },
  '/api/clients/c2/worked-examples': { missing: 0, results: [
    { pillar: 'paid', label: 'Paid', what: 'a batch of ad concepts', present: true, id: 'ba2' },
    { pillar: 'shared', label: 'Shared', what: 'a batch of social posts', present: true, id: 'sb1' },
    { pillar: 'owned', label: 'Owned', what: 'a drafted article', present: true, id: 'cd1' },
    { pillar: 'earned', label: 'Earned', what: 'a drafted press release', present: true, id: 'pr1' },
  ] },
  '/api/rankings/keywords': [],
  '/api/rankings/tags/c1': [],
  '/api/rankings/history/c1': [],
  '/api/clients/c1/suite-progress/owned_search': { steps: [], pct: 0 },
  // Authority metrics: a fetched month and an older hand-typed one, so the
  // provenance labels can be read off the page.
  '/api/rankings/seo-metrics/c1': [
    { id: 'm1', client_id: 'c1', month: '2026-10-01', moz_da: 48, authority_score: null, referring_domains: 1321,
      notes: null, moz_da_source: 'moz', referring_domains_source: 'dataforseo', sources_filled_at: '2026-10-01T07:00:00Z' },
    { id: 'm2', client_id: 'c1', month: '2026-09-01', moz_da: 47, authority_score: 36, referring_domains: 1293,
      notes: 'Migration month', moz_da_source: 'manual', referring_domains_source: 'manual', sources_filled_at: null },
  ],
  '/api/clients/c1/readiness': { score: { done: 3, total: 10 }, checks: [] },
  '/api/connectors/client/c1': [],
  '/api/connectors/client/c1/ads-data': {
    google_ads: GOOGLE_ADS, meta_ads: META_ADS, days: 30, startDate: '2026-09-29', endDate: '2026-10-29',
    currency: summariseAdsCurrency(process.env.STUB_CLIENT_CURRENCY || null, GOOGLE_ADS, META_ADS),
  },
  // ── Paid → Build ────────────────────────────────────────────────────
  // c1 and c2 both populated, and deliberately with different creative, so a
  // client switch that keeps the old selection is visible rather than
  // plausible.
  '/api/ad-creatives/clients/c1/batches': [
    { id: 'ba1', client_id: 'c1', brief: 'Autumn enamelware, trade buyers', platform: 'meta', is_example: false, creative_count: 2, created_at: '2026-10-20T09:00:00Z' },
  ],
  '/api/ad-creatives/clients/c2/batches': [
    { id: 'ba2', client_id: 'c2', brief: 'Spring planting service', platform: 'google', is_example: false, creative_count: 1, created_at: '2026-10-21T09:00:00Z' },
  ],
  '/api/ad-creatives/clients/c1/creatives': [
    // Two concepts: one carrying the framework_rationale the generator has
    // always written and the UI never showed, one without, so the tooltip is
    // exercised on both paths.
    { id: 'cr1', client_id: 'c1', batch_id: 'ba1', headline: 'Enamel bowls built to outlive you',
      body: 'Vitreous enamel over heavy-gauge steel. The ones in our studio kitchen are from 2009.',
      cta: 'Shop the range', angle: 'Longevity', framework: 'PAS',
      framework_rationale: 'Trade buyers replace cheap enamelware twice a year, so the pain is already felt.',
      visual_concept: 'Chipped supermarket bowl beside an unmarked one of ours, same age, on a steel bench.',
      notes: '', show_to_client: true, images: [{ id: 'im1',
        // STUB_KEPT=1 makes this asset one that lives on the platform, so the
        // Launch step's "keep a copy" card has nothing left to offer. Default
        // is the provider-link shape, which is what other drives assert on.
        // The backfill endpoint below flips it at runtime, so a drive can see
        // the card disappear after the run rather than only after a reload.
        get url() { return (process.env.STUB_KEPT === '1' || backfilled) ? '/api/brand/file/c1/im1.png' : '/vite.svg'; },
        get source_url() { return (process.env.STUB_KEPT === '1' || backfilled) ? 'https://cdn.ideogram.ai/im1.png' : null; },
        get stored_bytes() { return (process.env.STUB_KEPT === '1' || backfilled) ? 184320 : null; },
        aspect_ratio: '1:1', media_type: 'image' }] },
    { id: 'cr2', client_id: 'c1', batch_id: 'ba1', headline: 'Four hundred kitchens specified it',
      body: 'Hospitality groups from Margate to Glasgow.', cta: 'See the spec sheet',
      angle: 'Credibility', framework: 'Social Proof', framework_rationale: null,
      visual_concept: 'Grid of venue photos, logo-free.', notes: '', show_to_client: true, images: [] },
  ],
  '/api/ad-creatives/clients/c2/creatives': [
    { id: 'cr9', client_id: 'c2', batch_id: 'ba2', headline: 'Borders planted before the frost', angle: 'Seasonal', images: [] },
  ],
  '/api/ad-creatives/clients/c1/library': [
    { id: 'im1', url: '/vite.svg', provider: 'ideogram', aspect_ratio: '1:1', media_type: 'image', created_at: '2026-10-20T10:00:00Z', creative_id: 'cr1', headline: 'Enamel bowls built to outlive you', batch_id: 'ba1', platform: 'meta', is_example: false },
    { id: 'im2', url: '/vite.svg', provider: 'ideogram', aspect_ratio: '9:16', media_type: 'image', created_at: '2026-10-20T10:01:00Z', creative_id: 'cr1', headline: 'Enamel bowls built to outlive you', batch_id: 'ba1', platform: 'meta', is_example: false },
  ],
  '/api/ad-creatives/clients/c2/library': [
    { id: 'im9', url: '/vite.svg', provider: 'ideogram', aspect_ratio: '4:5', media_type: 'image', created_at: '2026-10-21T10:00:00Z', creative_id: 'cr9', headline: 'Borders planted before the frost', batch_id: 'ba2', platform: 'google', is_example: false },
  ],
  '/api/ad-creatives/clients/c1/ad-sizes': { groups: [{ family: 'Meta', sizes: [{ key: 'meta_1_1', w: 1080, h: 1080 }, { key: 'meta_9_16', w: 1080, h: 1920 }] }], prices: { expand: 0.05, upscale: 0.03 } },
  '/api/ad-creatives/clients/c2/ad-sizes': { groups: [{ family: 'Meta', sizes: [{ key: 'meta_1_1', w: 1080, h: 1080 }] }], prices: { expand: 0.05, upscale: 0.03 } },
  '/api/ad-creatives/clients/c1/resize-batches': [],
  '/api/ad-creatives/clients/c2/resize-batches': [],
  '/api/brand/clients/c1/assets': [{ id: 'a1', kind: 'logo', url: '/vite.svg' }],
  '/api/brand/clients/c2/assets': [],
  '/api/competitor-ads/clients/c1': { configured: true, runs: [
    { id: 'ru1', query: 'rival.com', region: 'GB', ad_count: 24, created_at: '2026-10-22T09:00:00Z',
      analysis: { overview: 'They are leaning hard on free delivery.', angles: ['Free delivery over £50'], longest_running: ['The guarantee ad, 14 months'], counter_ideas: ['Lead on the repair service'] },
      ads: [{ text: 'Free delivery on everything', format: 'image', target_domain: 'rival.com' }] },
  ] },
  // c3 is the untouched client: connectors, no briefs. It is the only way to
  // drive the no-brief empty state, which is the thing the account lead
  // called confusing.
  '/api/clients/c3': { id: 'c3', name: 'Falcon Interiors', slug: 'falcon-interiors', active: true, report_recipients: { weekly: [], monthly: [] }, report_schedule: {}, report_sections: {}, briefing_field: '', domain: 'falcon.example' },
  '/api/clients/c3/readiness': { score: { done: 0, total: 10 }, checks: [] },
  '/api/connectors/client/c3': [],
  '/api/connectors/client/c3/health': { total: 0, active: 0, errored: 0, expired: 0, worst: 'none' },
  '/api/connectors/client/c3/ads-data': { google_ads: [], meta_ads: [], days: 30, startDate: '2026-09-29', endDate: '2026-10-29', currency: summariseAdsCurrency(null, [], []) },
  '/api/ad-creatives/clients/c3/batches': [],
  '/api/ad-creatives/clients/c3/creatives': [],
  '/api/ad-creatives/clients/c3/library': [],
  '/api/ad-creatives/clients/c3/ad-sizes': { groups: [], prices: { expand: 0.05, upscale: 0.03 } },
  '/api/ad-creatives/clients/c3/resize-batches': [],
  '/api/brand/clients/c3/assets': [],
  '/api/competitor-ads/clients/c3': { configured: true, runs: [] },
  '/api/funnel/clients/c3/icp': { icp: null },
  '/api/audiences/clients/c3/segments': [],
  '/api/audiences/clients/c3/postcode-distribution': { postcodes: [], total_orders: 0, total_revenue: 0, source: null, currency: null, currency_note: null, from_cache: false },
  '/api/competitor-ads/clients/c2': { configured: true, runs: [] },
  '/api/funnel/clients/c1/icp': { icp: null },
  '/api/funnel/clients/c2/icp': { icp: null },
  '/api/audiences/clients/c2/postcode-distribution': { postcodes: [], total_orders: 0, total_revenue: 0, source: null, currency: null, currency_note: null, from_cache: false },
  '/api/audiences/clients/c2/segments': [],
  '/api/clients/c2/readiness': { score: { done: 1, total: 10 }, checks: [] },
  '/api/connectors/client/c2': [],
  '/api/connectors/client/c2/health': { total: 1, active: 1, errored: 0, expired: 0, worst: 'ok' },
  '/api/audiences/clients/c1/segments': [
    { id: 'sg1', name: 'High-value SW postcodes', description: 'Top decile by revenue.', source: 'postcode', estimated_reach: 1840 },
    { id: 'sg2', name: 'Trade buyer list', description: 'Uploaded 14 Oct.', source: 'customer_list', estimated_reach: 612 },
  ],
  '/api/audiences/clients/c1/postcode-distribution': {
    postcodes: [
      { postcode_district: 'SW3', customer_count: 40, order_count: 61, revenue: 18400 },
      { postcode_district: 'NW3', customer_count: 22, order_count: 30, revenue: 9100 },
    ],
    total_orders: 91, total_revenue: 27500, source: 'shopify',
    computed_at: new Date().toISOString(),
    currency: process.env.STUB_POSTCODE_CURRENCY === 'none' ? null : (process.env.STUB_POSTCODE_CURRENCY || 'USD'),
    currency_note: null,
    from_cache: false,
  },
  '/api/clients/c2': { id: 'c2', name: 'Hillcroft Gardens', slug: 'hillcroft-gardens', active: true, report_recipients: { weekly: [], monthly: [] }, report_schedule: {}, report_sections: {}, briefing_field: '', domain: 'hillcroftgardens.co.uk' },
  '/api/connectors/client/c2/ads-data': {
    google_ads: [], meta_ads: [], days: 30, startDate: '2026-09-29', endDate: '2026-10-29',
    currency: summariseAdsCurrency(null, [], []),
  },
  '/api/connectors/client/c1/health': { total: 4, active: 3, errored: 0, expired: 0, worst: 'partial' },
  // An UNTAILORED plan: a playbook assigned, no profile, and not one item
  // with its own `how`. That is the state every new client starts in, and the
  // state in which the plan used to be forty bare lines.
  '/api/strategy/clients/c1/strategy': { strategy: {
    template_name: 'Retail · Growth',
    summary: 'SOSTAC plan to scale profitably: expand winning channels, raise AOV and repeat rate.',
    profile: null,
    progress: { done: 0, total: 15 },
    phases: [
      { title: 'Situation Analysis', items: [
        { id: 's1', text: 'Review channel performance + unit economics to date', done: false, note: '', how: [] },
        { id: 's2', text: 'Identify winning creatives, audiences & SKUs', done: false, note: '', how: [] },
        { id: 's3', text: 'Map the gaps competitors are exploiting', done: false, note: '', how: [] },
      ] },
      { title: 'Objectives', items: [
        { id: 'o1', text: 'Set growth targets: revenue, ROAS, repeat rate, LTV', done: false, note: '', how: [] },
        { id: 'o2', text: 'Define an AOV uplift target', done: false, note: '', how: [] },
        { id: 'o3', text: 'Set a new-customer vs returning revenue split', done: false, note: '', how: [] },
      ] },
      { title: 'Strategy', items: [
        { id: 't1', text: 'Decide which channels to scale + the second channel', done: false, note: '', how: [] },
        { id: 't2', text: 'Retention strategy: lifecycle flows + loyalty', done: false, note: '', how: [] },
      ] },
      { title: 'Tactics', items: [
        { id: 'c1', text: 'Scale winning paid campaigns; systematise weekly creative tests', done: false, note: '', how: [] },
        { id: 'c2', text: 'Stand up SEO/content for high-intent terms', done: false, note: '', how: [] },
      ] },
      { title: 'Action', items: [
        { id: 'a1', text: 'Resource the content + creative pipeline', done: false, note: '', how: [] },
        { id: 'a2', text: 'Schedule promos against the calendar', done: false, note: '', how: [] },
      ] },
      { title: 'Control', items: [
        { id: 'n1', text: 'Weekly KPI review: CAC, ROAS, repeat rate, LTV:CAC', done: false, note: '', how: [] },
        { id: 'n2', text: 'Kill underperformers; reinvest in winners', done: false, note: '', how: [] },
      ] },
    ],
  } },
  '/api/sales-traffic/c1': { kpis: { revenue: 48210, orders: 183, aov: 263, sessions: 9120, users: 7430, conversionRate: 2.01 },
    salesTrend: [{date:'2026-10-01',revenue:1200,orders:5},{date:'2026-10-08',revenue:2100,orders:9},{date:'2026-10-15',revenue:1700,orders:7}],
    trafficTrend: [{date:'2026-10-01',sessions:300,users:240},{date:'2026-10-08',sessions:410,users:330},{date:'2026-10-15',sessions:380,users:300}],
    channels: [{channel:'Organic Search',sessions:4200},{channel:'Direct',sessions:2600},{channel:'Paid',sessions:1400}],
    ecom: { netRevenue: 46000, refundRate: 4.6, refunds: 2210, refundedOrders: 8, discountRate: 11.2, discounts: 5400, newCustomerOrders: 120, returningCustomerOrders: 63, topProducts: [{title:'Atlas Globe',units:40,revenue:12000}] },
    pillars: {
      paid:     { sessions: 2000, orders: 50, revenue: 15000, share: { sessions: 20, orders: 25, revenue: 26.5 }, channels: [
        { channel: 'Paid Search', sessions: 1500, orders: 40, revenue: 12000 },
        { channel: 'Paid Social', sessions: 500, orders: 10, revenue: 3000 } ] },
      owned:    { sessions: 4000, orders: 80, revenue: 20000, share: { sessions: 40, orders: 40, revenue: 35.3 }, channels: [
        { channel: 'Organic Search', sessions: 4000, orders: 80, revenue: 20000 } ] },
      shared:   { sessions: 600, orders: 5, revenue: 1200, share: { sessions: 6, orders: 2.5, revenue: 2.1 }, channels: [
        { channel: 'Organic Social', sessions: 600, orders: 5, revenue: 1200 } ] },
      earned:   { sessions: 400, orders: 8, revenue: 2400, share: { sessions: 4, orders: 4, revenue: 4.2 }, channels: [
        { channel: 'Referral', sessions: 400, orders: 8, revenue: 2400 } ] },
      unmapped: { sessions: 3000, orders: 60, revenue: 18000, share: { sessions: 30, orders: 30, revenue: 31.8 }, channels: [
        { channel: 'Direct', sessions: 3000, orders: 60, revenue: 18000 } ] },
      total: { sessions: 10000, orders: 200, revenue: 56600 },
    },
    notes: [],
    currency: process.env.STUB_CURRENCY === 'none' ? null : (process.env.STUB_CURRENCY || 'GBP'),
    currency_unset: process.env.STUB_CURRENCY === 'none' },
  '/api/chat/c1': [
    { id: 'm1', role: 'user', content: 'Why did sessions drop last week?', created_at: '2026-10-28T10:00:00Z' },
    { id: 'm2', role: 'assistant', content: 'Organic search fell 18% while paid held flat. The drop is concentrated on three product pages.', created_at: '2026-10-28T10:00:20Z' },
  ],
  '/api/chat/c1/context': [
    { id: 'e1', type: 'investigation', content: 'Organic drop on the three Atlas product pages — checking index coverage.', created_at: '2026-10-28T10:01:00Z', status: 'open', resolved_at: null },
    { id: 'e2', type: 'decision', content: 'Hold the paid budget flat until organic is diagnosed.', created_at: '2026-10-27T09:00:00Z', status: 'open', resolved_at: null },
    { id: 'e3', type: 'observation', content: 'AOV up 6% month on month.', created_at: '2026-10-20T09:00:00Z', status: 'resolved', resolved_at: '2026-10-26T09:00:00Z' },
  ],
  '/api/reports/bulk-deletable': { statuses: { skipped_no_recipients: 11, failed: 2 }, total: 13, deletable: ['skipped_no_recipients','failed','pending'] },
  '/api/reports/delivery': {
    clients: [
      { id: 'c1', name: 'Oculi Mundi', slug: 'oculi-mundi', weekly: { recipients: 0, scheduled: true, delivers: false }, monthly: { recipients: 2, scheduled: true, delivers: true } },
      { id: 'c2', name: 'Hillcroft Gardens', slug: 'hillcroft-gardens', weekly: { recipients: 2, scheduled: true, delivers: true }, monthly: { recipients: 0, scheduled: false, delivers: false } },
      { id: 'c3', name: 'Falcon Interiors', slug: 'falcon-interiors', weekly: { recipients: 0, scheduled: true, delivers: false }, monthly: { recipients: 0, scheduled: false, delivers: false } },
    ],
    skipping: ['c1', 'c3'],
  },
};


// Shared → Swipe, for the phone drive. Four reels covering every state the
// row can be in: one with a full idea card, one still transcribing (no card,
// so nothing to expand on desktop), one failed with an error, and one whose
// stored title is the scraped placeholder so displayName has to fall back.
API['/api/swipe-file/clients/c1/swipe'] = { items: [
  { id: 's1', url: 'https://instagram.com/reel/aaa', platform: 'instagram', status: 'done',
    title: 'We costed three kitchens and published the invoices', notes: 'fee transparency',
    transcript: 'Line one.\nLine two.',
    idea_card: { hook: 'The quote you were given is not the price', summary: 'Breaks down a real invoice line by line.',
      why_it_works: 'Specific numbers people can check.', format: 'Talking head over b-roll',
      angles: ['Do it for a bathroom', 'Do it for a loft'], tags: ['fees', 'teardown'] } },
  { id: 's2', url: 'https://tiktok.com/@x/video/bbb', platform: 'tiktok', status: 'processing',
    title: 'Video by @designstudio', notes: '', transcript: null, idea_card: null },
  { id: 's3', url: 'https://youtube.com/shorts/ccc', platform: 'youtube', status: 'failed',
    title: 'A short that would not download', notes: '', transcript: null, idea_card: null,
    error: 'yt-dlp: video is private.' },
  { id: 's4', url: 'https://instagram.com/reel/ddd', platform: 'instagram', status: 'done',
    title: '', notes: 'saved on the train', transcript: null,
    idea_card: { title: 'Three questions before you sign', hook: 'Ask these three things', angles: [] } },
] };


// PUT /api/ad-creatives/creatives/:id — merge and echo, logging the body so a
// drive can assert the request carried only the fields that changed.
const CREATIVE_EDITS = __dirname + '/creative-edits.log';


// Paid → Competitors. A stored list that survives navigation, a Claude call
// counted so a drive can prove the panel does not spend on every open, and
// one pull that returns ads.
let COMPETITORS = [
  { id: 1, name: 'Rival Supply', domain: 'rival.com', reason: 'Same trade buyers, same price band.',
    region: 'GB', source: 'quickstart', last_ad_count: 7, last_pulled_at: '2026-10-28T09:00:00Z', last_run_id: 11 },
  { id: 2, name: 'Nameless Brand', domain: null, reason: 'Known by name only.',
    region: 'GB', source: 'suggest', last_ad_count: null, last_pulled_at: null, last_run_id: null },
];
let COMPETITOR_SUGGEST_CALLS = 0;
let NEXT_COMPETITOR_ID = 3;
const COMPETITOR_RUNS = [
  { id: 11, query: 'rival.com', region: 'GB', ad_count: 2, created_at: '2026-10-28T09:00:00Z',
    analysis: { overview: 'Heavy on price framing.', longest_running: ['Trade discount, 180 days'],
      angles: ['Price', 'Speed'], counter_ideas: ['Lead on durability instead'] },
    ads: [
      { format: 'image', text: 'Trade prices on enamelware', image: '/vite.svg',
        target_domain: 'rival.com', first_shown: '2026-05-01', last_shown: '2026-10-27',
        details_link: 'https://adstransparency.google.com/x' },
      { format: 'video', text: 'See the range', image: null, target_domain: 'rival.com',
        first_shown: '2026-09-01', last_shown: null, details_link: 'https://adstransparency.google.com/y' },
    ] },
];


// ---- edit jobs: progress, Stop and Run again ---------------------------
// A render that advances on each poll, so the progress bar and its stage text
// can be driven, and a Stop that behaves like the real route: 409 when there
// is nothing running.
const EDIT_STAGES = [
  'Cutting block 1 of 3', 'Cutting block 2 of 3', 'Cutting block 3 of 3',
  'Joining 3 blocks', 'Rendering the video', 'Burning the captions on', 'Finishing',
];
let EDIT_JOBS = null;
function editJobsReset() {
  EDIT_JOBS = [
    { id: 'e1', name: 'timeline render', source_name: 'alpha.mp4', status: 'processing',
      progress: 0, stage: null, ops: {}, output_url: null, srt_url: null, error: null,
      created_at: new Date().toISOString(), _tick: 0 },
    { id: 'e2', name: 'waiting one', source_name: 'beta.mp4', status: 'queued',
      progress: 0, stage: null, ops: {}, output_url: null, srt_url: null, error: null,
      created_at: new Date().toISOString() },
    { id: 'e3', name: 'finished one', source_name: 'gamma.mp4', status: 'done',
      progress: 100, stage: null, ops: {}, output_url: '/clips/alpha.mp4', srt_url: null,
      error: null, created_at: new Date().toISOString() },
    // A finished job carrying a real edit, so "Edit again" can be driven:
    // two trimmed blocks, a cross-fade into the second, and one overlay. This
    // is the one path where stored data meets the model.
    { id: 'e4', name: 'saved edit', source_name: 'alpha.mp4', status: 'done',
      progress: 100, stage: null, output_url: '/clips/alpha.mp4', srt_url: null,
      error: null, created_at: new Date().toISOString(),
      clips: [{ url: '/clips/alpha.mp4', name: 'alpha.mp4' },
        { url: '/clips/beta.mp4', name: 'beta.mp4' }],
      ops: {
        aspect: 'original', clean_audio: false, captions: false,
        edl: { version: 1, items: [
          { id: 's1', clip: 0, in: 1.5, out: 7, gain: 1 },
          { id: 's2', clip: 1, in: 0.5, out: 3.5, gain: 1, trans: { type: 'fade', dur: 0.6 } },
        ] },
        overlays: [{ id: 'so1', text: 'SAVED TEXT', from: 0.5, to: 2.5, x: 0.4, y: 0.3, size: 0.07 }],
      } },
  ];
}
editJobsReset();

function editJobsList() {
  const live = EDIT_JOBS.find(j => j.id === 'e1' && j.status === 'processing');
  if (live) {
    // Advance one stage per poll. The first poll leaves progress at 0 so the
    // "Starting" state is reachable, which is what the page shows before the
    // first ffmpeg pass has reported anything.
    if (live._tick > 0) {
      const i = Math.min(EDIT_STAGES.length - 1, live._tick - 1);
      live.stage = EDIT_STAGES[i];
      live.progress = Math.round(((i + 1) / EDIT_STAGES.length) * 100);
    }
    live._tick += 1;
  }
  return EDIT_JOBS.map(({ _tick, ...rest }) => rest);
}

function ok(job, action) {
  if (action === 'cancel') return job.status === 'processing' || job.status === 'queued';
  return job.status === 'failed' || job.status === 'cancelled';
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/edit/clients/c1/edit' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(editJobsList()));
  }
  {
    const m = /^\/api\/edit\/clients\/c1\/edit\/([^/]+)\/(cancel|retry)$/.exec(url);
    if (m && req.method === 'POST') {
      const job = EDIT_JOBS.find(j => j.id === m[1]);
      res.writeHead(job && ok(job, m[2]) ? 200 : 409, { 'content-type': 'application/json' });
      if (!job) return res.end(JSON.stringify({ error: 'No such edit.' }));
      if (m[2] === 'cancel') {
        if (job.status !== 'processing' && job.status !== 'queued') {
          return res.end(JSON.stringify({ error: 'That edit is not running, so there is nothing to stop.' }));
        }
        const was = job.status;
        job.status = 'cancelled'; job.progress = 0; job.stage = null;
        return res.end(JSON.stringify({ ok: true, was, killed: was === 'processing' }));
      }
      if (job.status !== 'failed' && job.status !== 'cancelled') {
        return res.end(JSON.stringify({ error: 'Only failed or cancelled edits can be run again.' }));
      }
      job.status = 'queued'; job.progress = 0; job.stage = null; job._tick = 0;
      return res.end(JSON.stringify({ ok: true }));
    }
  }
  if (url === '/__edit/reset') {
    editJobsReset();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // Search. Shaped exactly like services/globalSearch.js returns, filtered the
  // same way (substring, case-insensitive), so the palette is driven against
  // real response shapes. ?slow=1 delays it, to watch the stale-drop.
  // One record by id — what a deep-linked result fetches.
  const ONE = [
    [/^\/api\/pr\/press-releases\/(p\d+)$/, (m) => ({ id: m[1], title: m[1] === 'p1' ? 'Atlas launch coverage' : 'Second release', status: 'draft', body_html: '<p>x</p>', brand: 'Oculi Mundi' })],
    [/^\/api\/transcripts\/(t\d+)$/, (m) => ({ id: m[1], title: m[1] === 't1' ? 'Atlas walkthrough notes' : 'Another transcript', status: 'ready', named: true, speaker_names: {}, speakers: ['s0', 's1'],
      segments: [{ speaker: 's0', text: 'The Atlas walkthrough, from the top.', start: 0, end: 4 }] })],
    [/^\/api\/pr\/journalists\/(j\d+)$/, (m) => ({ id: m[1], name: 'Amy Frearson', outlet: 'Dezeen', email: 'a@b.c' })],
    [/^\/api\/press\/campaigns\/(k\d+)\/release$/, () => ({ id: 'p1', title: 'Atlas launch coverage', status: 'draft', body_html: '<p>x</p>', brand: 'Oculi Mundi', campaign_id: 'k1' })],
    [/^\/api\/press\/releases\/(p\d+)\/backlink-attribution$/, () => ({
      launched: true, window_days: 30, new_rds: 7, dofollow_rds: 4, pitched_rds: 2, recipients: 90, links: [] })],
    [/^\/api\/press\/releases\/(p\d+)\/analytics/, () => ({
      totals: { recipients: 90, opened: 31, open_rate: 34, clicked: 12, click_rate: 13,
                replied: 4, reply_rate: 4, warm: 3, unsubscribed: 1, unsub_rate: 1 },
      recipient_total: 90, recipients: [], steps: [] })],
    [/^\/api\/press\/releases\/(p\d+)\/reply-status$/, () => ({ configured: false })],
    [/^\/api\/press\/releases\/(p\d+)\/suppression$/, () => ({ items: [] })],
    [/^\/api\/press\/releases\/(p\d+)\/exclusions$/, () => ({ items: [] })],
    [/^\/api\/press\/campaigns\/(k\d+)$/, (m) => ({ id: m[1], name: 'Atlas launch pitch', status: 'live', steps: [], recipients: [] })],
    // Results. Both stat rows at once, which is the whole point of the screen:
    // the attribution row and the engagement row render one under the other,
    // and each used to carry a black tile.
    [/^\/api\/press\/releases\/(p\d+)\/backlink-attribution$/, () => ({
      launched: true, window_days: 90, new_rds: 18, dofollow_rds: 11, pitched_rds: 4, recipients: 240,
    })],
    [/^\/api\/press\/releases\/(p\d+)\/analytics/, () => ({
      totals: { recipients: 240, opened: 96, open_rate: 40, clicked: 21, click_rate: 8.8,
        replied: 9, reply_rate: 3.8, warm: 3, unsubscribed: 2, unsub_rate: 0.8 },
      rows: [], delivery: null,
    })],
    [/^\/api\/press\/clients\/(c\d+)\/warm-config$/, () => ({})],
    [/^\/api\/press\/releases\/(p\d+)\/reply-status$/, () => ({})],
  ];
  if (req.method === 'GET') {
    for (const [re, make] of ONE) {
      const m = url.match(re);
      if (m) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(make(m)));
      }
    }
  }

  if (url === '/api/search') {
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase();
    const ROWS = [
      { type: 'client', opens: 'screen',     label: 'Clients',               id: 'c1', title: 'Oculi Mundi',               subtitle: null,        client_id: 'c1', leaf: 'dashboard', screen: 'measure' },
      { type: 'client', opens: 'screen',     label: 'Clients',               id: 'c2', title: 'Hillcroft Gardens',         subtitle: null,        client_id: 'c2', leaf: 'dashboard', screen: 'measure' },
      { type: 'contact', opens: 'record',    label: 'Journalists & contacts', id: 'j1', title: 'Amy Frearson',             subtitle: 'Dezeen',    client_id: 'c1', leaf: 'pr', screen: 'contacts' },
      { type: 'release', opens: 'record',    label: 'Press releases',        id: 'p1', title: 'Atlas launch coverage',     subtitle: 'draft',     client_id: 'c1', leaf: 'pr', screen: 'releases' },
      { type: 'release', opens: 'record',    label: 'Press releases',        id: 'p2', title: 'Hillcroft spring planting', subtitle: 'sent',      client_id: 'c2', leaf: 'pr', screen: 'releases' },
      { type: 'coverage', opens: 'record',   label: 'Coverage',              id: 'e1', title: 'Atlas in Wallpaper',        subtitle: 'published', client_id: 'c1', leaf: 'pr', screen: 'coverage' },
      { type: 'campaign', opens: 'record',   label: 'Campaigns',             id: 'k1', title: 'Atlas launch pitch',        subtitle: 'live',      client_id: 'c1', leaf: 'pr', screen: 'campaigns' },
      { type: 'recording', opens: 'reveal',  label: 'Recordings',            id: 'v1', title: 'Atlas walkthrough',         subtitle: 'ready',     client_id: 'c1', leaf: 'produce', screen: 'record' },
      { type: 'transcript', opens: 'record', label: 'Transcripts',           id: 't1', title: 'Atlas walkthrough notes',   subtitle: 'ready',     client_id: 'c1', leaf: 'produce', screen: 'transcribe' },
      { type: 'asset',      opens: 'reveal', label: 'Library',                id: 'as1', title: 'Atlas hero still',         subtitle: null,        client_id: 'c1', leaf: 'produce', screen: 'library' },
    ];
    const results = q.length < 2 ? [] : ROWS.filter(r => r.title.toLowerCase().includes(q));
    const send = () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    };
    return /slow=1/.test(req.url) ? setTimeout(send, 900) : send();
  }
  if (url.startsWith('/api/chat/')) fs.appendFileSync('/tmp/claude-0/-home-user-claude/678f754e-8874-5413-b278-fc834fcb4dab/scratchpad/stub/chat-requests.log', req.method + ' ' + req.url + '\n');
  if (url === '/api/reports/bulk' && req.method === 'DELETE') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      console.log('BULK DELETE BODY', JSON.stringify(b));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: b.expected_count, files_removed: b.expected_count }));
    });
  }
  if (req.method === 'DELETE' && url.startsWith('/api/strategist/briefings/')) {
    require('fs').appendFileSync(__dirname + '/briefing-deletes.log', url + '\n');
    API['/api/strategist/clients/c1/briefings'] = API['/api/strategist/clients/c1/briefings']
      .filter(b => b.id !== url.split('/').pop());
    res.writeHead(204); return res.end();
  }
  if ((req.method === 'PUT' || req.method === 'PATCH') && /^\/api\/social\/posts\/sp\d+$/.test(url)) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      fs.appendFileSync('/tmp/social-patches.log', url + ' ' + body + '\n');
      // The page swaps the row for whatever comes back, so a bare {ok:true}
      // would blank the post and the drive would be testing a wipe.
      const id = url.split('/').pop();
      const base = (API['/api/social/clients/c1/posts'] || []).find(p => p.id === id) || { id };
      let patch = {};
      try { patch = JSON.parse(body || '{}'); } catch { /* ignore */ }
      const merged = { ...base, ...patch };
      const i = (API['/api/social/clients/c1/posts'] || []).findIndex(p => p.id === id);
      if (i >= 0) API['/api/social/clients/c1/posts'][i] = merged;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(merged));
    });
    return;
  }
  if (req.method === 'PATCH' && url.startsWith('/api/strategist/briefing-actions/')) {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      require('fs').appendFileSync(__dirname + '/briefing-actions.log', url + ' ' + raw + '\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(raw || '{}');
    });
  }
  if (req.method === 'PUT' && url.startsWith('/api/clients/')) {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      require('fs').appendFileSync(__dirname + '/put-clients.log', raw + '\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(raw || '{}');
    });
  }
  if (req.method === 'POST' && /\/worked-examples$/.test(url)) {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        created: 2, existed: 1, failed: 1,
        results: [
          { pillar: 'paid', label: 'Paid', what: 'a batch of ad concepts', status: 'existed', id: 'ba1' },
          { pillar: 'shared', label: 'Shared', what: 'a batch of social posts', status: 'created', id: 'sb9' },
          { pillar: 'owned', label: 'Owned', what: 'a drafted article', status: 'created', id: 'cd9' },
          { pillar: 'earned', label: 'Earned', what: 'a drafted press release', status: 'failed', error: 'Claude is not configured.' },
        ],
      }));
    });
  }
  // Reset for the drives. The backfill flag is sticky by design, so a drive
  // that does not clear it at the start finds no card and fails for a reason
  // that has nothing to do with the code under test.
  if (req.method === 'POST' && /^\/api\/stub\/reset-backfill(\?|$)/.test(url)) {
    backfilled = false;
    // req.url, not url: the handler strips the query string off url, so the
    // mode would always read as the default.
    backfillMode = new URL(req.url, 'http://x').searchParams.get('mode') || 'all';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ reset: true, mode: backfillMode }));
  }
  if (req.method === 'POST' && /^\/api\/ad-creatives\/clients\/[^/]+\/images\/backfill$/.test(url)) {
    fs.appendFileSync(__dirname + '/backfill.log', url + '\n');
    // Only a run that kept everything leaves nothing behind.
    if (backfillMode === 'all') backfilled = true;
    const answer = {
      none: { examined: 1, stored: 0, expired: 1, skipped: 0, bytes: 0,
              failures: [{ id: 'im1', reason: 'provider returned 404' }], more: false },
      // Some kept, some gone, and more rows than one pass covers.
      partial: { examined: 200, stored: 7, expired: 3, skipped: 0, bytes: 1290240,
                 failures: [{ id: 'im4', reason: 'provider returned 404' }], more: true },
      all: { examined: 1, stored: 1, expired: 0, skipped: 0, bytes: 184320, failures: [], more: false },
    }[backfillMode] || { examined: 0, stored: 0, expired: 0, skipped: 0, bytes: 0, failures: [], more: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(answer));
  }
  if (req.method === 'PUT' && /^\/api\/ad-creatives\/creatives\/[^/]+$/.test(url)) {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      fs.appendFileSync(CREATIVE_EDITS, raw + '\n');
      const id = url.split('/').pop();
      const all = API['/api/ad-creatives/clients/c1/creatives'];
      const row = all.find(c => c.id === id) || { id };
      const merged = { ...row, ...JSON.parse(raw || '{}') };
      Object.assign(row, merged);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(merged));
    });
  }
  // The social report. A real PDF-shaped blob with the counts in headers, so
  // the page can say what the report covered without opening it.
  if (/^\/api\/social\/clients\/[^/]+\/report$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      LAST_REPORT = JSON.parse(raw || '{}');
      const connected = process.env.STUB_NO_IG !== '1';
      const pdf = Buffer.from('255044462d312e340a', 'hex'); // "%PDF-1.4\n"
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="social-hillcroft-gardens-2026-10-31.pdf"',
        'X-Report-Posts': connected ? '7' : '2',
        'X-Report-Via-Omi': '2',
        'X-Report-Connected': connected ? '1' : '0',
        'Access-Control-Expose-Headers': 'X-Report-Posts, X-Report-Via-Omi, X-Report-Connected',
      });
      res.end(pdf);
    });
  }
  if (url === '/__report') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(LAST_REPORT || null));
  }
  // The nine setup scans.
  if (/^\/api\/clients\/[^/]+\/setup-scans$/.test(url) && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(SCAN_CAT()));
  }
  if (/^\/api\/clients\/[^/]+\/setup-scans$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      LAST_SCAN_POST = body;
      const cat = SCAN_CAT();
      const results = (body.scans || []).map(key => {
        const s = cat.scans.find(x => x.key === key);
        if (!s) return null;
        if (s.present) return { key, label: s.label, status: 'existed' };
        if (s.wants_service_city && !(body.service || '').trim()) {
          return { key, label: s.label, status: 'skipped', reason: 'needs a service and a city' };
        }
        if (s.missing.includes('competitors') && !(body.scans || []).includes('competitors')) {
          return { key, label: s.label, status: 'skipped', reason: 'needs at least one competitor' };
        }
        if (key === 'ai_seo') return { key, label: s.label, status: 'failed', error: 'DataForSEO returned 402' };
        SCAN_RUN.add(key);
        return { key, label: s.label, status: 'created' };
      }).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        results,
        created: results.filter(r => r.status === 'created').length,
        existed: results.filter(r => r.status === 'existed').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'failed').length,
      }));
    });
  }
  if (url === '/__scans/reset') {
    SCAN_RUN = new Set(); LAST_SCAN_POST = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (url === '/__scans') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ run: [...SCAN_RUN], last: LAST_SCAN_POST }));
  }
  // The stored subreddits.
  if (/^\/api\/social\/clients\/[^/]+\/subreddits$/.test(url) && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ subreddits: SUBS }));
  }
  if (/^\/api\/social\/clients\/[^/]+\/subreddits\/suggest/.test(url) && req.method === 'POST') {
    SUBS_SUGGEST_CALLS += 1;
    const force = /force=1/.test(req.url);
    if (SUBS.length && !force) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ subreddits: SUBS, from: 'stored' }));
    }
    for (const row of [
      { id: 's1', name: 'GardeningUK', why: 'Where owners ask what a garden should cost.' },
      { id: 's2', name: 'LandscapeArchitecture', why: 'Practitioners, not students.' },
      { id: 's3', name: 'HomeImprovementUK', why: 'Buyers mid-project.' },
    ]) {
      if (!SUBS.some(x => x.name.toLowerCase() === row.name.toLowerCase())) {
        SUBS.push({ ...row, focus: null, time_window: 'month', source: 'suggest', researched_at: null });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ subreddits: SUBS, from: 'claude' }));
  }
  if (/^\/api\/social\/clients\/[^/]+\/subreddits$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const name = String(JSON.parse(raw || '{}').name || '').trim().replace(/^\/?r\//i, '').trim();
      if (name && !SUBS.some(x => x.name.toLowerCase() === name.toLowerCase())) {
        SUBS.push({ id: `s${SUBS.length + 9}`, name, why: null, focus: null, time_window: 'month', source: 'manual', researched_at: null });
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ subreddit: SUBS[SUBS.length - 1] }));
    });
  }
  if (/^\/api\/social\/clients\/[^/]+\/subreddits\/[^/]+$/.test(url) && req.method === 'PATCH') {
    const id = url.split('/').pop();
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const patch = JSON.parse(raw || '{}');
      const row = SUBS.find(x => x.id === id);
      if (row) Object.assign(row, patch);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ subreddit: row || null }));
    });
  }
  if (/^\/api\/social\/clients\/[^/]+\/subreddits\/[^/]+$/.test(url) && req.method === 'DELETE') {
    const id = url.split('/').pop();
    SUBS = SUBS.filter(x => x.id !== id);
    res.writeHead(204); return res.end();
  }
  // Back to empty, so a drive starts from the state the screen's first
  // action exists for however many times it is run.
  if (url === '/__subs/reset') {
    SUBS = []; SUBS_SUGGEST_CALLS = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  // What the page asked the subreddit list for, so a drive can read it back.
  if (url === '/__subs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ subs: SUBS, suggestCalls: SUBS_SUGGEST_CALLS }));
  }
  // Shared's batch export. Records the query so a drive can check which
  // posts the page asked for, and counts them back in the headers.
  if (/^\/api\/social\/clients\/[^/]+\/batches\/[^/]+\/export/.test(url)) {
    const asked = (/[?&]posts=([^&]*)/.exec(req.url) || [])[1];
    const ids = asked ? decodeURIComponent(asked).split(',').filter(Boolean)
                      : (API['/api/social/clients/c1/posts'] || []).map(p => p.id);
    LAST_SOCIAL_EXPORT = { query: req.url, ids };
    const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="social-2026-10-31.zip"',
      'X-Export-Posts': String(ids.length),
      'X-Export-Assets': String(ids.length),
      'X-Export-Missing': '0',
      'Access-Control-Expose-Headers': 'X-Export-Posts, X-Export-Assets, X-Export-Missing',
    });
    return res.end(zip);
  }
  // What the last batch download asked for, so a drive can read it back.
  if (url === '/__last-social-export') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(LAST_SOCIAL_EXPORT || null));
  }
  // The Launch export. Serves a real zip with the counts in headers, and
  // ?short=1 reproduces a batch whose provider links have expired.
  if (/^\/api\/ad-creatives\/batches\/[^/]+\/export$/.test(url)) {
    const short = /short=1/.test(req.url);
    const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex'); // empty zip
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="ads-meta-2026-10-20.zip"',
      'X-Export-Assets': short ? '1' : '3',
      'X-Export-Missing': short ? '2' : '0',
    });
    return res.end(zip);
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+\/competitors$/.test(url) && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ competitors: COMPETITORS }));
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+\/competitors$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const row = { id: NEXT_COMPETITOR_ID++, name: b.name || b.domain, domain: b.domain || null,
        reason: null, region: 'GB', source: 'manual', last_ad_count: null, last_pulled_at: null, last_run_id: null };
      COMPETITORS.push(row);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(row));
    });
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+\/competitors\/\d+$/.test(url) && req.method === 'PATCH') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const id = Number(url.split('/').pop());
      const row = COMPETITORS.find(c => c.id === id);
      if (row) Object.assign(row, JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(row || {}));
    });
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+\/competitors\/\d+$/.test(url) && req.method === 'DELETE') {
    const id = Number(url.split('/').pop());
    COMPETITORS = COMPETITORS.filter(c => c.id !== id);
    res.writeHead(204); return res.end();
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+\/suggestions$/.test(url)) {
    const force = /force=1/.test(req.url);
    if (force || !COMPETITORS.length) {
      COMPETITOR_SUGGEST_CALLS++;
      if (!COMPETITORS.some(c => c.domain === 'third.co')) {
        COMPETITORS.push({ id: NEXT_COMPETITOR_ID++, name: 'Third Co', domain: 'third.co',
          reason: 'Newly suggested.', region: 'GB', source: 'suggest',
          last_ad_count: null, last_pulled_at: null, last_run_id: null });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ competitors: COMPETITORS, from: (force || COMPETITOR_SUGGEST_CALLS === 1) ? 'claude' : 'stored',
      __calls: COMPETITOR_SUGGEST_CALLS }));
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const run = { ...COMPETITOR_RUNS[0], id: 12, query: b.query, region: b.region };
      const row = COMPETITORS.find(c => (c.domain || c.name) === b.query);
      if (row) { row.last_run_id = 12; row.last_ad_count = 2; row.last_pulled_at = new Date().toISOString(); }
      COMPETITOR_RUNS.push(run);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ run }));
    });
  }
  if (/^\/api\/competitor-ads\/clients\/[^/]+$/.test(url) && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ configured: true, runs: COMPETITOR_RUNS }));
  }
  // Minting a client approval link.
  if (/^\/api\/approvals\/clients\/[^/]+\/links$/.test(url) && req.method === 'POST') {
    let raw = ''; req.on('data', c => raw += c);
    return req.on('end', () => {
      fs.appendFileSync(__dirname + '/approval-links.log', raw + '\n');
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ public_url: 'http://127.0.0.1:4599/approve/tok123', link: { id: 1 } }));
    });
  }
  // The public page the client opens. One concept with three sizes, copy long
  // enough to be clipped on two of the three surfaces.
  if (url === '/stub-ad.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(fs.readFileSync(__dirname + '/ad.png'));
  }
  // A social batch sent for approval. The caption is long enough to clip on
  // every surface, which is the thing the preview exists to show.
  if (url === '/api/approvals/public/tok-social') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      title: 'Social batch — Hillcroft Gardens', client: { name: 'Hillcroft Gardens' },
      expires_at: '2026-11-14T00:00:00Z', responses: [], creatives: [],
      posts: [
        { id: 'sp1', platform: 'instagram', kind: 'post',
          hook: 'Start with one bed, not the whole garden',
          caption: 'Every client who has ever regretted a garden did the whole thing at once. One bed teaches you the light, the drainage and what the dog walks through, and it costs a tenth of finding out the hard way across four hundred square metres.',
          hashtags: ['gardendesign', 'plantingdesign'],
          image_urls: ['/stub-ad.png'], media: [] },
        { id: 'sp2', platform: 'tiktok', kind: 'reel',
          hook: 'Autumn is the planting season',
          caption: 'Nobody believes this until the second spring, when the autumn-planted beds are a month ahead of everything put in during May.',
          hashtags: [], image_urls: [], media: [{ id: 'm1', kind: 'video', url: '/stub-ad.png' }] },
      ],
    }));
  }
  if (url === '/api/approvals/public/tok123') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      title: 'Ad creative — Oculi Mundi', client: { name: 'Oculi Mundi' },
      expires_at: '2026-11-14T00:00:00Z', responses: [], posts: [],
      creatives: [{
        id: 'cr1', framework: 'PAS', angle: 'Longevity',
        headline: 'Enamel bowls built to outlive the kitchen they sit in',
        body: 'Vitreous enamel over heavy-gauge steel, the way it was made before anyone thought to make it cheaper. The ones in our own studio kitchen date from 2009 and have been through a dishwasher most weeks since.',
        cta: 'Shop the range',
        images: [
          { id: 'i1', url: '/stub-ad.png', aspect_ratio: '1:1', media_type: 'image' },
          { id: 'i2', url: '/stub-ad.png', aspect_ratio: '4:5', media_type: 'image' },
          { id: 'i3', url: '/stub-ad.png', aspect_ratio: '9:16', media_type: 'image' },
        ],
      }],
    }));
  }
  // ── Database → Publications ───────────────────────────────────────────────
  // 620 publications, so "delete all matching" exceeds the 500 the list draws
  // — the exact case where the old button deleted 120 nobody had seen.
  if (!global.__PUBS) {
    const regions = ['UK', 'US', 'DE', 'FR', 'IT'];
    const tiers = ['1', '2', '3', ''];
    global.__PUBS = Array.from({ length: 620 }, (_, i) => ({
      id: `o${i + 1}`,
      name: i === 0 ? 'Dezeen' : i === 1 ? 'Wallpaper' : `Publication ${i + 1}`,
      domain: i === 0 ? 'dezeen.com' : `pub${i + 1}.example`,
      tier: tiers[i % 4],
      coverage: (i * 7) % 40,
      contacts: (i * 3) % 9,
      region: regions[i % 5],
      rss_status: i % 3 === 0 ? 'found' : i % 3 === 1 ? 'none' : null,
      rss_url: i % 3 === 0 ? `https://pub${i + 1}.example/feed` : null,
    }));
  }
  if (/^\/api\/pr\/outlets(\?|$)/.test(url) && req.method === 'GET') {
    const q = (req.url.match(/[?&]q=([^&]*)/) || [])[1];
    const term = q ? decodeURIComponent(q).toLowerCase() : '';
    const items = term
      ? global.__PUBS.filter((o) => o.name.toLowerCase().includes(term) || (o.domain || '').toLowerCase().includes(term))
      : global.__PUBS;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ items }));
  }
  if (url === '/api/pr/outlets/bulk-delete' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let ids = [];
      try { ids = (JSON.parse(body || '{}').ids) || []; } catch { /* ignore */ }
      const gone = new Set(ids);
      global.__PUBS = global.__PUBS.filter((o) => !gone.has(o.id));
      global.__LAST_BULK = ids.length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: ids.length }));
    });
  }
  if (url === '/__pubs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ count: global.__PUBS.length, lastBulk: global.__LAST_BULK || 0 }));
  }
  if (url === '/__pubs/reset') {
    global.__PUBS = null; global.__LAST_BULK = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }
  const outletOne = url.match(/^\/api\/pr\/outlets\/(o\d+)$/);
  if (outletOne && req.method === 'GET') {
    const o = (global.__PUBS || []).find((x) => x.id === outletOne[1]) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ...o, summary: 'A design title.', notes: '', journalists: [], coverage: [] }));
  }

  // ── Biz dev → Leads ───────────────────────────────────────────────────────
  if (!global.__LEADS) {
    global.__LEADS = [
      { id: 'l1', company_name: 'Northgate Studio', url: 'https://northgate.example', email: 'hello@northgate.example', referral_source: 'Referral', source: 'manual', status: 'drafted', created_at: '2026-10-20T09:00:00Z' },
      { id: 'l2', company_name: 'Falcon Workshop', url: 'https://falcon.example', email: null, referral_source: null, source: 'public', status: 'sent', created_at: '2026-10-22T09:00:00Z' },
      { id: 'l3', company_name: 'Morrow Comms', url: 'https://morrowcomms.com', email: null, referral_source: null, source: 'manual', status: 'archived', created_at: '2026-09-02T09:00:00Z' },
      { id: 'l4', company_name: 'Hillcroft Gardens', url: 'https://hillcroft.example', email: 'd@hillcroft.example', referral_source: 'Instagram', source: 'public', status: 'booked', created_at: '2026-10-28T09:00:00Z' },
    ];
  }
  if (url === '/api/leads' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(global.__LEADS));
  }
  const leadOne = url.match(/^\/api\/leads\/(l\d+)$/);
  if (leadOne && req.method === 'PATCH') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let patch = {};
      try { patch = JSON.parse(body || '{}'); } catch { /* ignore */ }
      const l = global.__LEADS.find((x) => x.id === leadOne[1]);
      if (l && patch.status) l.status = patch.status;
      global.__LAST_PATCH = { id: leadOne[1], ...patch };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(l || {}));
    });
  }
  if (leadOne && req.method === 'DELETE') {
    global.__LEADS = global.__LEADS.filter((x) => x.id !== leadOne[1]);
    global.__LAST_LEAD_DELETE = leadOne[1];
    res.writeHead(204);
    return res.end();
  }
  if (url === '/__leads') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      leads: (global.__LEADS || []).map((l) => ({ id: l.id, status: l.status })),
      lastPatch: global.__LAST_PATCH || null,
      lastDelete: global.__LAST_LEAD_DELETE || null,
    }));
  }
  if (url === '/__leads/reset') {
    global.__LEADS = null; global.__LAST_PATCH = null; global.__LAST_LEAD_DELETE = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // ── Database → Journalists (the contact library) ──────────────────────────
  // Sorting is the thing under test, so the fixture sorts the way the server
  // does: the chosen expression, NULLS LAST in both directions, created_at as
  // the tie-break. 420 rows so the 200-row page is a page.
  if (!global.__LIB) {
    const outlets = ['Dezeen', 'Wallpaper', 'Architects Journal', null];
    const countries = ['UK', 'US', 'DE', null];
    const first = ['Amy', 'Ben', 'Cara', 'Dan', 'Eve', 'Finn', 'Gale', 'Huw'];
    const last = ['Zephyr', 'Young', 'Xu', 'Walsh', 'Vaughan', 'Usher', 'Tate', 'Sands'];
    global.__LIB = Array.from({ length: 420 }, (_, i) => ({
      id: `k${i + 1}`,
      name: `${first[i % 8]} ${last[(i * 3) % 8]}${i > 63 ? ' ' + i : ''}`,
      email: i % 7 === 0 ? null : `c${i + 1}@example.com`,
      company: null,
      outlet_name: outlets[i % 4],
      country: countries[i % 4],
      beats: i % 3 === 0 ? ['architecture'] : ['interiors'],
      tags: [],
      client_ids: [],
      total_sent: (i * 13) % 50,
      total_opened: (i * 7) % 40,
      total_clicked: (i * 3) % 20,
      total_replied: (i * 5) % 11,
      created_at: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString(),
    }));
  }
  if (/^\/api\/outreach\/contacts\/library(\?|$)/.test(url)) {
    const qs = new URL(req.url, 'http://x').searchParams;
    const term = (qs.get('search') || '').toLowerCase();
    let rows = global.__LIB.filter((r) => !term
      || (r.name || '').toLowerCase().includes(term)
      || (r.email || '').toLowerCase().includes(term)
      || (r.outlet_name || '').toLowerCase().includes(term));
    const SORTS = {
      name: (r) => (r.name || '').toLowerCase(),
      email: (r) => (r.email == null ? null : r.email.toLowerCase()),
      outlet: (r) => (r.outlet_name == null ? null : r.outlet_name.toLowerCase()),
      country: (r) => (r.country == null ? null : r.country.toLowerCase()),
      beat: (r) => (r.beats || []).join(',').toLowerCase(),
      created_at: (r) => r.created_at,
      total_sent: (r) => r.total_sent,
      total_replied: (r) => r.total_replied,
    };
    const key = SORTS[qs.get('sort')] ? qs.get('sort') : 'created_at';
    const asc = (qs.get('dir') || '').toLowerCase() === 'asc' && SORTS[qs.get('sort')];
    const get = SORTS[key];
    rows = [...rows].sort((a, b) => {
      const x = get(a); const y = get(b);
      // NULLS LAST, whichever way the column is sorted.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (x < y) return asc ? -1 : 1;
      if (x > y) return asc ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    const total = rows.length;
    const limit = Math.min(1000, Number(qs.get('limit')) || 200);
    const offset = Number(qs.get('offset')) || 0;
    const page = rows.slice(offset, offset + limit);
    global.__LAST_LIB_QUERY = { sort: qs.get('sort'), dir: qs.get('dir'), search: qs.get('search') || '' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(qs.get('include_count') ? { rows: page, total } : page));
  }
  if (url === '/api/outreach/contacts/library/delete-by-filter' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { /* ignore */ }
      const term = (b.search || '').toLowerCase();
      const keep = global.__LIB.filter((r) => term
        && !((r.name || '').toLowerCase().includes(term)
          || (r.email || '').toLowerCase().includes(term)
          || (r.outlet_name || '').toLowerCase().includes(term)));
      const deleted = global.__LIB.length - keep.length;
      global.__LIB = term ? keep : [];
      global.__LAST_FILTER_DELETE = { expected_count: b.expected_count, deleted: term ? deleted : 420 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: global.__LAST_FILTER_DELETE.deleted }));
    });
  }
  // Prompt caching: one feature in each of the three states, so the drive
  // can check that "wasting" is told apart from "working".
  if (/^\/api\/settings\/usage\/cache(\?|$)/.test(url)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      window_days: 30,
      totals: { calls: 1840, read_tokens: 41_200_000, write_tokens: 3_100_000, plain_tokens: 22_400_000,
        saved_usd: 88.4102, spent_usd: 412.88, hit_rate: 61.8 },
      features: [
        { feature: 'report_narrative', calls: 620, models: ['claude-opus-5'], read_tokens: 38_000_000,
          write_tokens: 900_000, plain_tokens: 2_100_000, hit_rate: 92.7, saved_usd: 102.4, spent_usd: 180.2, state: 'working' },
        { feature: 'ad_creative', calls: 410, models: ['claude-opus-5'], read_tokens: 0,
          write_tokens: 2_100_000, plain_tokens: 1_200_000, hit_rate: 0, saved_usd: -7.88, spent_usd: 96.1, state: 'wasting' },
        { feature: 'ai_visibility_scan', calls: 700, models: ['claude-opus-5'], read_tokens: 0,
          write_tokens: 0, plain_tokens: 18_900_000, hit_rate: 0, saved_usd: 0, spent_usd: 130.4, state: 'uncached' },
        { feature: 'contact_tidy', calls: 2, models: [], read_tokens: 1000, write_tokens: 0,
          plain_tokens: 2000, hit_rate: 33.3, saved_usd: 0.002, spent_usd: 0.18, state: 'quiet' },
      ],
    }));
  }
  if (url === '/api/outreach/tags') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('[]');
  }
  if (url === '/__lib') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ lastQuery: global.__LAST_LIB_QUERY || null, count: (global.__LIB || []).length }));
  }

  if (url.startsWith('/api/')) {
    // The strategist thread starts empty, which is when the suggested
    // questions render. Without this the drive found zero chips and its wrap
    // assertions passed on an empty selector.
    if (url === '/api/chat/c1' && /thread=strategist/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
    if (process.env.STUB_EMPTY_QUEUE === '1' && url === '/api/strategist/briefings/b1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...API[url], recommendations: [], synthesis: '### What changed\n\nFirst briefing. All figures are opening baselines.' }));
    }
    const body = API[url];
    if (body === undefined) { res.writeHead(404, {'Content-Type':'application/json'}); return res.end('{"error":"stub: no route"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  }
  let f = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  const ext = path.extname(f);
  const type = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.gif':'image/gif', '.png':'image/png', '.svg':'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(f));
}).listen(4599, () => console.log('stub on 4599'));
