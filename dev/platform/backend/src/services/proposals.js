// Sales pipeline + proposal engine (docs/omi/sales-pipeline.md).
//
//   callBrief(leadId)        → pre-call talking points from the snapshot + notes
//   generate(leadId, opts)   → draft a personalised proposal in the ROAR
//                              structure, match proof to the prospect, price it
//   refine / update / send   → one-glance approval, then a tracked link
//   recordOpen / recordPing  → public page engagement (section dwell)
//   runDecayAlerts()         → unopened / opened-no-reply / cooling → Daniel
//   runReportNudges()        → the single Stage 2 nudge to the prospect
//
// Nothing in here messages a prospect automatically except the Stage 2 nudge,
// which the brief sanctions because it is low-stakes. Every proposal-stage
// signal goes to Daniel as an alert with a suggested move.

const crypto = require('crypto');
const pool = require('../db');
const claude = require('./claude');
const studio = require('./snapshotStudio');
const email = require('./emailService');

const PLATFORM_URL = () => (process.env.PLATFORM_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');
const BOOK_URL = () => process.env.SNAPSHOT_BOOK_URL || 'https://octobercomms.com/book/';
const hours = (envKey, dflt) => {
  const n = parseFloat(process.env[envKey]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// ─── The Earned Reach Method package ────────────────────────────────────────
// Mirrors octobercomms.com/earned-reach. Advanced is listed first on purpose:
// it anchors the price, and Basic reads as the careful option.
const PACKAGES = {
  advanced: {
    key: 'advanced', name: 'Advanced', monthly: 2500,
    items: [
      'Everything in Basic',
      'Two initiatives running concurrently',
      'Priority press pitching',
      'Plan of work reviewed and adjusted monthly',
      'Direct line for in-quarter changes',
    ],
  },
  basic: {
    key: 'basic', name: 'Basic', monthly: 1800,
    items: [
      'Quarterly visibility audit',
      'One initiative in focus (PR, SEO or content)',
      'Written plan of work each quarter',
      'Monitoring, tracking and maintenance',
      'Quarterly reporting on citations and recognition',
    ],
  },
};

const METHOD = [
  { stage: '01', when: 'month one', title: 'the audit', text: 'We check where the practice is visible right now across search, AI answers, press and referral networks, rather than assuming. This sets the baseline every quarter is measured against.' },
  { stage: '02', when: 'month two', title: 'the priority', text: 'The audit points to one lever that matters most right now. That becomes the plan of work, delivered in writing before the quarter starts, and it gets full attention.' },
  { stage: '03', when: 'month three', title: 'the review', text: 'Reported against the gap named in month one. What worked continues, what didn\'t gets replaced by the next priority, and the cycle repeats, compounding each quarter.' },
];

const SECTION_KEYS = ['cover', 'letter', 'situation', 'plan', 'method', 'proof', 'pricing', 'next'];

// ─── Proof library + matching ───────────────────────────────────────────────
async function listProof({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM proof_items ${includeInactive ? '' : 'WHERE active'} ORDER BY kind, title`
  );
  return rows;
}

const tagList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);

async function saveProof(id, f) {
  const vals = [f.kind, f.title, f.body, f.attribution || null, tagList(f.sector_tags), tagList(f.problem_tags),
    f.url || null, f.image_url || null, f.active !== false];
  if (!['case_study', 'testimonial', 'credential', 'press'].includes(f.kind)) throw new Error('kind must be case_study, testimonial, credential or press');
  if (!String(f.title || '').trim() || !String(f.body || '').trim()) throw new Error('title and body are required');
  if (id) {
    const { rows } = await pool.query(
      `UPDATE proof_items SET kind=$1, title=$2, body=$3, attribution=$4, sector_tags=$5, problem_tags=$6,
         url=$7, image_url=$8, active=$9 WHERE id=$10 RETURNING *`, [...vals, id]);
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO proof_items (kind, title, body, attribution, sector_tags, problem_tags, url, image_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, vals);
  return rows[0];
}

async function deleteProof(id) {
  await pool.query('DELETE FROM proof_items WHERE id = $1', [id]);
}

// Score = sector overlap ×3 + problem overlap ×2. Sector matters more: an
// architect trusts another architect's quote over a furniture brand's, even
// on the same problem. Returns items ranked with a human-readable reason so
// the approval screen can show WHY each was picked.
function rankProof(items, sectorTags, problemTags) {
  const S = new Set(tagList(sectorTags));
  const P = new Set(tagList(problemTags));
  return items.map(it => {
    const sHit = (it.sector_tags || []).filter(t => S.has(t));
    const pHit = (it.problem_tags || []).filter(t => P.has(t));
    const score = sHit.length * 3 + pHit.length * 2;
    const why = [sHit.length ? `sector: ${sHit.join(', ')}` : null, pHit.length ? `evidences: ${pHit.join(', ')}` : null]
      .filter(Boolean).join(' · ') || 'no tag overlap, best available';
    return { id: it.id, kind: it.kind, title: it.title, score, why };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function matchProof(items, sectorTags, problemTags) {
  const ranked = rankProof(items, sectorTags, problemTags);
  const of = (k) => ranked.filter(r => r.kind === k);
  const pick = (k, n) => of(k).slice(0, n);
  const chosen = {
    case_study: pick('case_study', 1)[0]?.id || null,
    testimonial: pick('testimonial', 1)[0]?.id || null,
    credentials: pick('credential', 2).map(r => r.id),
    press: pick('press', 1)[0]?.id || null,
  };
  const reasons = Object.fromEntries(ranked.map(r => [r.id, { why: r.why, score: r.score }]));
  const alternatives = {
    case_study: of('case_study').map(r => r.id),
    testimonial: of('testimonial').map(r => r.id),
    credential: of('credential').map(r => r.id),
    press: of('press').map(r => r.id),
  };
  return { ...chosen, reasons, alternatives };
}

// ─── Claude prompts ─────────────────────────────────────────────────────────
const VOICE = `Voice rules (October Communications, Daniel Nelson, founder):
- British English. Direct, commercially grounded, plain words. No hype, no filler, no motivational language.
- Never use em dashes or en dashes. Use commas, full stops or semicolons.
- Never write "not just X, but Y" or "not only X, but also Y".
- Avoid: can, may, just, very, really, actually, certainly, probably, basically, could, maybe, delve, embark, unlock, discover, skyrocket, game-changer, realm, imagine, crafting.
- Assumptive throughout: "when we start", "in month one we will", never "if you'd like to proceed".
- Specific over general. Every claim about the prospect must come from the inputs (site text, snapshot, call notes). Never invent metrics, awards, press titles or project names you were not given.`;

const PROPOSAL_SYSTEM = `You write sales proposals for October Communications, a London marketing and PR agency for architects, designers and design-led brands. The offer is the Earned Reach Method: one audit, one priority at a time, reviewed each quarter, run across press, search/AI citation and referral networks.

The proposal must read like Daniel wrote it after a proper conversation. The benchmark is this passage from a proposal that won:
"The homepage rotates six lead projects; four of six sit in East or North London. Well Walk and Newton Park Place, the two that would evidence higher-bracket capability, get the same grid treatment and the same generic caption as the rest, so nothing tells a Chelsea prospect that ROAR handles a different scale of project."
Notice: named specifics, a counted observation, the commercial consequence. That is the standard for the situation section. The diagnosis should reframe the problem ("That's a storytelling and positioning problem, not a press problem.").

${VOICE}

Return ONLY a JSON object, no prose, no code fences:
{
  "sector_tags": [string],          // 1-3 lowercase tags from: architecture, interiors, residential, commercial, furniture, design, retail, homeware, hospitality, property, construction, culture, events, fashion, lighting
  "problem_tags": [string],         // 2-4 lowercase tags from: press, search, ai, social, content, positioning, leads, ecommerce, paid, trust
  "letter": [string],               // 2-3 short paragraphs. Para 1 restates what they told us they want, in their terms. Para 2 names the real problem in one line and how this proposal closes it. No greeting line, no sign-off.
  "situation": [string],            // 3-5 paragraphs. Evidence-led diagnosis of where they stand, using the site text, snapshot findings and call notes.
  "objectives": { "short": string, "mid": string, "long": string },   // 0-3 months, 3-9 months, 9-18 months
  "kpis": [string],                 // 3-5 measurable indicators
  "strategy": [ { "title": string, "text": string } ],                 // 3-4 strategic moves
  "priority": { "title": string, "text": string },                     // THE first-quarter priority the audit is expected to confirm. One lever, argued.
  "tactics": [ { "heading": string, "items": [string] } ],             // 3-5 groups, 2-4 items each, specific to them
  "email_subject": string,          // short, lowercase-friendly, e.g. "your proposal, as discussed"
  "email_note": string              // 2-3 sentence personal covering note referencing one thing from the call. No sign-off.
}`;

const BRIEF_SYSTEM = `You prepare Daniel Nelson (founder, October Communications) for a 20-30 minute discovery call on Google Meet with a prospect who ran October's free visibility snapshot.

${VOICE}

Return ONLY JSON:
{
  "opener": string,                                  // one sentence to open the call with, specific to their domain
  "talking_points": [ { "point": string, "evidence": string } ],   // exactly 3, the sharpest findings, each with what on their site shows it
  "questions": [string],                             // 3-4 qualifying questions: budget ownership, timeline, what they've tried, what "good" looks like
  "likely_objection": { "objection": string, "answer": string }
}`;

function parseJson(str) {
  let s = String(str || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// Belt and braces for the voice rules: dashes the model slips in become commas.
function scrubDashes(v) {
  if (typeof v === 'string') return v.replace(/\s*[—–]\s*/g, ', ').replace(/ -- /g, ', ');
  if (Array.isArray(v)) return v.map(scrubDashes);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDashes(x)]));
  return v;
}

async function siteText(lead) {
  try {
    const parsed = studio.normaliseUrl(lead.url);
    await studio.assertPublicHost(parsed);
    const site = await studio.crawlSite(parsed, { maxPages: 6 });
    return site.text;
  } catch (e) {
    console.warn(`[proposals] site crawl failed for ${lead.url}: ${e.message}`);
    return '';
  }
}

function snapshotBlock(lead) {
  const d = lead.draft || {};
  if (!d.summary && !d.sections) return '(no snapshot drafted)';
  return JSON.stringify({
    scores: d.scores, score_notes: d.score_notes, headline_opportunity: d.headline_opportunity,
    summary: d.summary, sections: d.sections,
  });
}

// ─── Stage 3: pre-call brief ────────────────────────────────────────────────
async function callBrief(leadId) {
  let lead = await studio.getLead(leadId);
  if (!lead) throw new Error('Lead not found');
  if (!lead.draft) lead = await studio.gather(leadId);   // make sure there's an analysis to walk through
  const user = `Prospect: ${lead.company_name || lead.url}\nWebsite: ${lead.url}\nContact: ${lead.contact_name || 'unknown'}\nHow they found us: ${lead.referral_source || 'unknown'}\n\nSnapshot findings:\n${snapshotBlock(lead)}\n\nNotes so far:\n${lead.call_notes || lead.notes || '(none)'}\n\nWrite the call brief JSON.`;
  const raw = await claude.callClaude({ max_tokens: 1400, system: BRIEF_SYSTEM, user, feature: 'pipeline_call_brief' });
  const brief = scrubDashes(parseJson(raw));
  brief.generated_at = new Date().toISOString();
  await pool.query('UPDATE snapshot_leads SET call_brief = $1 WHERE id = $2', [JSON.stringify(brief), leadId]);
  return studio.getLead(leadId);
}

async function markCallBooked(leadId, callAt) {
  const when = callAt ? new Date(callAt) : null;
  if (callAt && isNaN(when)) throw new Error('Invalid call time');
  await pool.query(
    `UPDATE snapshot_leads SET status = CASE WHEN status IN ('proposal','won') THEN status ELSE 'booked' END,
       call_at = COALESCE($1, call_at), call_booked_at = COALESCE(call_booked_at, NOW()) WHERE id = $2`,
    [when, leadId]);
  return studio.getLead(leadId);
}

// ─── Stage 4: generate ──────────────────────────────────────────────────────
function coverImage(lead) {
  const imgs = lead.images || [];
  const featured = imgs.find(i => i.featured && i.kind === 'site') || imgs.find(i => i.kind === 'site');
  return featured?.url || null;
}

function assemble(draft, lead, extras = {}) {
  return {
    ...draft,
    company_name: extras.company_name || lead.company_name || '',
    cover_image: extras.cover_image !== undefined ? extras.cover_image : coverImage(lead),
    date_label: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    currency: extras.currency || process.env.PIPELINE_CURRENCY || '£',
    setup_fee: extras.setup_fee ?? null,
    recommended: extras.recommended || 'advanced',
  };
}

async function generate(leadId, { recipientNames, recipientEmail, callNotes, angle, currency, setupFee } = {}) {
  const lead = await studio.getLead(leadId);
  if (!lead) throw new Error('Lead not found');
  if (callNotes !== undefined) {
    await pool.query('UPDATE snapshot_leads SET call_notes = $1 WHERE id = $2', [callNotes || null, leadId]);
    lead.call_notes = callNotes;
  }
  const text = await siteText(lead);
  const names = recipientNames || lead.contact_name || '';
  const user = `Prospect company: ${lead.company_name || lead.url}
Website: ${lead.url}
Addressed to: ${names || 'the team'}
How they found us: ${lead.referral_source || 'unknown'}
Daniel's angle for this one: ${angle || '(none given, find it from the evidence)'}

CALL NOTES (the most important input; what they said they want):
"""
${lead.call_notes || lead.notes || '(no call notes, lean on the site and snapshot)'}
"""

SNAPSHOT FINDINGS (from October's visibility snapshot):
${snapshotBlock(lead)}

SITE TEXT (several pages, each marked with its URL):
"""
${text || '(site could not be read)'}
"""

Write the proposal JSON for ${lead.company_name || 'this prospect'}.`;

  const raw = await claude.callClaude({ max_tokens: 4500, system: PROPOSAL_SYSTEM, user, feature: 'pipeline_proposal' });
  const draft = scrubDashes(parseJson(raw));

  const proof = await listProof();
  const matched = matchProof(proof, draft.sector_tags, draft.problem_tags);
  const content = assemble(draft, lead, { currency, setup_fee: setupFee });

  const token = crypto.randomBytes(18).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO proposals (lead_id, token, recipient_email, recipient_names, content, matched)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [leadId, token, recipientEmail || lead.email || null, names || null, JSON.stringify(content), JSON.stringify(matched)]);
  return getProposal(rows[0].id);
}

async function refine(id, message) {
  const p = await getProposal(id);
  if (!p) throw new Error('Proposal not found');
  const user = `Current proposal JSON:\n${JSON.stringify(p.content)}\n\nDaniel says: "${message}"\n\nReturn the FULL updated JSON in the same schema. Apply the change, keep everything else intact, keep the voice rules.`;
  const raw = await claude.callClaude({ max_tokens: 4500, system: PROPOSAL_SYSTEM, user, feature: 'pipeline_proposal' });
  const next = { ...p.content, ...scrubDashes(parseJson(raw)) };
  await pool.query('UPDATE proposals SET content = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(next), id]);
  return getProposal(id);
}

// Manual edits from the approval screen. Content is merged shallowly so the
// editor can patch one section; matched proof is replaced wholesale.
async function update(id, f = {}) {
  const p = await getProposal(id);
  if (!p) throw new Error('Proposal not found');
  const sets = [], vals = [];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (f.content && typeof f.content === 'object') put('content', JSON.stringify({ ...p.content, ...f.content }));
  if (f.matched && typeof f.matched === 'object') put('matched', JSON.stringify({ ...p.matched, ...f.matched }));
  if ('recipient_email' in f) put('recipient_email', f.recipient_email || null);
  if ('recipient_names' in f) put('recipient_names', f.recipient_names || null);
  if (f.status === 'replied') { put('status', 'replied'); sets.push('replied_at = COALESCE(replied_at, NOW())'); }
  if (f.status === 'lost') { put('status', 'lost'); put('lost_reason', f.lost_reason || null); }
  if (!sets.length) return p;
  sets.push('updated_at = NOW()');
  vals.push(id);
  await pool.query(`UPDATE proposals SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  if (f.status === 'lost') await pool.query(`UPDATE snapshot_leads SET status = 'archived' WHERE id = $1`, [p.lead_id]);
  return getProposal(id);
}

async function remove(id) {
  await pool.query('DELETE FROM proposals WHERE id = $1', [id]);
}

// ─── Reads ──────────────────────────────────────────────────────────────────
async function engagement(proposalId) {
  const { rows } = await pool.query(
    `SELECT sections, started_at, last_ping_at FROM proposal_views WHERE proposal_id = $1 ORDER BY started_at`, [proposalId]);
  const totals = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.sections || {})) totals[k] = (totals[k] || 0) + Number(v || 0);
  const days = new Set(rows.map(r => new Date(r.started_at).toISOString().slice(0, 10)));
  return {
    sessions: rows.length,
    distinct_days: days.size,
    seconds: Object.values(totals).reduce((a, b) => a + b, 0),
    sections: totals,
    views: rows.map(r => ({ started_at: r.started_at, last_ping_at: r.last_ping_at, seconds: Object.values(r.sections || {}).reduce((a, b) => a + Number(b || 0), 0) })),
  };
}

async function getProposal(id) {
  const { rows } = await pool.query(
    `SELECT p.*, l.company_name, l.url AS lead_url, l.email AS lead_email, l.contact_name
       FROM proposals p JOIN snapshot_leads l ON l.id = p.lead_id WHERE p.id = $1`, [id]);
  if (!rows.length) return null;
  const p = rows[0];
  p.engagement = await engagement(id);
  p.link = `${PLATFORM_URL()}/p/${p.token}`;
  return p;
}

async function listProposals() {
  const { rows } = await pool.query(
    `SELECT p.id, p.lead_id, p.status, p.recipient_email, p.recipient_names, p.sent_at, p.first_opened_at,
            p.last_opened_at, p.open_count, p.replied_at, p.accepted_at, p.accepted_package, p.created_at,
            l.company_name, l.url AS lead_url,
            COALESCE((SELECT SUM((value)::numeric) FROM proposal_views v, jsonb_each_text(v.sections)
                       WHERE v.proposal_id = p.id), 0)::int AS seconds,
            COALESCE((SELECT SUM((v.sections->>'pricing')::numeric) FROM proposal_views v
                       WHERE v.proposal_id = p.id), 0)::int AS pricing_seconds
       FROM proposals p JOIN snapshot_leads l ON l.id = p.lead_id
      ORDER BY p.created_at DESC LIMIT 300`);
  return rows;
}

async function listForLead(leadId) {
  const { rows } = await pool.query(
    `SELECT id, status, sent_at, first_opened_at, open_count, accepted_at, created_at FROM proposals
      WHERE lead_id = $1 ORDER BY created_at DESC`, [leadId]);
  return rows;
}

// What the public page (and the in-app preview) renders. Proof ids resolve
// to the items themselves; internal fields (reasons, alerts, email) never
// leave the building.
async function publicPayload(p) {
  const m = p.matched || {};
  const ids = [m.case_study, m.testimonial, m.press, ...(m.credentials || [])].filter(Boolean);
  const { rows: items } = ids.length
    ? await pool.query('SELECT id, kind, title, body, attribution, url, image_url FROM proof_items WHERE id = ANY($1::uuid[])', [ids])
    : { rows: [] };
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  return {
    status: p.status,
    recipient_names: p.recipient_names,
    content: p.content,
    proof: {
      case_study: byId[m.case_study] || null,
      testimonial: byId[m.testimonial] || null,
      press: byId[m.press] || null,
      credentials: (m.credentials || []).map(id => byId[id]).filter(Boolean),
    },
    packages: [PACKAGES.advanced, PACKAGES.basic],
    method: METHOD,
    accepted: !!p.accepted_at,
    accepted_package: p.accepted_package || null,
    book_url: BOOK_URL(),
    contact_email: process.env.PIPELINE_CONTACT_EMAIL || 'hello@octobercomms.com',
    terms_url: process.env.PIPELINE_TERMS_URL || 'https://octobercomms.com/terms-and-conditions/',
  };
}

async function getByToken(token) {
  if (!token || token.length < 10) return null;
  const { rows } = await pool.query('SELECT id FROM proposals WHERE token = $1', [token]);
  return rows.length ? getProposal(rows[0].id) : null;
}

// ─── Send ───────────────────────────────────────────────────────────────────
async function send(id, { subject, note } = {}) {
  const p = await getProposal(id);
  if (!p) throw new Error('Proposal not found');
  if (!p.recipient_email) throw new Error('Add the recipient email first');
  if (!['draft', 'sent'].includes(p.status)) throw new Error(`Already ${p.status}; nothing to send`);
  const first = String(p.recipient_names || '').trim();
  const body = note || p.content.email_note || 'Thanks for the time today. Here is the proposal we talked through.';
  await email.sendProposal({
    to: p.recipient_email,
    subject: subject || p.content.email_subject || `${p.company_name || 'Your'} proposal from October`,
    note: first ? `Hello ${first},\n\n${body}` : body,
    link: p.link,
  });
  await pool.query(
    `UPDATE proposals SET status = 'sent', approved_at = COALESCE(approved_at, NOW()), sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = $1`, [id]);
  await pool.query(`UPDATE snapshot_leads SET status = 'proposal' WHERE id = $1 AND status NOT IN ('won')`, [p.lead_id]);
  return getProposal(id);
}

// ─── Stage 5: tracking (public, token-gated) ────────────────────────────────
const MAX_PING_SECONDS = 30;   // a heartbeat can't claim more than this per section

async function recordOpen(token, sessionKey, userAgent) {
  const p = await getByToken(token);
  if (!p) return null;
  if (!['sent', 'viewed', 'replied', 'accepted'].includes(p.status)) return p;   // drafts don't track
  const key = String(sessionKey || '').slice(0, 64);
  if (!key) return p;
  const ins = await pool.query(
    `INSERT INTO proposal_views (proposal_id, session_key, user_agent) VALUES ($1, $2, $3)
       ON CONFLICT (proposal_id, session_key) DO NOTHING RETURNING id`,
    [p.id, key, String(userAgent || '').slice(0, 300)]);
  if (!ins.rowCount) return p;   // same tab reloading
  const { rows } = await pool.query(
    `UPDATE proposals SET open_count = open_count + 1, last_opened_at = NOW(),
       first_opened_at = COALESCE(first_opened_at, NOW()),
       status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
     WHERE id = $1 RETURNING (open_count = 1) AS first`, [p.id]);
  if (rows[0]?.first) {
    // The brief's data point: 42.5% of wins land within 24h of the first
    // open. So Daniel hears about the open now, not at the 24h alert.
    email.sendPipelineAlert({
      subject: `Opened: ${p.company_name || 'proposal'}`,
      headline: `${p.recipient_names || p.company_name || 'The prospect'} just opened the proposal.`,
      lines: [`Sent ${relative(p.sent_at)}.`, 'You will get a note on what they read if there is no reply in 24 hours.'],
      suggestion: 'No chase yet. If you were going to call them today anyway, this is the window.',
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    }).catch(e => console.warn('[proposals] open alert failed:', e.message));
  }
  return p;
}

async function recordPing(token, sessionKey, sections) {
  const { rows } = await pool.query('SELECT id FROM proposals WHERE token = $1', [token]);
  if (!rows.length) return false;
  const clean = {};
  for (const k of SECTION_KEYS) {
    const v = Math.round(Number(sections?.[k] || 0));
    if (v > 0) clean[k] = Math.min(v, MAX_PING_SECONDS);
  }
  if (!Object.keys(clean).length) return true;
  // Add each delta into the JSONB counters in one statement.
  await pool.query(
    `UPDATE proposal_views v SET last_ping_at = NOW(),
       sections = (SELECT jsonb_object_agg(k, COALESCE((v.sections->>k)::int, 0) + COALESCE((d.delta->>k)::int, 0))
                     FROM (SELECT $3::jsonb AS delta) d,
                          LATERAL (SELECT jsonb_object_keys(v.sections || d.delta) AS k) keys)
     WHERE v.proposal_id = $1 AND v.session_key = $2`,
    [rows[0].id, String(sessionKey || '').slice(0, 64), JSON.stringify(clean)]);
  return true;
}

// Stage 7: one step. Terms agreed on the page, then straight to the
// GoCardless mandate for the chosen package.
function gocardlessUrl(pkg) {
  return process.env[`GOCARDLESS_URL_${pkg.toUpperCase()}`] || process.env.GOCARDLESS_URL || null;
}

async function accept(token, { name, pkg, agreed }) {
  const p = await getByToken(token);
  if (!p) return null;
  if (!agreed) throw new Error('Please tick to agree the terms.');
  if (!PACKAGES[pkg]) throw new Error('Choose a package.');
  const who = String(name || '').trim().slice(0, 120);
  if (!who) throw new Error('Add your name.');
  if (!p.accepted_at) {
    await pool.query(
      `UPDATE proposals SET status = 'accepted', accepted_at = NOW(), accepted_name = $2, accepted_package = $3, updated_at = NOW() WHERE id = $1`,
      [p.id, who, pkg]);
    await pool.query(`UPDATE snapshot_leads SET status = 'won' WHERE id = $1`, [p.lead_id]);
    email.sendPipelineAlert({
      subject: `Accepted: ${p.company_name || 'proposal'} (${PACKAGES[pkg].name})`,
      headline: `${who} accepted the ${PACKAGES[pkg].name} package for ${p.company_name || 'the prospect'}.`,
      lines: [`Redirected to GoCardless to set up the mandate${gocardlessUrl(pkg) ? '' : ' (no GoCardless link configured, follow up by hand)'}.`],
      suggestion: 'Send the welcome note and book the audit kick-off.',
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    }).catch(() => {});
  }
  return { next_url: gocardlessUrl(pkg) };
}

// ─── Stage 6: decay alerts ──────────────────────────────────────────────────
function relative(d) {
  if (!d) return 'unknown';
  const h = (Date.now() - new Date(d).getTime()) / 3600000;
  if (h < 1) return 'under an hour ago';
  if (h < 36) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

const SECTION_LABEL = {
  cover: 'the cover', letter: 'the letter', situation: 'the situation', plan: 'the plan',
  method: 'how it works', proof: 'the proof', pricing: 'pricing', next: 'the sign-up step',
};

// The talking point comes from where they spent time, not from a template
// chase. Deterministic on purpose: fast, free, and easy to trust.
function suggestFromDwell(eng, p) {
  const s = eng.sections || {};
  const top = Object.entries(s).filter(([k]) => k !== 'cover').sort((a, b) => b[1] - a[1]);
  const name = String(p.recipient_names || '').split(/,| and /)[0].trim() || 'them';
  if (!top.length) return `They opened it but barely scrolled. Send a two-line note to ${name} offering a 10-minute walkthrough of the plan on Meet.`;
  const [k, secs] = top[0];
  const lead = {
    pricing: `Most of their time went on pricing (${secs}s). Price is the live question. Call ${name} and walk through what changes between Basic and Advanced in month one, and which one you would pick in their shoes.`,
    proof: `They read the proof closely (${secs}s). Offer a reference call with a current client in their sector; it is the fastest way through a trust question.`,
    situation: `They spent longest on the situation (${secs}s). The diagnosis landed. Ask ${name} which point hit hardest and build the start date around it.`,
    plan: `They read the plan (${secs}s). They are thinking about delivery. Propose a start date and what they get in the first 30 days.`,
    method: `They dwelt on how it works (${secs}s). Explain the audit in plain terms and what they will have in hand at the end of month one.`,
    letter: `They read the letter and stopped (${secs}s on it). Re-anchor on what they told you they want, in one line, and ask if the proposal matches it.`,
    next: `They reached the sign-up step (${secs}s) but did not finish. Something is blocking. Ask ${name} directly what is left to decide.`,
  }[k];
  const second = top[1] ? ` Second most read: ${SECTION_LABEL[top[1][0]]} (${top[1][1]}s).` : '';
  return lead + second;
}

// One failed alert email must not stop the rest; it stays unstamped and is
// retried on the next 15-minute run.
async function safely(id, fn) {
  try { await fn(); } catch (e) { console.warn(`[proposals] alert for ${id} failed: ${e.message}`); }
}

async function runDecayAlerts() {
  const unopenedH = hours('PIPELINE_ALERT_UNOPENED_HOURS', 24);
  const openedH = hours('PIPELINE_ALERT_OPENED_HOURS', 24);
  let sent = 0;

  // Alert 1: sent, never opened.
  const { rows: unopened } = await pool.query(
    `SELECT id FROM proposals WHERE status = 'sent' AND first_opened_at IS NULL AND alert_unopened_at IS NULL
       AND sent_at < NOW() - make_interval(secs => $1)`, [unopenedH * 3600]);
  for (const r of unopened) await safely(r.id, async () => {
    const p = await getProposal(r.id);
    const name = String(p.recipient_names || '').split(/,| and /)[0].trim();
    await email.sendPipelineAlert({
      subject: `Unopened after ${unopenedH}h: ${p.company_name}`,
      headline: `${p.company_name} hasn't opened the proposal.`,
      lines: [`Sent ${relative(p.sent_at)} to ${p.recipient_email}.`, 'Could be spam filtering, a busy week, or the wrong inbox.'],
      suggestion: `Short check-in, from your own inbox, not a template:\n"Hi ${name || 'there'}, sent the proposal over ${relative(p.sent_at).replace(' ago', '')} back. Wanted to check it reached you and didn't land in spam. Happy to walk through it on a quick call if easier."`,
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    });
    await pool.query('UPDATE proposals SET alert_unopened_at = NOW() WHERE id = $1', [r.id]);
    sent++;
  });

  // Alert 2: opened, no reply within the window. The critical one.
  const { rows: opened } = await pool.query(
    `SELECT id FROM proposals WHERE status = 'viewed' AND alert_opened_at IS NULL
       AND first_opened_at < NOW() - make_interval(secs => $1)`, [openedH * 3600]);
  for (const r of opened) await safely(r.id, async () => {
    const p = await getProposal(r.id);
    const e = p.engagement;
    await email.sendPipelineAlert({
      subject: `Opened, no reply: ${p.company_name}`,
      headline: `${p.company_name} opened the proposal ${relative(p.first_opened_at)} and hasn't replied.`,
      lines: [`${e.sessions} viewing session${e.sessions === 1 ? '' : 's'}, ${Math.round(e.seconds / 60)} min total.`,
        ...Object.entries(e.sections).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${SECTION_LABEL[k] || k}: ${v}s`)],
      suggestion: suggestFromDwell(e, p),
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    });
    await pool.query('UPDATE proposals SET alert_opened_at = NOW() WHERE id = $1', [r.id]);
    sent++;
  });

  // Alert 3: cooling. Returned on several days, still no reply. They are
  // interested but stuck; another email won't unstick them.
  const { rows: cooling } = await pool.query(
    `SELECT p.id FROM proposals p
      WHERE p.status = 'viewed' AND p.alert_cooling_at IS NULL AND p.open_count >= 3
        AND (SELECT COUNT(DISTINCT (v.started_at AT TIME ZONE 'Europe/London')::date) FROM proposal_views v WHERE v.proposal_id = p.id) >= 2`);
  for (const r of cooling) await safely(r.id, async () => {
    const p = await getProposal(r.id);
    const e = p.engagement;
    await email.sendPipelineAlert({
      subject: `Cooling: ${p.company_name} keeps coming back`,
      headline: `${p.company_name} has opened the proposal ${p.open_count} times across ${e.distinct_days} days with no reply.`,
      lines: ['Repeat visits without a reply usually mean someone else has to agree, or one question is unanswered.'],
      suggestion: `Change the channel: phone ${String(p.recipient_names || 'them').split(/,| and /)[0].trim()} rather than emailing. Ask who else needs to see it and offer a 15-minute Meet with them. ${suggestFromDwell(e, p)}`,
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    });
    await pool.query('UPDATE proposals SET alert_cooling_at = NOW() WHERE id = $1', [r.id]);
    sent++;
  });
  return { sent };
}

// ─── Stage 2: the one nudge ─────────────────────────────────────────────────
// Report unlocked, no call booked after 48h → one short email from Daniel.
// The 7-day ceiling stops a deploy from nudging the whole historic backlog.
async function runReportNudges() {
  if (process.env.PIPELINE_NUDGE === '0') return { sent: 0 };
  const afterH = hours('PIPELINE_NUDGE_HOURS', 48);
  const { rows } = await pool.query(
    `SELECT l.* FROM snapshot_leads l
      WHERE l.source = 'public' AND l.email IS NOT NULL AND l.nudge_sent_at IS NULL
        AND l.call_booked_at IS NULL AND l.status NOT IN ('booked','proposal','won','archived')
        AND l.email_requested_at < NOW() - make_interval(secs => $1)
        AND l.email_requested_at > NOW() - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id = l.id)
      LIMIT 20`, [afterH * 3600]);
  let sent = 0;
  for (const l of rows) {
    // Stamp first so a mail failure can never turn into a repeat send.
    const { rowCount } = await pool.query(
      'UPDATE snapshot_leads SET nudge_sent_at = NOW() WHERE id = $1 AND nudge_sent_at IS NULL', [l.id]);
    if (!rowCount) continue;
    const d = l.draft || {};
    try {
      await email.sendReportNudge({
        to: l.email, name: l.contact_name, company: l.company_name,
        bookUrl: BOOK_URL(), finding: d.headline_opportunity || null,
      });
      sent++;
    } catch (e) { console.warn(`[proposals] nudge to ${l.email} failed: ${e.message}`); }
  }
  return { sent };
}

module.exports = {
  PACKAGES, METHOD, SECTION_KEYS,
  listProof, saveProof, deleteProof, rankProof, matchProof,
  callBrief, markCallBooked,
  generate, refine, update, remove, send,
  getProposal, listProposals, listForLead, publicPayload, getByToken,
  recordOpen, recordPing, accept,
  runDecayAlerts, runReportNudges, suggestFromDwell, scrubDashes,
};
