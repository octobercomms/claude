// Single source of truth for which DataForSEO APIs the workspace can
// currently call. Two APIs (Backlinks + LLM Mentions) require a $100/mo
// commitment that we do not hold; on 1 July 2026 DataForSEO removes
// that commitment and both move to pay-as-you-go. Until then the
// scheduler, the routes, and the UI all gate on this.
//
// The cutover date is fixed and lives here so it can be patched in one
// place if DataForSEO push it back. The constant is exposed to the
// frontend via /auth/me so the SEO tab can render a "becomes available"
// banner without having to know the date itself.

const ENABLED_FROM = new Date('2026-07-01T00:00:00Z');

// APIs that flip from "subscription only" to "pay-as-you-go" on the
// cutover. Every endpoint family under these prefixes is gated.
const GATED_PREFIXES = ['/backlinks/', '/llm_mentions/'];

function isUnlocked(now = new Date()) {
  return now >= ENABLED_FROM;
}

function isEndpointGated(path) {
  return GATED_PREFIXES.some(p => path.startsWith(p));
}

// Helper the connector + routes call before hitting DataForSEO. Throws
// a descriptive error rather than letting DFS return a billing error
// with no context.
function assertUnlocked(endpoint) {
  if (!isEndpointGated(endpoint)) return;
  if (isUnlocked()) return;
  const err = new Error(
    `${endpoint} is part of the DataForSEO Backlinks / LLM Mentions APIs, which are not available on our plan until 1 July 2026.`
  );
  err.status = 503;
  err.code = 'dfs_gated';
  throw err;
}

// What the /auth/me payload carries to the frontend so banners can be
// shown without leaking server config.
function availabilityForClient(now = new Date()) {
  const unlocked = isUnlocked(now);
  return {
    enabled_from: ENABLED_FROM.toISOString(),
    unlocked,
    gated_apis: ['backlinks', 'llm_mentions'],
    gated_features: [
      'Full backlink list + referring domains',
      'New / lost backlinks since last cycle',
      'Anchor text distribution',
      'Backlinks ↔ press-release ROI attribution',
      'AI assistant brand mentions (ChatGPT, Claude, Perplexity, Gemini)',
    ],
    // After the cutover the banner flips to "now available" with a link
    // to the checklist doc. The doc is the persistent reference — once
    // we ship Phase E PRs the banner can be dismissed permanently.
    doc_path: 'docs/dataforseo-july-2026.md',
    post_unlock_message: unlocked
      ? 'DataForSEO Backlinks and LLM Mentions are now available on pay-as-you-go. Open docs/dataforseo-july-2026.md for the implementation checklist + the Phase E PR plan.'
      : null,
  };
}

module.exports = {
  ENABLED_FROM,
  GATED_PREFIXES,
  isUnlocked,
  isEndpointGated,
  assertUnlocked,
  availabilityForClient,
};
