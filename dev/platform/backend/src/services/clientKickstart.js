// Admin Quick Start — one click fills as much client setup as possible from the
// data OMI already has, so the AM edits a draft instead of staring at blank
// fields. Data-first, AI fills the gaps:
//   - About this client (briefing) — drafted from the website, if empty
//   - Monthly focus — drafted, if empty
//   - Competitors — suggested from domain + brief and saved, if none set
//   - Starter keywords — proposed (NOT auto-tracked — that would spend rank
//     credit; the AM adds the ones they want)
//
// Only ever fills EMPTY sections — never overwrites the AM's work. Each piece
// degrades independently, so one failure doesn't sink the run.

const pool = require('../db');
const claudeService = require('./claude');
const competitorSuggest = require('./competitorSuggest');

async function proposeKeywords(client) {
  const raw = await claudeService.callClaude({
    max_tokens: 800,
    system: 'You are an SEO strategist proposing starter target keywords for a business to track. British English. Return ONE JSON object and nothing else: { "keywords": ["...", ...] }. 8–12 realistic search phrases a customer would actually type, mixing category terms and buyer-intent terms. Lowercase, no quotes, no question marks. Skip the brand\'s own name.',
    user: `Client: ${client.name}\nWebsite: ${client.domain || '(none set)'}\nBrief: ${client.briefing_field || '(infer from the name and domain)'}\n\nReturn the JSON object only.`,
    feature: 'client_kickstart',
    clientId: client.id,
  });
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const p = JSON.parse(cleaned);
    return Array.isArray(p.keywords) ? p.keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 12) : [];
  } catch { return []; }
}

async function kickstart(clientId) {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) throw new Error('Client not found');
  const client = rows[0];
  const hasDomain = !!String(client.domain || '').trim();

  const briefEmpty = !String(client.briefing_field || '').trim();
  const focusEmpty = !String(client.monthly_focus || '').trim();
  const compEmpty = !(Array.isArray(client.competitor_domains) && client.competitor_domains.length);

  // Independent AI drafts, in parallel — settle so one failure doesn't sink it.
  const [briefR, focusR, compR, kwR] = await Promise.allSettled([
    (briefEmpty && hasDomain)
      ? claudeService.researchBriefing({ clientName: client.name, domain: client.domain, existingBriefing: null })
      : Promise.resolve(null),
    focusEmpty ? claudeService.suggestMonthlyFocus({ client }) : Promise.resolve(null),
    compEmpty ? competitorSuggest.suggestCompetitors(clientId) : Promise.resolve(null),
    proposeKeywords(client),
  ]);

  const filled = [];
  const skipped = [];
  const suggestions = {};

  // About this client
  if (!briefEmpty) skipped.push({ section: 'About this client', reason: 'already filled' });
  else if (!hasDomain) skipped.push({ section: 'About this client', reason: 'set a domain first' });
  else if (briefR.status === 'fulfilled' && briefR.value) {
    await pool.query('UPDATE clients SET briefing_field = $1 WHERE id = $2', [briefR.value, clientId]);
    filled.push({ section: 'About this client', detail: 'drafted from the website' });
    suggestions.briefing = briefR.value;
  } else skipped.push({ section: 'About this client', reason: reason(briefR) });

  // Monthly focus
  if (!focusEmpty) skipped.push({ section: 'Monthly focus', reason: 'already filled' });
  else if (focusR.status === 'fulfilled' && focusR.value) {
    await pool.query('UPDATE clients SET monthly_focus = $1 WHERE id = $2', [focusR.value, clientId]);
    filled.push({ section: 'Monthly focus', detail: 'drafted' });
    suggestions.monthly_focus = focusR.value;
  } else skipped.push({ section: 'Monthly focus', reason: reason(focusR) });

  // Competitors
  if (!compEmpty) skipped.push({ section: 'Competitors', reason: 'already set' });
  else if (compR.status === 'fulfilled' && Array.isArray(compR.value) && compR.value.length) {
    const domains = compR.value.map(c => c.domain).filter(Boolean).slice(0, 5);
    if (domains.length) await pool.query('UPDATE clients SET competitor_domains = $1 WHERE id = $2', [domains, clientId]);
    filled.push({ section: 'Competitors', detail: `${domains.length} added` });
    suggestions.competitors = compR.value;
  } else skipped.push({ section: 'Competitors', reason: 'none suggested' });

  // Starter keywords — proposed only.
  if (kwR.status === 'fulfilled' && kwR.value && kwR.value.length) {
    suggestions.keywords = kwR.value;
  }

  return { filled, skipped, suggestions };
}

function reason(settled) {
  return (settled && settled.reason && settled.reason.message) ? settled.reason.message : 'draft failed';
}

module.exports = { kickstart };
