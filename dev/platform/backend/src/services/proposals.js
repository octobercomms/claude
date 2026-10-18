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
const methods = require('./proposalMethods');

const PLATFORM_URL = () => (process.env.PLATFORM_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');
const BOOK_URL = () => process.env.SNAPSHOT_BOOK_URL || 'https://octobercomms.com/book/';
const hours = (envKey, dflt) => {
  const n = parseFloat(process.env[envKey]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// The offer itself now lives in proposal_methods (see services/proposalMethods.js
// and migration 205), because Daniel sells two methods at three price points in
// three currencies and needs to add and rename them without a deploy.

// SOST, in that order, with the method between strategy and tactics: strategy is
// the thinking, the method is the machine, tactics is what lands in their diary.
// Each key is a tracked block on the public page, so splitting the old single
// "plan" section into its four steps is also what makes dwell data useful: "they
// spent four minutes on tactics" is actionable where "they read the plan" is not.
const SECTION_KEYS = ['cover', 'letter', 'situation', 'objectives', 'strategy',
  'method', 'tactics', 'proof', 'availability', 'pricing', 'next'];

// ─── Proof library + matching ───────────────────────────────────────────────
async function listProof({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM proof_items ${includeInactive ? '' : 'WHERE active'} ORDER BY kind, title`
  );
  return rows;
}

const tagList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 20);

// `figure` and `source` are what make a credential read as a fact rather than
// as marketing: "22" over "countries where client work has been published",
// with "October's editorial log, March 2023 to April 2026" under it. A figure
// without a source is a claim, so the two travel together.
async function saveProof(id, f) {
  const figure = String(f.figure ?? '').trim().slice(0, 16) || null;
  const source = String(f.source ?? '').trim().slice(0, 300) || null;
  const vals = [f.kind, f.title, f.body, f.attribution || null, tagList(f.sector_tags), tagList(f.problem_tags),
    f.url || null, f.image_url || null, f.active !== false, figure, source];
  if (!['case_study', 'testimonial', 'credential', 'press'].includes(f.kind)) throw new Error('kind must be case_study, testimonial, credential or press');
  if (!String(f.title || '').trim() || !String(f.body || '').trim()) throw new Error('title and body are required');
  if (figure && !source) throw new Error('A figure needs its source, or it reads as a claim rather than a fact.');
  if (id) {
    const { rows } = await pool.query(
      `UPDATE proof_items SET kind=$1, title=$2, body=$3, attribution=$4, sector_tags=$5, problem_tags=$6,
         url=$7, image_url=$8, active=$9, figure=$10, source=$11 WHERE id=$12 RETURNING *`, [...vals, id]);
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO proof_items (kind, title, body, attribution, sector_tags, problem_tags, url, image_url, active, figure, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, vals);
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

// `policy` comes from the selected method. Under 'no_outcome_claims' the case
// study is withheld: October's record, its testimonials and its published
// coverage are all true of October and stay, but a case study describes a
// result a client got, and attaching one to a method no client has run yet
// implies that method produced it.
//
// This has to be enforced here rather than trusted to the prompt, because
// ranking's whole job is to surface the most persuasive item available and a
// case study from a different service scores well on sector overlap alone.
function matchProof(items, sectorTags, problemTags, policy = 'full') {
  const ranked = rankProof(items, sectorTags, problemTags);
  const of = (k) => ranked.filter(r => r.kind === k);
  const pick = (k, n) => of(k).slice(0, n);
  const noOutcomes = policy === 'no_outcome_claims';
  const chosen = {
    case_study: noOutcomes ? null : (pick('case_study', 1)[0]?.id || null),
    testimonial: pick('testimonial', 1)[0]?.id || null,
    // Under the stricter policy the counted record carries the proof block on
    // its own, so it gets the room the case study would have taken.
    credentials: pick('credential', noOutcomes ? 4 : 2).map(r => r.id),
    press: pick('press', 1)[0]?.id || null,
    evidence_policy: policy,
    ...(noOutcomes ? { withheld_case_study: pick('case_study', 1)[0]?.id || null } : {}),
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

// ── Pass one: read the notes ────────────────────────────────────────────────
// Runs on the cheapest model over whatever Daniel pasted, which may be two
// sentences or a whole 45-minute transcript. Two reasons this is a separate
// call rather than part of the writing prompt:
//
//  1. A transcript holds things that must never reach the proposal: a price
//     objection, what they said about their last agency, an aside about
//     someone's health. Extracting first means Daniel sees every fact before a
//     word is written, instead of finding a paraphrase of one in a document the
//     prospect can forward.
//  2. Re-drafting then costs only the writing pass, because the transcript is
//     read once and stored, not re-sent on every press of the button.
//
// The "missing" list is the most valuable field here. Four blocks now carry the
// whole weight of "he understood us", so the engine saying what it does not
// know beats the five it would fill confidently.
const EXTRACT_SYSTEM = `You read a London marketing agency founder's notes from a sales call with a prospective client, or a raw transcript of that call, and pull out only what is stated. The agency is October Communications; it works with architects, designers and design-led brands.

Rules:
- Extract only what is actually in the input. Never infer, never fill a gap with something plausible, never carry over knowledge about the industry.
- Quote or closely paraphrase their own words where they said something sharp.
- If the input does not cover one of the fields, leave it empty and name it in "missing". An empty field is useful; an invented one is not.
- Leave out anything said in confidence that has no place in a proposal: price objections, opinions about other agencies or people, personal or health matters, internal politics. Put the count of things you left out in "withheld" so the founder knows the pass happened.

Return ONLY a JSON object, no prose, no code fences:
{
  "going_wrong": [string],          // what they said is not working, in their terms. 0-4 items.
  "proudest_work": [string],        // projects they are proud of, with any detail given (planning battles, awards, what the client said). 0-4 items.
  "already_tried": [string],        // marketing they have already done and how it went. 0-4 items.
  "trigger": string,                // the deadline, completion or event making this live now. "" if not stated.
  "decision": string,               // who signs it off and what each person needs to see. "" if not stated.
  "target_work": string,            // the kind or value of project they want more of. "" if not stated.
  "quotes": [string],               // 0-3 verbatim lines worth keeping, each under 200 characters.
  "missing": [string],              // plainly named gaps, e.g. "budget", "who owns marketing internally", "timeline".
  "withheld": number                // how many items you left out as having no place in a proposal.
}`;

// ── Pass two: write the four blocks that are theirs ─────────────────────────
// Everything else (objectives, KPIs, strategy, tactics, the method stages,
// pricing) comes from the selected method. That is deliberate: a defined method
// that reads identically every time is a product, where a plan rewritten per
// prospect reads as bespoke consulting and gets compared on price. It also stops
// the model inventing KPIs in a document that becomes a contract on acceptance.
const PROPOSAL_SYSTEM = `You write the personal sections of a sales proposal for October Communications, a London marketing and PR agency for architects, designers and design-led brands. Daniel Nelson is the founder and the proposal goes out in his name.

You are NOT writing the plan. The objectives, KPIs, strategy, tactics and pricing are fixed by the method Daniel has already chosen, and are given to you below for context only so your writing points towards them without repeating them. Your job is the four things that are about this prospect and nobody else.

The proposal must read like Daniel wrote it after a proper conversation. The benchmark is this passage from a proposal that won:
"The homepage rotates six lead projects; four of six sit in East or North London. Well Walk and Newton Park Place, the two that would evidence higher-bracket capability, get the same grid treatment and the same generic caption as the rest, so nothing tells a Chelsea prospect that ROAR handles a different scale of project."
Notice: named specifics, a counted observation, the commercial consequence. That is the standard for the situation section. The diagnosis should reframe the problem ("That's a storytelling and positioning problem, not a press problem.").

The letter is about them and the call. The situation is the diagnosis. Do not let the letter start diagnosing, or the two read as the same block twice.

${VOICE}

Return ONLY a JSON object, no prose, no code fences:
{
  "sector_tags": [string],          // 1-3 lowercase tags from: architecture, interiors, residential, commercial, furniture, design, retail, homeware, hospitality, property, construction, culture, events, fashion, lighting
  "problem_tags": [string],         // 2-4 lowercase tags from: press, search, ai, social, content, positioning, leads, ecommerce, paid, trust
  "letter": [string],               // 2-3 short paragraphs. Para 1 restates what they told us they want, in their terms. Para 2 names the real problem in one line and how this proposal closes it. No greeting line, no sign-off.
  "situation": [string],            // 3-5 paragraphs. Evidence-led diagnosis of where they stand, using the site text, snapshot findings and the extracted call facts.
  "priority": { "title": string, "text": string },   // THE first-quarter priority the audit is expected to confirm. One lever, argued from their evidence. It must be something the method's tactics below actually deliver.
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

// The document's own fields: what the four written blocks are wrapped in. The
// method's content is NOT merged in here. It stays on method_snapshot, so a
// manual edit to one block can never overwrite the offer, and so improving a
// method later never rewrites a proposal that has already been signed.
function assemble(draft, lead, extras = {}) {
  return {
    ...draft,
    company_name: extras.company_name || lead.company_name || '',
    cover_image: extras.cover_image !== undefined ? extras.cover_image : coverImage(lead),
    date_label: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    currency: extras.symbol || '£',
  };
}

// Pass one. Cheap, and its result is stored, so a re-draft never re-reads the
// transcript. A failure here is not fatal: the writing pass can work from the
// raw notes, it just loses the review step and the gap list, so the caller is
// told which happened.
async function extractFacts(input) {
  const body = String(input || '').trim();
  if (!body) return null;
  const user = `Notes or transcript from the call:\n"""\n${body.slice(0, 120000)}\n"""\n\nReturn the extraction JSON.`;
  try {
    const raw = await claude.callClaude({
      max_tokens: 1200, system: EXTRACT_SYSTEM, user, feature: 'pipeline_proposal_extract',
    });
    const out = scrubDashes(parseJson(raw));
    out.extracted_at = new Date().toISOString();
    out.input_chars = body.length;
    return out;
  } catch (e) {
    console.warn(`[proposals] extraction failed, falling back to raw notes: ${e.message}`);
    return { failed: true, error: e.message, input_chars: body.length };
  }
}

// What pass two is given in place of the raw transcript.
function factsBlock(x) {
  if (!x || x.failed) return null;
  const list = (label, arr) => (arr?.length ? `${label}:\n${arr.map(i => `- ${i}`).join('\n')}` : null);
  const line = (label, v) => (v ? `${label}: ${v}` : null);
  return [
    list('What they said is going wrong', x.going_wrong),
    list('Work they are proud of', x.proudest_work),
    list('What they have already tried', x.already_tried),
    line('What is making this live now', x.trigger),
    line('Who decides', x.decision),
    line('The work they want more of', x.target_work),
    list('Their own words', x.quotes),
    x.missing?.length ? `Not established on the call (do not invent these): ${x.missing.join(', ')}` : null,
  ].filter(Boolean).join('\n\n');
}

// Context for the writing pass: what the method commits to, so the letter,
// situation and priority point at it rather than promising something else.
function methodBlock(snap) {
  if (!snap) return '(no method selected)';
  const bits = [`Method: ${snap.name}${snap.family ? ` (${snap.family})` : ''}`];
  const o = snap.objectives || {};
  if (o.short || o.mid || o.long) {
    bits.push(`Objectives: 0-3 months, ${o.short || '—'}; 3-9 months, ${o.mid || '—'}; 9-18 months, ${o.long || '—'}`);
  }
  if (snap.kpis?.committed?.length) bits.push(`Committed to: ${snap.kpis.committed.join('; ')}`);
  if (snap.kpis?.reported?.length) bits.push(`Reported on: ${snap.kpis.reported.join('; ')}`);
  if (snap.strategy?.length) bits.push(`Strategy: ${snap.strategy.map(s => s.title).join('; ')}`);
  if (snap.tactics?.length) {
    bits.push(`Tactics it delivers:\n${snap.tactics.map(t => `- ${t.heading}: ${(t.items || []).join('; ')}`).join('\n')}`);
  }
  if (snap.scarcity) bits.push(`Availability: ${snap.scarcity}`);
  if (snap.evidence_policy === 'no_outcome_claims') {
    bits.push([
      'EVIDENCE RULE for this method, which overrides persuasiveness:',
      'This is a new service and no client has run it yet. You may say what October has done,',
      'because its published record is true of October. You may NOT state or imply a result this',
      'method has produced: no "practices using this see", no percentages, no before-and-after,',
      'no invented numbers, and no hypothetical result written as though it happened. Where you',
      'would reach for a result, say plainly that the service is new and name what will be',
      'measured instead. Daniel has decided this, and a proposal that breaks it is worse than one',
      'that persuades less.',
    ].join(' '));
  }
  return bits.join('\n');
}

async function generate(leadId, { recipientNames, recipientEmail, callNotes, angle,
  methodId, currency, extraction: given } = {}) {
  const lead = await studio.getLead(leadId);
  if (!lead) throw new Error('Lead not found');
  if (callNotes !== undefined) {
    await pool.query('UPDATE snapshot_leads SET call_notes = $1 WHERE id = $2', [callNotes || null, leadId]);
    lead.call_notes = callNotes;
  }

  // The method is the offer. Without one there is no price, no tactics and no
  // mandate link, so this is a hard stop rather than a silent default.
  const chosen = methodId
    ? await methods.getMethod(methodId)
    : (await methods.listMethods())[0];
  if (!chosen) throw new Error('Pick a method first. Add one in Settings → Proposals.');
  const snap = methods.snapshot(chosen, currency);

  const input = lead.call_notes || lead.notes || '';
  // Reuse an extraction the draft screen already ran and Daniel has reviewed;
  // only read the notes again when there is none.
  const facts = given && typeof given === 'object' ? given : await extractFacts(input);
  const known = factsBlock(facts);

  const text = await siteText(lead);
  const names = recipientNames || lead.contact_name || '';
  const user = `Prospect company: ${lead.company_name || lead.url}
Website: ${lead.url}
Addressed to: ${names || 'the team'}
How they found us: ${lead.referral_source || 'unknown'}
Daniel's angle for this one: ${angle || '(none given, find it from the evidence)'}

THE METHOD DANIEL HAS CHOSEN (fixed; context only, do not restate it):
${methodBlock(snap)}

WHAT THEY SAID ON THE CALL (already read and checked; this is your record of it):
"""
${known || input.slice(0, 6000) || '(nothing from the call, lean on the site and snapshot)'}
"""

SNAPSHOT FINDINGS (from October's visibility snapshot):
${snapshotBlock(lead)}

SITE TEXT (several pages, each marked with its URL):
"""
${text || '(site could not be read)'}
"""

Write the four blocks as JSON for ${lead.company_name || 'this prospect'}.`;

  const raw = await claude.callClaude({ max_tokens: 2000, system: PROPOSAL_SYSTEM, user, feature: 'pipeline_proposal' });
  const draft = scrubDashes(parseJson(raw));

  const proof = await listProof();
  const matched = matchProof(proof, draft.sector_tags, draft.problem_tags, snap.evidence_policy);
  const content = assemble(draft, lead, { symbol: snap.symbol });

  const token = crypto.randomBytes(18).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO proposals (lead_id, token, recipient_email, recipient_names, content, matched,
                            method_id, method_snapshot, currency, call_input, extraction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [leadId, token, recipientEmail || lead.email || null, names || null,
      JSON.stringify(content), JSON.stringify(matched),
      chosen.id, JSON.stringify(snap), snap.currency, input || null,
      facts ? JSON.stringify(facts) : null]);
  return getProposal(rows[0].id);
}

// A refine only ever rewrites the written blocks. The method's content is not
// in `content`, so there is nothing here that could quietly reprice a proposal
// or change what it commits to.
async function refine(id, message) {
  const p = await getProposal(id);
  if (!p) throw new Error('Proposal not found');
  const user = `The four written blocks as they stand:
${JSON.stringify({ letter: p.content.letter, situation: p.content.situation, priority: p.content.priority,
    email_subject: p.content.email_subject, email_note: p.content.email_note })}

THE METHOD THIS PROPOSAL SELLS (fixed; you cannot change it):
${methodBlock(p.method_snapshot)}

${factsBlock(p.extraction) ? `WHAT THEY SAID ON THE CALL:\n"""\n${factsBlock(p.extraction)}\n"""\n` : ''}
Daniel says: "${message}"

Return the FULL updated JSON in the same schema, including sector_tags and problem_tags. Apply the change, keep everything else intact, keep the voice rules.`;
  const raw = await claude.callClaude({ max_tokens: 2000, system: PROPOSAL_SYSTEM, user, feature: 'pipeline_proposal' });
  const next = { ...p.content, ...scrubDashes(parseJson(raw)) };
  await pool.query('UPDATE proposals SET content = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(next), id]);
  return getProposal(id);
}

// Swap the method or the currency on a draft, without rewriting a word of the
// prospect's blocks. This is the normal way a proposal gets priced: Daniel
// picks the level from the call, and changing his mind must not cost a redraft.
async function setMethod(id, { methodId, currency } = {}) {
  const p = await getProposal(id);
  if (!p) throw new Error('Proposal not found');
  if (p.accepted_at) throw new Error('This proposal has been accepted; the price it was signed at cannot change.');
  const chosen = methodId ? await methods.getMethod(methodId) : await methods.getMethod(p.method_id);
  if (!chosen) throw new Error('Method not found');
  const snap = methods.snapshot(chosen, currency || p.currency);
  const content = { ...p.content, currency: snap.symbol };
  await pool.query(
    `UPDATE proposals SET method_id = $1, method_snapshot = $2, currency = $3, content = $4, updated_at = NOW()
      WHERE id = $5`,
    [chosen.id, JSON.stringify(snap), snap.currency, JSON.stringify(content), id]);
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
    ? await pool.query('SELECT id, kind, title, body, attribution, url, image_url, figure, source FROM proof_items WHERE id = ANY($1::uuid[])', [ids])
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
    // One method, priced, as Daniel chose it after the call. There is no menu
    // and no radio button: the proposal states the answer. A prospect choosing
    // their own level turns the price into a comparison, which is the opposite
    // of what a recommendation does.
    offer: p.method_snapshot || null,
    // Why the proof block looks as it does. Under 'no_outcome_claims' there is
    // no case study on purpose, and the document says so rather than leaving a
    // gap that reads as nothing to show.
    evidence_policy: p.method_snapshot?.evidence_policy || 'full',
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

// Stage 7: one step. Terms agreed on the page, then straight to the GoCardless
// mandate. There is nothing to choose here any more, so there is nothing to get
// wrong: the proposal carries one priced method and acceptance accepts it.
async function accept(token, { name, agreed }) {
  const p = await getByToken(token);
  if (!p) return null;
  if (!agreed) throw new Error('Please tick to agree the terms.');
  const snap = p.method_snapshot;
  if (!snap) throw new Error('This proposal has no package on it. Please reply to the email and Daniel will sort it.');
  const who = String(name || '').trim().slice(0, 120);
  if (!who) throw new Error('Add your name.');
  const method = p.method_id ? await methods.getMethod(p.method_id) : null;
  const next = methods.gocardlessUrl(snap, method);
  if (!p.accepted_at) {
    await pool.query(
      `UPDATE proposals SET status = 'accepted', accepted_at = NOW(), accepted_name = $2, accepted_package = $3, updated_at = NOW() WHERE id = $1`,
      [p.id, who, snap.slug]);
    await pool.query(`UPDATE snapshot_leads SET status = 'won' WHERE id = $1`, [p.lead_id]);
    const price = snap.monthly != null ? `${snap.symbol}${Number(snap.monthly).toLocaleString('en-GB')}/month` : 'price not set';
    email.sendPipelineAlert({
      subject: `Accepted: ${p.company_name || 'proposal'} (${snap.name})`,
      headline: `${who} accepted ${snap.name} at ${price} for ${p.company_name || 'the prospect'}.`,
      lines: [next
        ? 'Redirected to GoCardless to set up the mandate.'
        : `No GoCardless link for ${snap.name} in ${snap.currency}, so they were not redirected. Send them the mandate link by hand today.`],
      suggestion: 'Send the welcome note and book the audit kick-off.',
      link: `${PLATFORM_URL()}/proposals/${p.id}`,
    }).catch(() => {});
  }
  return { next_url: next };
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
  cover: 'the cover', letter: 'the letter', situation: 'the situation',
  objectives: 'the objectives', strategy: 'the strategy', method: 'how it works',
  tactics: 'the tactics', proof: 'the proof', availability: 'places',
  pricing: 'pricing', next: 'the sign-up step',
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
    pricing: `Most of their time went on pricing (${secs}s). Price is the live question. Call ${name}, say plainly why you put them on this level, and ask what number they had in mind.`,
    proof: `They read the proof closely (${secs}s). Offer a reference call with a current client in their sector; it is the fastest way through a trust question.`,
    situation: `They spent longest on the situation (${secs}s). The diagnosis landed. Ask ${name} which point hit hardest and build the start date around it.`,
    objectives: `They spent longest on the objectives (${secs}s). They are picturing the end state. Ask which of the three horizons matters most to them and why.`,
    strategy: `They read the strategy (${secs}s). They are weighing the approach rather than the price. Offer to walk through it on a call.`,
    method: `They dwelt on how it works (${secs}s). Explain the audit in plain terms and what they will have in hand at the end of month one.`,
    tactics: `They read the tactics closely (${secs}s). They are thinking about delivery and probably about their own time. Say who does what and how much of theirs it takes.`,
    letter: `They read the letter and stopped (${secs}s on it). Re-anchor on what they told you they want, in one line, and ask if the proposal matches it.`,
    availability: `They sat on the places section (${secs}s). They are weighing whether to commit now or wait, which means the cap is doing its work. Call ${name} and say plainly how many places are left.`,
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
  SECTION_KEYS,
  listProof, saveProof, deleteProof, rankProof, matchProof,
  callBrief, markCallBooked,
  generate, refine, update, remove, send, setMethod,
  extractFacts, factsBlock, methodBlock,
  getProposal, listProposals, listForLead, publicPayload, getByToken,
  recordOpen, recordPing, accept,
  runDecayAlerts, runReportNudges, suggestFromDwell, scrubDashes,
};
