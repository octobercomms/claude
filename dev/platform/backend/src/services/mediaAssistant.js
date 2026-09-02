// Media-desk assistant. A chat where the AM dumps websites, contacts, or notes
// and Claude RESEARCHES them (web search + a look at the existing database to
// avoid duplicates) and PROPOSES concrete database changes — publications to
// add, journalists to add, tags to apply. It never writes on its own: it comes
// back with a plain reply and a list of proposed actions the AM approves, then
// applyActions() runs them through the same services the rest of the app uses.
// This keeps the whole thing review-first, matching how everything else here
// works ("happy to be asked to review").

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');
const pr = require('./pr');
let aiModels; try { aiModels = require('./aiModels'); } catch { aiModels = null; }
let rssDiscover; try { rssDiscover = require('./rssDiscover'); } catch { rssDiscover = null; }
let outletResolve; try { outletResolve = require('./outletResolve'); } catch { outletResolve = null; }
let costLog; try { costLog = require('./costLog'); } catch { costLog = null; }

const SYSTEM = `You are the media-desk assistant for October, a PR & communications agency. The account manager pastes in websites, publication names, journalist details, or loose notes. Your job:

1. RESEARCH what they gave you — use web_search to find a publication's official website, a journalist's outlet/beat, etc.
2. Check what already exists — use search_database before proposing anything, so you never create duplicates (and so you can reference existing ids).
3. PROPOSE concrete changes by calling propose_actions. You do NOT save anything yourself — the account manager approves your proposals, then the system applies them.

When the account manager pastes a LINK to a directory or listing page (e.g. a Feedspot "best architecture RSS feeds" page, an awards list, a "top 50 magazines" article), use fetch_page to READ that page, then extract the individual publications from its links and text — each publication's name, its own website, and its RSS feed URL if the page lists one — and propose an add_publication for each. Use the rss_url field when the page gives you the feed directly (skip a lookup); otherwise leave it out and the system will find the feed. Ignore the directory site's own nav/social/advert links.

Rules:
- Proposing IS calling the propose_actions tool. NEVER say "I'll propose…" or "I'll now add…" as prose and stop — that does nothing and frustrates the user. If you have the details, put them in a propose_actions call THIS turn. Always finish by calling propose_actions (empty actions + a short reply only if there's genuinely nothing to change).
- Never claim you've added, saved, tagged, or updated anything — the user approves your proposal first.
- Be specific and British English. Prefer a publication's own website over social/Wikipedia/directory pages.
- If something is ambiguous (which client? which of two people?), ask in the reply and propose what you can.
- A directory can list many publications — propose up to 40 in one call (the user approves them in one click). If there are more, propose the first 40 and say how many remain so they can ask for the rest.`;

function makeTools() {
  return [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },
    {
      name: 'fetch_page',
      description: 'Fetch and read a specific web page the account manager pasted (a directory/listing like a Feedspot RSS page, an awards list, a "top magazines" article). Returns the page title, text, and its outbound links with anchor text and a feed hint. Use this to extract the publications and RSS feeds listed on that page.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'The page URL to read.' } }, required: ['url'] },
    },
    {
      name: 'search_database',
      description: 'Search the existing media database for publications and journalists by name or outlet, to avoid duplicates and to fetch ids. Returns matching publications and contacts.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'A name or partial name to search for.' } }, required: ['query'] },
    },
    {
      name: 'propose_actions',
      description: 'Propose database changes for the account manager to review and approve. Always call this to finish.',
      input_schema: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: 'A short plain-English message to the account manager summarising what you found and what you propose.' },
          actions: {
            type: 'array',
            description: 'The concrete changes to propose. Empty if nothing to change.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['add_publication', 'add_journalist', 'tag_contact'] },
                name: { type: 'string', description: 'Publication name (add_publication) or journalist full name (add_journalist).' },
                url: { type: 'string', description: 'add_publication: the official website URL you found.' },
                rss_url: { type: 'string', description: 'add_publication: the RSS/Atom feed URL, if the page gave it directly. Omit to have the system find it.' },
                outlet: { type: 'string', description: 'add_journalist: the publication they write for.' },
                email: { type: 'string', description: 'add_journalist: their email if known (else omit).' },
                beats: { type: 'array', items: { type: 'string' }, description: 'add_journalist: 2-5 beat tags.' },
                client_name: { type: 'string', description: 'add_journalist: a client to attach them to, if the AM said so.' },
                contact_id: { type: 'string', description: 'tag_contact: id from search_database.' },
                contact_name: { type: 'string', description: 'tag_contact: name if you have no id.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'tag_contact: tags to add.' },
                why: { type: 'string', description: 'One short line on why this change (shown to the AM).' },
              },
              required: ['type'],
            },
          },
        },
        required: ['reply', 'actions'],
      },
    },
  ];
}

const UA = 'Mozilla/5.0 (compatible; OMI-MediaBot/1.0; +https://platform.octobercomms.com)';

// SSRF guard: only public http(s) hosts.
function safeUrl(u) {
  let x; try { x = new URL(String(u || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  return x.href;
}

// Fetch a page the AM pasted (e.g. a Feedspot / directory listing) and return its
// title, a chunk of text, and its outbound links with anchor text — so Claude can
// read the page itself and extract the publications + feed URLs listed on it.
async function fetchPage(url) {
  const safe = safeUrl(url);
  if (!safe) return { error: 'That URL is not a fetchable public web page.' };
  let data;
  try {
    const r = await axios.get(safe, {
      timeout: 15000, maxContentLength: 4 * 1024 * 1024, maxRedirects: 4,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    data = r.data;
  } catch (e) { return { error: `Could not fetch the page: ${e.message}` }; }
  if (typeof data !== 'string') return { error: 'That URL did not return an HTML page.' };

  const $ = cheerio.load(data);
  const title = ($('title').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const links = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    if (links.length >= 300) return;
    let href = $(el).attr('href') || '';
    try { href = new URL(href, safe).href.split('#')[0]; } catch { return; }
    if (!/^https?:/.test(href) || seen.has(href)) return;
    seen.add(href);
    const text = ($(el).text() || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const isFeed = /(rss|feed|atom|\.xml)(\/|$|\?)/i.test(href) || /rss|feed/i.test(text);
    links.push({ text, href, feed: isFeed || undefined });
  });
  $('script, style, noscript').remove();
  const text = ($('body').text() || '').replace(/\s+/g, ' ').trim().slice(0, 5000);
  return { title, text, links };
}

// The one client tool we resolve ourselves: a quick look at the DB.
async function searchDatabase(query) {
  const q = `%${String(query || '').trim().slice(0, 80)}%`;
  const [outlets, contacts] = await Promise.all([
    db.query(`SELECT id, name, url, rss_status FROM pr_outlets WHERE merged_into IS NULL AND name ILIKE $1 ORDER BY name LIMIT 8`, [q]),
    db.query(
      `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email, o.name AS outlet
         FROM outreach_contacts c LEFT JOIN pr_outlets o ON o.id = c.outlet_id
        WHERE c.merged_into IS NULL AND c.kind IN ('media','industry')
          AND (c.name ILIKE $1 OR c.email ILIKE $1)
        ORDER BY c.name LIMIT 8`,
      [q]
    ),
  ]);
  return { publications: outlets.rows, journalists: contacts.rows };
}

function textOf(resp) {
  return (resp.content || []).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
}

// Run one user turn. history is [{role,content(string)}]. Returns { reply, actions }.
async function runMessage({ history = [], message, maxSteps = 6 } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return { reply: 'The assistant needs a Claude API key configured.', actions: [] };
  const client = new Anthropic({ apiKey: key });
  const model = (aiModels ? await aiModels.resolveModel('media_db_research') : null) || 'claude-sonnet-4-6';
  const tools = makeTools();
  const proposeTool = tools.find((t) => t.name === 'propose_actions');

  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
    { role: 'user', content: String(message || '') },
  ];

  const recordCost = (resp) => { if (costLog?.recordClaudeCost) { try { costLog.recordClaudeCost({ model, response: resp, feature: 'media_assistant' }); } catch { /* best effort */ } } };
  const done = (propose, resp) => ({ reply: String(propose.input?.reply || textOf(resp) || 'Here’s what I propose.'), actions: normaliseActions(propose.input?.actions) });

  // Force the model to emit a structured proposal now (used when it narrates
  // "I'll propose…" instead of calling the tool, or when steps run out). Only the
  // propose_actions tool is offered, so it MUST return actions. Big max_tokens so
  // a long list (e.g. a directory of publications) isn't truncated mid-call.
  async function forceProposal() {
    messages.push({ role: 'user', content: 'Now call propose_actions with the concrete changes based on what you found. Do not reply with prose — the proposal only happens by calling the tool. Propose at most 40 items; if there are more, say so in the reply.' });
    let resp;
    try {
      resp = await client.messages.create({ model, max_tokens: 8000, system: SYSTEM, tools: [proposeTool], tool_choice: { type: 'tool', name: 'propose_actions' }, messages });
    } catch (e) { return { reply: `I found the details but couldn’t assemble the proposal: ${e.message}`, actions: [] }; }
    recordCost(resp);
    const propose = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_actions');
    return propose ? done(propose, resp) : { reply: 'I couldn’t settle on concrete changes — try narrowing it down.', actions: [] };
  }

  for (let step = 0; step < maxSteps; step++) {
    let resp;
    try {
      resp = await client.messages.create({ model, max_tokens: 8000, system: SYSTEM, tools, messages });
    } catch (e) { return { reply: `Research failed: ${e.message}`, actions: [] }; }
    recordCost(resp);

    const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
    const propose = toolUses.find((t) => t.name === 'propose_actions');
    if (propose) return done(propose, resp);

    const clientCalls = toolUses.filter((t) => t.name === 'search_database' || t.name === 'fetch_page');
    if (clientCalls.length) {
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const c of clientCalls) {
        let out;
        try { out = c.name === 'fetch_page' ? await fetchPage(c.input?.url) : await searchDatabase(c.input?.query); }
        catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 14000) });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    // The model replied with prose and no tool call — the "I'll propose…" trap.
    // Push its text, then force a real proposal instead of returning the narration.
    messages.push({ role: 'assistant', content: resp.content });
    return await forceProposal();
  }
  // Ran out of research steps — force a final proposal from what we have.
  return await forceProposal();
}

function normaliseActions(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  for (const a of actions.slice(0, 60)) {
    const type = String(a?.type || '');
    if (!['add_publication', 'add_journalist', 'tag_contact'].includes(type)) continue;
    out.push({
      type,
      name: a.name ? String(a.name).slice(0, 200) : undefined,
      url: a.url ? String(a.url).slice(0, 400) : undefined,
      rss_url: a.rss_url ? String(a.rss_url).slice(0, 400) : undefined,
      outlet: a.outlet ? String(a.outlet).slice(0, 200) : undefined,
      email: a.email ? String(a.email).slice(0, 200) : undefined,
      beats: Array.isArray(a.beats) ? a.beats.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6) : undefined,
      client_name: a.client_name ? String(a.client_name).slice(0, 120) : undefined,
      contact_id: a.contact_id ? String(a.contact_id) : undefined,
      contact_name: a.contact_name ? String(a.contact_name).slice(0, 200) : undefined,
      tags: Array.isArray(a.tags) ? a.tags.map((s) => String(s).trim()).filter(Boolean).slice(0, 12) : undefined,
      why: a.why ? String(a.why).slice(0, 240) : undefined,
    });
  }
  return out;
}

async function resolveClientId(name) {
  if (!name) return null;
  const { rows } = await db.query('SELECT id FROM clients WHERE name ILIKE $1 ORDER BY name LIMIT 1', [`%${String(name).trim()}%`]);
  return rows[0]?.id || null;
}

// Apply approved actions. Returns [{ ...action, ok, detail }]. Never throws for a
// single bad action — each is independent.
async function applyActions(actions = []) {
  const results = [];
  for (const a of (Array.isArray(actions) ? actions : [])) {
    try {
      if (a.type === 'add_publication') {
        const outletId = await pr.resolveOutlet(a.name);
        if (!outletId) { results.push({ ...a, ok: false, detail: 'no name' }); continue; }
        if (a.url) await db.query('UPDATE pr_outlets SET url = COALESCE(url, $2) WHERE id = $1', [outletId, a.url]);
        let rss = null;
        if (a.rss_url) {
          // The page gave us the feed directly — store it; nightly ingest will
          // flag it 'error' if it turns out not to be a valid feed.
          await db.query(`UPDATE pr_outlets SET rss_url = $2, rss_status = 'found', rss_checked_at = NOW() WHERE id = $1`, [outletId, a.rss_url]);
          rss = 'found';
        } else if (rssDiscover?.findForOutlet) {
          try { rss = (await rssDiscover.findForOutlet(outletId)).rss_status; } catch { /* keep going */ }
        }
        results.push({ ...a, ok: true, detail: `publication saved${rss ? ` · feed ${rss}` : ''}`, outlet_id: outletId });
      } else if (a.type === 'add_journalist') {
        const outletId = a.outlet ? await pr.resolveOutlet(a.outlet) : null;
        // Reuse an existing contact by email; else create.
        let contactId = null;
        if (a.email) {
          const { rows } = await db.query(`SELECT id FROM outreach_contacts WHERE lower(email)=lower($1) AND kind IN ('media','industry') LIMIT 1`, [a.email]);
          if (rows.length) contactId = rows[0].id;
        }
        if (!contactId) {
          const sp = String(a.name || '').trim().split(/\s+/);
          const first = sp[0] || ''; const last = sp.slice(1).join(' ');
          const beats = a.beats?.length ? JSON.stringify(a.beats) : JSON.stringify([]);
          const { rows } = await db.query(
            `INSERT INTO outreach_contacts (first_name,last_name,name,email,outlet_id,kind,beats,source,verification_status)
             VALUES ($1,$2,$3,$4,$5,'media',$6,'assistant',$7) RETURNING id`,
            [first, last, a.name, a.email || null, outletId, beats, a.email ? 'pending' : 'pending']
          );
          contactId = rows[0].id;
        }
        const clientId = a.client_name ? await resolveClientId(a.client_name) : null;
        if (clientId) await db.query(`INSERT INTO outreach_contact_clients (contact_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [contactId, clientId]);
        results.push({ ...a, ok: true, detail: `journalist saved${clientId ? ' · attached to client' : ''}`, contact_id: contactId });
      } else if (a.type === 'tag_contact') {
        let contactId = a.contact_id || null;
        if (!contactId && a.contact_name) {
          const { rows } = await db.query(`SELECT id FROM outreach_contacts WHERE name ILIKE $1 AND kind IN ('media','industry') AND merged_into IS NULL LIMIT 1`, [`%${a.contact_name}%`]);
          contactId = rows[0]?.id || null;
        }
        if (!contactId || !a.tags?.length) { results.push({ ...a, ok: false, detail: 'contact or tags not resolved' }); continue; }
        await db.query(
          `UPDATE outreach_contacts SET tags = (
             SELECT ARRAY(SELECT DISTINCT UNNEST(COALESCE(tags, ARRAY[]::text[]) || $2::text[])))
           WHERE id = $1`,
          [contactId, a.tags]
        );
        results.push({ ...a, ok: true, detail: `tagged`, contact_id: contactId });
      } else {
        results.push({ ...a, ok: false, detail: 'unknown action' });
      }
    } catch (e) { results.push({ ...a, ok: false, detail: e.message }); }
  }
  return results;
}

module.exports = { runMessage, applyActions, searchDatabase, normaliseActions };
