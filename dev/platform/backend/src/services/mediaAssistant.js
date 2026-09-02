// Media-desk assistant. A chat where the AM dumps websites, contacts, or notes
// and Claude RESEARCHES them (web search + a look at the existing database to
// avoid duplicates) and PROPOSES concrete database changes — publications to
// add, journalists to add, tags to apply. It never writes on its own: it comes
// back with a plain reply and a list of proposed actions the AM approves, then
// applyActions() runs them through the same services the rest of the app uses.
// This keeps the whole thing review-first, matching how everything else here
// works ("happy to be asked to review").

const Anthropic = require('@anthropic-ai/sdk');
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

Rules:
- Always finish your turn by calling propose_actions (with an empty actions list if there's genuinely nothing to change, plus a short reply explaining).
- Never claim you've added, saved, tagged, or updated anything — you only propose. Say "I'll propose…", not "I've added…".
- Be specific and British English. Prefer a publication's own website over social/Wikipedia/directory pages.
- If something is ambiguous (which client? which of two people?), ask in the reply and propose what you can.`;

function makeTools() {
  return [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },
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
async function runMessage({ history = [], message, maxSteps = 5 } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return { reply: 'The assistant needs a Claude API key configured.', actions: [] };
  const client = new Anthropic({ apiKey: key });
  const model = (aiModels ? await aiModels.resolveModel('media_db_research') : null) || 'claude-sonnet-4-6';
  const tools = makeTools();

  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
    { role: 'user', content: String(message || '') },
  ];

  for (let step = 0; step < maxSteps; step++) {
    let resp;
    try {
      resp = await client.messages.create({ model, max_tokens: 2000, system: SYSTEM, tools, messages });
    } catch (e) { return { reply: `Research failed: ${e.message}`, actions: [] }; }
    if (costLog?.recordClaudeCost) { try { costLog.recordClaudeCost({ model, response: resp, feature: 'media_assistant' }); } catch { /* best effort */ } }

    const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
    const propose = toolUses.find((t) => t.name === 'propose_actions');
    if (propose) {
      return { reply: String(propose.input?.reply || textOf(resp) || 'Here’s what I propose.'), actions: normaliseActions(propose.input?.actions) };
    }
    const dbCalls = toolUses.filter((t) => t.name === 'search_database');
    if (dbCalls.length) {
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const c of dbCalls) {
        let out; try { out = await searchDatabase(c.input?.query); } catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    // web_search runs server-side within the call; if we only got text back and
    // no propose, return it as a plain reply.
    const t = textOf(resp);
    if (t) return { reply: t, actions: [] };
  }
  return { reply: 'I looked into that but couldn’t settle on concrete changes — can you give me a bit more detail?', actions: [] };
}

function normaliseActions(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  for (const a of actions.slice(0, 40)) {
    const type = String(a?.type || '');
    if (!['add_publication', 'add_journalist', 'tag_contact'].includes(type)) continue;
    out.push({
      type,
      name: a.name ? String(a.name).slice(0, 200) : undefined,
      url: a.url ? String(a.url).slice(0, 400) : undefined,
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
        if (rssDiscover?.findForOutlet) { try { rss = (await rssDiscover.findForOutlet(outletId)).rss_status; } catch { /* keep going */ } }
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
