const Anthropic = require('@anthropic-ai/sdk');
const { getSetting } = require('../utils/settings');
const pool = require('../db');

const MODEL = 'claude-sonnet-4-6';

// Analyse the workspace's tag catalogue and propose cleanups. Sends Claude
// the tags (with counts) plus a slim client context so it can reason about
// what counts as a meaningful parent category — e.g. for a fashion-PR
// workspace "fashion" is a real parent for "teen-fashion", but for an
// energy-PR workspace "fashion" probably shouldn't be created at all.
//
// Returns an array of operation objects the caller can choose to apply:
//   - { type: 'rename', from, to, why }
//   - { type: 'merge',  from: [...], into, why }
//   - { type: 'delete', tag, why }
//   - { type: 'add_parent', child, parent, why }
async function analyseTags(visibleClientIds) {
  const apiKey = await getSetting('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('Claude API key not configured — add it in Settings.');

  const tags = await loadTags(visibleClientIds);
  if (!tags.length) return { operations: [], tagCount: 0 };
  const clients = await loadClientContext(visibleClientIds);

  const client = new Anthropic({ apiKey: apiKey.trim() });
  const system = 'You are a CRM data-quality consultant cleaning up tags used to '
    + 'segment PR and journalist contacts. You are conservative: only propose '
    + 'changes you are confident about. You understand that "mens-fashion" and '
    + '"womens-fashion" are distinct and must not be merged, but "teen-fashion" '
    + 'and "teenfashion" obviously refer to the same thing.';

  const clientList = clients.length
    ? clients.map(c => `- ${c.name}${c.briefing ? `: ${c.briefing}` : ''}`).join('\n')
    : '(no client context available)';
  const tagList = tags.map(t => `- ${t.tag} · ${t.count}`).join('\n');

  const prompt = [
    `The workspace serves these clients:`,
    clientList,
    ``,
    `Current tag catalogue (tag · contact count):`,
    tagList,
    ``,
    `Propose cleanup operations. Output strictly valid JSON: {"operations":[...]}`,
    ``,
    `Operation types:`,
    `1. {"type":"rename","from":"X","to":"Y","why":"..."}`,
    `   For typos, capitalisation, whitespace, or obvious mis-spellings of a single tag.`,
    `2. {"type":"merge","from":["A","B","C"],"into":"D","why":"..."}`,
    `   Collapse near-duplicate variations into one canonical name.`,
    `3. {"type":"delete","tag":"X","why":"..."}`,
    `   Strip junky tags — single-use test values, gibberish, accidental imports.`,
    `   Don't delete rare-but-real categories.`,
    `4. {"type":"add_parent","child":"X","parent":"Y","why":"..."}`,
    `   Add a broader parent tag alongside an existing narrow one, e.g. parent`,
    `   "fashion" for child "teen-fashion". Only suggest a parent that's a real`,
    `   meaningful category for this workspace's clients. The child tag stays.`,
    ``,
    `Constraints:`,
    `- All target tag names must be lowercase, hyphens for spaces, alphanumerics only.`,
    `- Don't propose merges that lose meaning (mens-fashion vs womens-fashion are distinct).`,
    `- High-confidence cleanups only — when in doubt, skip.`,
    `- For add_parent, the parent tag is what someone would actually want to email`,
    `  in bulk. "people" or "humans" are not useful parents.`,
    `- Include a "why" string explaining the operation in one short sentence.`,
    ``,
    `Reply with the JSON object only, no markdown, no commentary.`,
  ].join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    // 876 tags → hundreds of suggested ops can blow the old 4096 cap and
    // truncate the JSON mid-array. 16k gives us plenty of headroom and the
    // recover-from-truncation pass below mops up anything that still spills.
    max_tokens: 16384,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return a usable cleanup plan.');
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) {
    // Truncated mid-array — try to salvage every fully-formed operation
    // object we can find before giving up. Better to show 80% of a useful
    // plan than throw the whole thing away.
    parsed = { operations: salvagePartialOps(match[0]) };
    if (!parsed.operations.length) {
      throw new Error(`Could not parse Claude's response and nothing recoverable: ${e.message}`);
    }
  }
  const ops = Array.isArray(parsed.operations) ? parsed.operations.filter(validateOp) : [];
  return { operations: ops, tagCount: tags.length };
}

// Walk the response text and pull out every fully-balanced { … } object
// inside the operations array. Used when the response was truncated by
// max_tokens — JSON.parse fails on the partial trailing item, but every
// earlier item is intact, so we can still surface them.
function salvagePartialOps(text) {
  const start = text.indexOf('"operations"');
  if (start === -1) return [];
  const arrayStart = text.indexOf('[', start);
  if (arrayStart === -1) return [];
  const ops = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escape = false;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) objectStart = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        const chunk = text.slice(objectStart, i + 1);
        try { ops.push(JSON.parse(chunk)); } catch { /* skip malformed */ }
        objectStart = -1;
      }
      continue;
    }
    if (ch === ']' && depth === 0) break;
  }
  return ops;
}

// Light schema validation — we trust Claude's structure but skip anything
// missing required fields so a bad apple doesn't break the whole batch.
function validateOp(op) {
  if (!op || typeof op !== 'object') return false;
  switch (op.type) {
    case 'rename': return !!(op.from && op.to);
    case 'merge': return Array.isArray(op.from) && op.from.length && op.into;
    case 'delete': return !!op.tag;
    case 'add_parent': return !!(op.child && op.parent);
    default: return false;
  }
}

async function loadTags(visibleClientIds) {
  const params = [];
  let scope = '';
  if (visibleClientIds !== null) {
    params.push(visibleClientIds);
    scope = `WHERE c.client_id = ANY($1::uuid[])
             OR EXISTS (SELECT 1 FROM outreach_contact_clients m
                          WHERE m.contact_id = c.id AND m.client_id = ANY($1::uuid[]))`;
  }
  const { rows } = await pool.query(
    `SELECT t AS tag, COUNT(*)::int AS count
       FROM outreach_contacts c
       CROSS JOIN LATERAL UNNEST(c.tags) t
       ${scope}
      GROUP BY t ORDER BY count DESC, t ASC`,
    params
  );
  return rows;
}

async function loadClientContext(visibleClientIds) {
  const params = [];
  let where = '';
  if (visibleClientIds !== null) {
    params.push(visibleClientIds);
    where = `WHERE id = ANY($1::uuid[])`;
  }
  // The briefing field is the AM's freeform description of the client — gives
  // Claude enough flavour to decide what a sensible parent tag looks like.
  // Truncate hard so 50 clients × N kB doesn't blow the prompt budget.
  const { rows } = await pool.query(
    `SELECT name, LEFT(COALESCE(briefing_field, ''), 240) AS briefing
       FROM clients ${where} ORDER BY name LIMIT 50`,
    params
  );
  return rows;
}

module.exports = { analyseTags };
