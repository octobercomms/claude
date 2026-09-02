// Per-feature AI model routing. Every text/JSON feature flows through
// claude.js → callClaude({ feature }); this decides which model runs it, from a
// map the AM sets in Settings → AI models. Each feature can run on any Claude
// model or DeepSeek. (The AI Data Analyst has its own per-question picker — it's
// tool-use and lives in routes/chat.js, not here.)

const { getSetting } = require('../utils/settings');

// id → provider, label, relative cost tier, and a one-line note for the tooltip.
const MODELS = {
  'claude-haiku-4-5':  { provider: 'anthropic', label: 'Claude Haiku',  tier: '$',    note: 'Fastest, cheapest Claude — good for simple/bulk tasks.' },
  'claude-sonnet-4-6': { provider: 'anthropic', label: 'Claude Sonnet', tier: '$$',   note: 'Balanced default — strong quality at mid cost.' },
  'claude-opus-4-8':   { provider: 'anthropic', label: 'Claude Opus',   tier: '$$$',  note: 'Very capable, high cost — save for hard tasks.' },
  'claude-fable-5':    { provider: 'anthropic', label: 'Claude Fable',  tier: '$$$$', note: 'Most capable Claude, premium cost (above Opus) — reserve for the hardest work.' },
  'deepseek-chat':     { provider: 'deepseek',  label: 'DeepSeek',      tier: '¢',    note: 'Cheapest by far. Data is sent to DeepSeek — avoid for client data.' },
};
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Per-feature default model, used when the AM hasn't set an explicit override in
// Settings → AI models. Lets specific features opt into a smarter default than
// the global Sonnet — press personalisation and media-database reasoning want
// Opus for genuinely intelligent writing/thinking. The AM can still override.
const FEATURE_DEFAULTS = {
  press_pitch: 'claude-opus-4-8',
  press_followups: 'claude-opus-4-8',
  press_import_sort: 'claude-opus-4-8',
  press_audience: 'claude-opus-4-8',
  media_db_hygiene: 'claude-opus-4-8',
  media_db_research: 'claude-opus-4-8',
  // Bulk byline classification is simple, high-volume work — cheapest Claude by
  // default; the AM can drop it to DeepSeek in Settings for near-zero cost.
  press_byline_mining: 'claude-haiku-4-5',
};

// Routable features, grouped for the UI. `sensitive: true` = this feature sends
// real client/customer data (metrics, contacts, message content) to the model,
// so DeepSeek carries a warning for it.
const FEATURES = [
  { group: 'Reports & strategy', items: [
    { key: 'report_narrative', label: 'Report narratives', sensitive: true },
    { key: 'executive_summary', label: 'Executive summaries', sensitive: true },
    { key: 'strategist_report', label: 'Strategist briefings', sensitive: true },
    { key: 'client_strategy_tailor', label: 'Strategy tailoring', sensitive: true },
    { key: 'monthly_focus_suggestion', label: 'Monthly focus suggestions', sensitive: false },
    { key: 'briefing_research', label: 'Client briefing research', sensitive: true },
  ] },
  { group: 'Social', items: [
    { key: 'social_captions', label: 'Social captions', sensitive: false },
    { key: 'social_planner', label: 'Social planner', sensitive: false },
    { key: 'social_audit', label: 'Social audit', sensitive: false },
    { key: 'ad_creative', label: 'Ad creative', sensitive: false },
    { key: 'dm_bot_draft', label: 'DM bot — live drafts', sensitive: true },
    { key: 'dm_bot_templates', label: 'DM bot — templates', sensitive: false },
    { key: 'ig_outreach_draft', label: 'IG outreach drafts', sensitive: false },
    { key: 'swipe_idea_card', label: 'Swipe-file idea cards', sensitive: false },
  ] },
  { group: 'SEO & visibility', items: [
    { key: 'ai_seo_keywords', label: 'AI SEO keywords', sensitive: false },
    { key: 'ai_seo_article_scan', label: 'AI SEO article scan', sensitive: false },
    { key: 'ai_visibility_query', label: 'AI visibility — query', sensitive: false },
    { key: 'ai_visibility_sentiment', label: 'AI visibility — sentiment', sensitive: false },
    { key: 'clarity_cro', label: 'Clarity CRO analysis', sensitive: false },
    { key: 'local_seo_ranking_playbook', label: 'Local SEO playbook', sensitive: false },
    { key: 'local_seo_competitor_xray', label: 'Local SEO competitor x-ray', sensitive: false },
  ] },
  { group: 'Tender agent', items: [
    { key: 'tender_score', label: 'Go/no-go qualifier', sensitive: false },
  ] },
  { group: 'Selective outreach', items: [
    // Research + scoring see only PUBLIC company data — safe on DeepSeek.
    { key: 'outreach_research', label: 'Prospect research (web search)', sensitive: false },
    { key: 'outreach_score', label: 'Prospect fit-gate', sensitive: false },
    // Drafting sees the sender's identity + the conversation — keep on Claude.
    { key: 'outreach_draft', label: 'Outbound message drafting', sensitive: true },
    { key: 'outreach_reply', label: 'Reply drafting', sensitive: true },
  ] },
  { group: 'Press outreach', items: [
    // Personalised journalist pitches + follow-ups, and the media-database
    // brains. Default to Opus (see FEATURE_DEFAULTS) for genuinely intelligent
    // writing/thinking; the AM can still route them down for cost.
    { key: 'press_pitch', label: 'Journalist pitch writing', sensitive: true },
    { key: 'press_followups', label: 'Follow-up writing', sensitive: true },
    { key: 'press_import_sort', label: 'Paste-and-sort contact import', sensitive: true },
    { key: 'press_audience', label: 'Autopilot audience selection', sensitive: false },
    { key: 'media_db_hygiene', label: 'Media DB dedupe/merge', sensitive: true },
    { key: 'media_db_research', label: 'Media DB research (bylines/RSS)', sensitive: false },
    // Bulk classification of raw RSS bylines into real new-journalist names.
    // Public byline names + article titles only — no client data — so it's
    // cheap and safe on DeepSeek. Defaults to Haiku (see FEATURE_DEFAULTS).
    { key: 'press_byline_mining', label: 'RSS byline mining (new journalists)', sensitive: false },
  ] },
  { group: 'Outreach & leads', items: [
    { key: 'outreach_write_sequence', label: 'Outreach sequences', sensitive: false },
    { key: 'outreach_refine_audience', label: 'Outreach audience refine', sensitive: false },
    { key: 'outreach_classify_reply', label: 'Outreach reply classify', sensitive: true },
    { key: 'lead_scoring', label: 'Lead scoring', sensitive: true },
    { key: 'lead_scrape', label: 'Lead scrape extract', sensitive: true },
    { key: 'contact_tidy', label: 'Contact tidy', sensitive: true },
    { key: 'gmail_addon_extract', label: 'PR Gmail add-on extract', sensitive: true },
    { key: 'pr_coverage_extract', label: 'PR coverage-link extract', sensitive: false },
    { key: 'competitor_ads', label: 'Competitor ads analysis', sensitive: false },
  ] },
];
const FEATURE_KEYS = new Set(FEATURES.flatMap(g => g.items.map(i => i.key)));

let _cache = { at: 0, map: {} };
async function getMap() {
  if (Date.now() - _cache.at < 20000) return _cache.map;
  let map = {};
  try { map = JSON.parse((await getSetting('AI_MODEL_MAP')) || '{}') || {}; } catch { map = {}; }
  _cache = { at: Date.now(), map };
  return map;
}
function clearCache() { _cache = { at: 0, map: {} }; }

// Resolve the model id for a feature. Defaults to Sonnet unless the AM set
// something valid.
async function resolveModel(feature) {
  const map = await getMap();
  const id = map[feature];
  if (MODELS[id]) return id;                                   // AM override wins
  if (MODELS[FEATURE_DEFAULTS[feature]]) return FEATURE_DEFAULTS[feature]; // per-feature default
  return DEFAULT_MODEL;                                        // global default
}

module.exports = { MODELS, DEFAULT_MODEL, FEATURE_DEFAULTS, FEATURES, FEATURE_KEYS, getMap, clearCache, resolveModel };
