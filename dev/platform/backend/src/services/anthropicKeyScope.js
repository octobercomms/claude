// Which Anthropic API keys count as OMI's.
//
// The Costs panel used to report the whole organisation's Claude spend. On
// this account that is wrong by a factor of four: a separate mail app runs on
// its own key and accounted for $55 of an $89 month, so the figure OMI
// presented as "what the platform costs to run" was mostly something else.
//
// Daniel, asked what he wanted: "i dont want OMI to factor in all claude api
// costs - only OMI api costs."
//
// The usage report takes an api_key_ids[] filter, so scoping is a matter of
// knowing which key ids are OMI's. OMI holds the key *secret*
// (CLAUDE_API_KEY); the report wants the key *id* (apikey_…), and there is no
// endpoint that turns one into the other. What there is: the admin key can
// list the organisation's keys, and each carries a partial_key_hint of the
// form "sk-ant-api03-R2D...igAA". A secret and a hint can be matched on their
// two visible ends, which is exact enough to be safe — the hint shows twelve
// or more leading characters and four trailing ones, so a false match would
// need two keys agreeing on both ends.
//
// When nothing matches, the caller reports no figure and says why. An
// org-wide total is not a fallback: it is the number this change exists to
// stop showing.

const axios = require('axios');

const ADMIN_API = 'https://api.anthropic.com/v1/organizations';
// 1000 is the documented maximum. Paginated anyway, because a key list that
// silently stops at one page is how OMI would decide its own key is missing
// and report nothing at all.
const PER_PAGE = 1000;
const MAX_PAGES = 10;

function headers(adminKey) {
  return { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' };
}

// Does this secret belong to the key this hint describes?
//
// The hint is the secret with its middle removed: "sk-ant-api03-R2D...igAA".
// Both ends must match, and both must be long enough to mean something — a
// hint of "..." or "sk...a" is matched by half the keys on the account, so it
// is treated as no information rather than a match.
function matchesHint(secret, hint) {
  const s = String(secret || '').trim();
  const h = String(hint || '').trim();
  if (!s || !h) return false;
  const i = h.indexOf('...');
  if (i === -1) {
    // No ellipsis: some keys are listed with the hint in full. Then it is
    // either the secret or it is not.
    return h.length >= 12 && h === s;
  }
  const head = h.slice(0, i);
  const tail = h.slice(i + 3);
  if (head.length < 8 || tail.length < 3) return false;
  if (s.length <= head.length + tail.length) return false;
  return s.startsWith(head) && s.endsWith(tail);
}

async function listKeys(adminKey) {
  const out = [];
  let afterId = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { limit: PER_PAGE };
    if (afterId) params.after_id = afterId;
    const { data } = await axios.get(`${ADMIN_API}/api_keys`, { params, headers: headers(adminKey) });
    const rows = data?.data || [];
    out.push(...rows);
    if (!data?.has_more || !rows.length) break;
    const next = data.last_id || rows[rows.length - 1]?.id;
    // A cursor that does not advance would loop forever. Stop instead.
    if (!next || next === afterId) break;
    afterId = next;
  }
  return out;
}

// A manual override from Settings, for the case where matching cannot work:
// the key was rotated in the Anthropic console but not in OMI, or the admin
// key is not allowed to list keys. Accepts ids separated by commas,
// whitespace or newlines, and keeps only things shaped like a key id.
function parseOverride(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(s => /^apikey_[A-Za-z0-9]+$/.test(s));
}

// The api_key_ids to scope the usage report to.
//
// Returns { ids, source, detail }. `ids` empty means "do not report a
// figure"; `detail` is what the card tells the reader to do about it.
async function resolveOmiKeyIds({ adminKey, apiKey, override }) {
  const manual = parseOverride(override);
  if (manual.length) {
    return { ids: manual, source: 'override', detail: `Scoped to ${manual.length} API key id(s) set in Settings.` };
  }

  const secret = String(apiKey || '').trim();
  if (!secret) {
    return {
      ids: [], source: 'no_key',
      detail: 'No Claude API key saved, so there is nothing to attribute spend to. Add one under Settings → AI models.',
    };
  }

  let keys;
  try {
    keys = await listKeys(adminKey);
  } catch (err) {
    const status = err.response?.status;
    return {
      ids: [], source: 'list_failed',
      detail: status === 401 || status === 403
        ? 'The Anthropic Admin key cannot list this organisation\'s API keys, so OMI\'s own key could not be identified. Either use an admin key with that permission, or paste OMI\'s API key id into Settings → AI models.'
        : `Could not read the organisation's API keys (${err.message}). Spend is left blank rather than reporting the whole account.`,
    };
  }

  const matched = keys.filter(k => matchesHint(secret, k.partial_key_hint));
  if (!matched.length) {
    return {
      ids: [], source: 'unmatched',
      detail: `None of the ${keys.length} API key(s) on this organisation matches the Claude key OMI is using, so its spend cannot be separated from the rest of the account. This is what happens when the key was replaced in the Anthropic console: paste OMI's API key id into Settings → AI models, or re-save the current key.`,
    };
  }

  return {
    ids: matched.map(k => k.id),
    source: 'matched',
    detail: matched.length === 1
      ? `Scoped to OMI's own API key (${matched[0].name || matched[0].id}).`
      : `Scoped to ${matched.length} API keys carrying this secret.`,
    keys: matched.map(k => ({ id: k.id, name: k.name, status: k.status })),
  };
}

module.exports = { resolveOmiKeyIds, matchesHint, parseOverride, listKeys };
