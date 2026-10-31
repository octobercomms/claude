// Subreddit deep research → content angles (the "Reddit Claude" play).
//
// Point it at the subreddit where a client's buyers actually gather, pull the
// top posts + comments, and have Claude surface the #1 pain-point cluster with
// real evidence — then turn that into shippable content: blog topics, reel
// hooks, a full reel script with a comment-keyword CTA (which drops straight
// into the DM bot's comment-to-DM), and a lead-magnet outline. One research
// snapshot per run, saved so the AM can revisit and reuse the angles.

const pool = require('../db');
const claudeService = require('./claude');
const apify = require('../connectors/apify');

function parseJson(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a >= 0 && b > a) s = s.slice(a, b + 1); }
  return JSON.parse(s);
}
function strArr(a, n = 20) { return Array.isArray(a) ? a.map(x => String(x).trim()).filter(Boolean).slice(0, n) : []; }

async function loadClient(clientId) {
  const { rows } = await pool.query('SELECT name, briefing_field, monthly_focus, social_competitors FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  return rows[0];
}

// ─── the stored list ────────────────────────────────────────────────────────
//
// Claude's suggestions used to be chips that filled a text box and vanished
// on reload, so seeing them again cost another call. Stored, they are a list
// you configure: a focus and a window per row, and research runs against the
// row.

const WINDOWS = ['week', 'month', 'year', 'all'];

// Trim before stripping the prefix as well as after: " r/ " arrives from a
// paste often enough, and stripping first leaves "r/" looking like a name.
function normName(input) {
  return String(input || '').trim().replace(/^\/?r\//i, '').trim();
}

async function listSubreddits(clientId) {
  const { rows } = await pool.query(
    `SELECT id, name, why, focus, time_window, source, researched_at, created_at
       FROM client_subreddits WHERE client_id = $1 ORDER BY created_at`, [clientId]);
  return rows;
}

async function addSubreddit(clientId, { name, why = null, focus = null, time_window = 'month', source = 'manual' } = {}) {
  const clean = normName(name);
  if (!clean) { const e = new Error('Name the subreddit.'); e.status = 400; throw e; }
  const win = WINDOWS.includes(time_window) ? time_window : 'month';
  // ON CONFLICT rather than a read-then-write: two suggests racing would both
  // see nothing and both insert.
  const { rows } = await pool.query(
    `INSERT INTO client_subreddits (client_id, name, why, focus, time_window, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_id, lower(name)) DO UPDATE
       SET why = COALESCE(client_subreddits.why, EXCLUDED.why)
     RETURNING *`,
    [clientId, clean, why, focus, win, source]);
  return rows[0];
}

async function updateSubreddit(clientId, id, { focus, time_window } = {}) {
  const sets = [];
  const vals = [id, clientId];
  if (focus !== undefined) { sets.push(`focus = $${vals.length + 1}`); vals.push(focus || null); }
  if (time_window !== undefined) {
    sets.push(`time_window = $${vals.length + 1}`);
    vals.push(WINDOWS.includes(time_window) ? time_window : 'month');
  }
  if (!sets.length) { const e = new Error('Nothing to change.'); e.status = 400; throw e; }
  const { rows } = await pool.query(
    `UPDATE client_subreddits SET ${sets.join(', ')} WHERE id = $1 AND client_id = $2 RETURNING *`, vals);
  if (!rows[0]) { const e = new Error('Subreddit not found for this client.'); e.status = 404; throw e; }
  return rows[0];
}

async function removeSubreddit(clientId, id) {
  await pool.query('DELETE FROM client_subreddits WHERE id = $1 AND client_id = $2', [id, clientId]);
}

// Ask Claude, but only when the list is empty.
//
// `force` is the explicit "suggest more" press, the one case where paying for
// a second opinion is what was asked for. Opening the screen, or a setup scan
// on a client that already has a list, reads the table and spends nothing.
// Same rule as clientCompetitors.suggest, for the same reason.
async function suggestAndStore(clientId, { force = false } = {}) {
  const existing = await listSubreddits(clientId);
  if (existing.length && !force) return { subreddits: existing, from: 'stored' };
  const proposed = await suggest(clientId);
  for (const s of proposed) {
    // One at a time: one row failing to insert should not lose the rest.
    try { await addSubreddit(clientId, { ...s, source: 'suggest' }); }
    catch (err) { console.error('[subreddits] could not store suggestion:', s.name, err.message); }
  }
  return { subreddits: await listSubreddits(clientId), from: 'claude' };
}

// Suggest a few subreddits where this client's buyers gather (no scrape, cheap).
async function suggest(clientId) {
  const c = await loadClient(clientId);
  const raw = await claudeService.callClaude({
    max_tokens: 700,
    system: 'You know Reddit well. You name the specific subreddits where a business\'s prospective CUSTOMERS gather (not where its peers/competitors hang out), for pain-point research. Prefer the practitioner/buyer community over the enthusiast one (e.g. r/Architects, where firm owners gather, over r/architecture, which is students). British English. JSON only — no prose, no fences.',
    user: `Business: ${c.name}
About: ${c.briefing_field || '(no brief)'}
This month's focus: ${c.monthly_focus || '(none)'}

Name the 3–6 subreddits most likely to contain this business's buyers discussing their problems. Return ONLY:
{"subreddits":[{"name":"SubredditName (no r/ prefix)","why":"who gathers here and why it fits"}]}`,
    feature: 'subreddit_suggest', clientId,
  });
  const list = Array.isArray(parseJson(raw)?.subreddits) ? parseJson(raw).subreddits : [];
  return list.map(s => ({ name: String(s.name || '').replace(/^\/?r\//i, '').trim(), why: s.why ? String(s.why) : null })).filter(s => s.name).slice(0, 6);
}

const ANALYSIS_SYSTEM = `You are a direct-response content strategist. You read a subreddit's top posts + comments and find the single biggest, most repeated PAIN POINT the community has — grounded in what people actually wrote, not what you assume. Then you turn it into shippable content for the client.

Rules:
 - Evidence first: cite real post titles / paraphrased quotes from the data as proof of each pain. Never invent a pain the posts don't support; if the data is thin, say so in analysis_note.
 - The reel must drive COMMENTS: its CTA asks viewers to comment a single, easy-to-spell keyword to receive the lead magnet (this triggers a comment-to-DM automation).
 - British English. No hype or filler. JSON only — no prose, no fences.`;

async function run(clientId, { subreddit, focus, sort = 'top', time = 'month' } = {}) {
  const c = await loadClient(clientId);
  const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
  if (!sub) { const e = new Error('Pick a subreddit to research.'); e.status = 400; throw e; }

  const posts = await apify.fetchSubredditPosts({ subreddit: sub, sort, time, limit: 40 });
  if (!posts.length) { const e = new Error(`No posts came back for r/${sub} — check the name (and that APIFY_API_TOKEN is set).`); e.status = 502; throw e; }

  // Compact the posts for the prompt: title, score, a little body, a couple of comments.
  const digest = posts.map((p, i) => {
    const cmts = (p.comments || []).slice(0, 3).map(x => `    · ${String(x).slice(0, 200)}`).join('\n');
    return `#${i + 1} [${p.score ?? '?'}▲ ${p.num_comments ?? '?'}💬] ${p.title}${p.body ? `\n    ${p.body.slice(0, 300)}` : ''}${cmts ? `\n${cmts}` : ''}`;
  }).join('\n');

  const user = `Client: ${c.name}
About: ${c.briefing_field || '(no brief)'}
${focus ? `Focus for this research: ${focus}` : ''}

Subreddit analysed: r/${sub} (${sort}, ${time}). ${posts.length} posts:
${digest}

Find the #1 pain-point cluster and build the content. Return ONLY:
{
 "top_pain": "the single biggest pain, one sentence in the audience's language",
 "pain_points": [{"pain":"...","evidence":["real post title or paraphrased quote", "..."],"severity":"high|medium"}],
 "analysis_note": "one line on how strong the signal was (and any caveat if the data was thin)",
 "blog_topics": [{"title":"blog post title","angle":"what it argues / who it's for"}],
 "reel_hooks": [{"hook":"a 3-second scroll-stopper","angle":"the point it makes"}],
 "reel_script": {"hook":"on-screen + spoken opener","body":"the 3–25s body","cta":"the comment-to-get-it CTA","keyword":"ONE easy word to comment","caption":"the post caption with a few hashtags"},
 "lead_magnet": {"title":"the quick-fix asset title","format":"checklist | prompt pack | mini-guide","outline":["section 1","section 2","..."]}
}

Give 5–8 blog_topics and 6–10 reel_hooks. The reel_script.keyword must be a single, easy-to-spell word.`;

  const raw = await claudeService.callClaude({ max_tokens: 4000, system: ANALYSIS_SYSTEM, user, feature: 'subreddit_research', clientId });
  const out = parseJson(raw);

  const result = {
    subreddit: sub, sort, time, focus: focus || null, post_count: posts.length,
    top_pain: out.top_pain ? String(out.top_pain) : null,
    analysis_note: out.analysis_note ? String(out.analysis_note) : null,
    pain_points: Array.isArray(out.pain_points) ? out.pain_points.slice(0, 6).map(p => ({
      pain: String(p.pain || ''), severity: p.severity === 'high' ? 'high' : 'medium', evidence: strArr(p.evidence, 6),
    })).filter(p => p.pain) : [],
    blog_topics: Array.isArray(out.blog_topics) ? out.blog_topics.slice(0, 10).map(b => ({ title: String(b.title || ''), angle: b.angle ? String(b.angle) : null })).filter(b => b.title) : [],
    reel_hooks: Array.isArray(out.reel_hooks) ? out.reel_hooks.slice(0, 12).map(h => ({ hook: String(h.hook || ''), angle: h.angle ? String(h.angle) : null })).filter(h => h.hook) : [],
    reel_script: out.reel_script && typeof out.reel_script === 'object' ? {
      hook: String(out.reel_script.hook || ''), body: String(out.reel_script.body || ''),
      cta: String(out.reel_script.cta || ''), keyword: String(out.reel_script.keyword || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
      caption: String(out.reel_script.caption || ''),
    } : null,
    lead_magnet: out.lead_magnet && typeof out.lead_magnet === 'object' ? {
      title: String(out.lead_magnet.title || ''), format: String(out.lead_magnet.format || ''), outline: strArr(out.lead_magnet.outline, 20),
    } : null,
    top_posts: posts.slice(0, 12).map(p => ({ title: p.title, score: p.score, num_comments: p.num_comments, url: p.url })),
  };

  const { rows } = await pool.query(
    `INSERT INTO subreddit_research (client_id, subreddit, focus, result, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [clientId, sub, focus || null, JSON.stringify(result), null]
  );
  // Stamp the stored row, so the list says which ones have been looked at
  // rather than leaving the AM to work it out from the history rail. A
  // one-off typed subreddit matches nothing and stamps nothing.
  await pool.query(
    'UPDATE client_subreddits SET researched_at = NOW() WHERE client_id = $1 AND lower(name) = lower($2)',
    [clientId, sub]);
  return rows[0];
}

async function list(clientId) {
  const { rows } = await pool.query(
    'SELECT id, subreddit, focus, created_at FROM subreddit_research WHERE client_id = $1 ORDER BY created_at DESC LIMIT 50',
    [clientId]
  );
  return rows;
}
async function get(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM subreddit_research WHERE id = $1 AND client_id = $2', [id, clientId]);
  return rows[0] || null;
}
async function remove(clientId, id) {
  await pool.query('DELETE FROM subreddit_research WHERE id = $1 AND client_id = $2', [id, clientId]);
}

module.exports = {
  suggest, suggestAndStore, run, list, get, remove,
  listSubreddits, addSubreddit, updateSubreddit, removeSubreddit,
  WINDOWS, _parseJson: parseJson, _normName: normName,
};
