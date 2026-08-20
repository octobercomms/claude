// Add a tender by URL — the guaranteed path. The user pastes a notice link they
// found anywhere (a portal, an aggregator, a forwarded email), Claude reads the
// page and extracts the details, and it drops into the same pipeline as every
// other notice (classify / dismiss / Start with Claude / email digest).
//
// Reading the page is done Anthropic-side via web_fetch (so it isn't subject to
// the portal firewalls that block our server), with a server-side fetch +
// text-parse fallback if web_fetch isn't enabled on the account.

const Anthropic = require('@anthropic-ai/sdk');
const http = require('./http');
const { resolveClosing, parseAmount } = require('./normalise');
const { refFromUrl } = require('./sources/webSearch');
const { recordClaudeCost } = require('../costLog');

const MODEL = 'claude-sonnet-4-6';

function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractObject(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { const v = JSON.parse(cand.trim()); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

function prompt(url, pageText) {
  return `Extract the public-sector tender / contract notice described below into JSON.
${pageText ? `Here is the plain text of the page at ${url}:\n"""\n${pageText}\n"""` : `Fetch the page at ${url} and read it.`}

Return ONLY a JSON object (in a \`\`\`json block), using null for anything genuinely not stated:
{
  "title": "the notice title",
  "buyer": "the contracting organisation / buyer",
  "country": "United Kingdom | Canada | European Union | United States | …",
  "closing": "the submission deadline as YYYY-MM-DD",
  "value": "contract value if stated, e.g. £20,000",
  "summary": "one sentence on what the buyer needs"
}
If the page is not actually a tender/contract notice, return {"title": null}.`;
}

async function textFromClaude(client, messages, tools) {
  const msg = await client.messages.create({ model: MODEL, max_tokens: 1500, ...(tools ? { tools } : {}), messages });
  try { recordClaudeCost({ model: MODEL, response: msg, feature: 'tender_add_url' }); } catch { /* non-fatal */ }
  return (msg.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
}

// Read the URL and return a normalised notice, or throw a user-facing error.
async function buildNotice(url) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('Claude API key not configured on the server.');
  const client = new Anthropic({ apiKey: key });

  let text;
  try {
    // Preferred: let Claude fetch the page itself (Anthropic-side).
    text = await textFromClaude(client, [{ role: 'user', content: prompt(url, null) }],
      [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }]);
  } catch {
    // Fallback: fetch the page from our server, then parse the text.
    let pageText = '';
    try { pageText = stripHtml(await http.get(url, { type: 'text', timeout: 20000 })).slice(0, 16000); }
    catch { /* handled below */ }
    if (!pageText) throw new Error('Could not read that page — the portal may block automated access. Open the notice and try a different link, or paste the details manually.');
    text = await textFromClaude(client, [{ role: 'user', content: prompt(url, pageText) }], null);
  }

  const obj = extractObject(text);
  if (!obj || !obj.title) throw new Error("That page doesn't look like a tender notice — check the link points to the notice itself.");

  const { closing_at, needs_manual_check } = resolveClosing(obj.closing);
  return {
    external_ref: refFromUrl(url, obj.title),
    url,
    title: String(obj.title).trim(),
    buyer_name: obj.buyer ? String(obj.buyer).trim() : null,
    buyer_country: obj.country ? String(obj.country).trim() : null,
    buyer_city: null,
    cpv_codes: [],
    published_at: null,
    closing_at,
    value_min: parseAmount(obj.value),
    value_max: parseAmount(obj.value),
    currency: null,
    description: obj.summary ? String(obj.summary).trim() : null,
    raw_payload: { via: 'manual', url },
    needs_manual_check,
  };
}

module.exports = { buildNotice };
