/**
 * Targeting assistant — "who should I pitch this story to?".
 *
 * Cheap by construction: we NEVER run an LLM over all contacts. One small call
 * extracts the angle + keywords from the press release/brief; a SQL pass selects
 * a candidate pool by keyword overlap against enriched beats/topics/notes (+ the
 * client relationship + tier); then ONE Claude call ranks the shortlist and
 * explains each pick. Two calls per query, a few cents.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');
const pr = require('./pr');
const { assertPublicHttpUrl } = require('../utils/urlSafety');
let claude; try { claude = require('./claude'); } catch (e) { claude = null; }

const HAIKU = 'claude-haiku-4-5-20251001';

function parseJson(text, fallback) {
  const m = String(text || '').match(/[[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
}

async function fetchText(url) {
  await assertPublicHttpUrl(url);
  const { data: html } = await axios.get(url, {
    timeout: 15000, maxRedirects: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberPlatform/1.0; +https://platform.octobercomms.com)' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, header, footer, nav').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
}

/** Extract a one-line angle + keyword list from a brief or fetched release. */
async function extractAngle(text) {
  if (!claude || !claude.callClaude) return { angle: '', keywords: [] };
  const system = 'You read a press release or pitch brief and extract what it is about, for matching to journalists. British English. JSON only.';
  const prompt = `Text:\n${text.slice(0, 6000)}\n\nReturn JSON: {"angle":"one sentence on the story's news hook","keywords":["6-12 lowercase topic/sector keywords a relevant journalist would cover"]}`;
  const d = parseJson(await claude.callClaude({ max_tokens: 300, system, user: prompt, model: HAIKU }), {});
  const keywords = Array.isArray(d.keywords) ? d.keywords.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 14) : [];
  return { angle: String(d.angle || '').slice(0, 300), keywords };
}

/**
 * Build a target list for a client's story.
 * @param {{clientId:string, url?:string, brief?:string}} input
 */
async function findTargets({ clientId, url, brief }) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  let text = String(brief || '').trim();
  if (!text && url) { try { text = await fetchText(url); } catch (e) { return { error: `Couldn't fetch that URL: ${e.message}` }; } }
  if (!text) return { error: 'Give a press-release URL or paste a brief.' };

  const { angle, keywords } = await extractAngle(text);
  if (!keywords.length) return { angle, targets: [], note: 'Could not extract topics from that text.' };
  const likes = keywords.map((k) => `%${k}%`);

  // Candidate pool: enriched press contacts whose beats/topics/notes/outlet
  // overlap the story keywords. Cheap SQL, capped — no LLM here.
  const { rows } = await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email, c.beats, c.topics,
            c.enrichment_note, c.availability_status, o.name AS outlet, o.tier,
            COUNT(l.id) FILTER (WHERE l.status IN ('published','download')) AS published,
            MAX(CASE WHEN l.status IN ('published','download') THEN COALESCE(l.issue_date, l.request_date) END) AS last_featured
       FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
       LEFT JOIN pr_editorial_log l ON l.contact_id = c.id AND l.client_id = $2
      WHERE c.kind IN ('media','industry') AND c.availability_status = 'active'
        AND (
          lower(COALESCE(c.enrichment_note,'')) ILIKE ANY($1)
          OR lower(c.beats::text) ILIKE ANY($1)
          OR lower(c.topics::text) ILIKE ANY($1)
          OR lower(COALESCE(o.name,'')) ILIKE ANY($1)
        )
      GROUP BY c.id, o.name, o.tier
      LIMIT 200`,
    [likes, clientId]
  );
  if (!rows.length) return { angle, keywords, targets: [], note: 'No matching contacts yet — enrich the contacts (or import more) and try again.' };

  // Score: keyword hits + tier weight + relationship strength. Shortlist top 40.
  const scored = rows.map((r) => {
    const blob = `${r.enrichment_note || ''} ${JSON.stringify(r.beats || [])} ${JSON.stringify(r.topics || [])} ${r.outlet || ''}`.toLowerCase();
    const hits = keywords.reduce((n, k) => n + (blob.includes(k) ? 1 : 0), 0);
    const ts = r.last_featured ? new Date(r.last_featured).getTime() : null;
    const strength = pr.relationshipStrength(+r.published || 0, ts);
    const tierW = r.tier === '1' ? 12 : r.tier === '2' ? 6 : r.tier === '3' ? 2 : 0;
    return { ...r, hits, strength: strength.score, strength_label: strength.label, score: hits * 10 + tierW + strength.score / 10 };
  }).sort((a, b) => b.score - a.score).slice(0, 40);

  // One Claude call ranks the shortlist and explains each pick.
  const compact = scored.map((r) => ({
    id: r.id, name: r.name, outlet: r.outlet || '', tier: r.tier || '',
    beats: r.beats || [], topics: r.topics || [], note: r.enrichment_note || '',
    published_for_client: +r.published || 0, last_featured: r.last_featured,
  }));
  const system = 'You are a PR strategist building a targeted media list for a specific story. Pick the journalists whose actual beats/topics fit the angle; prefer a warm existing relationship and higher-tier titles, but relevance comes first. Never invent journalists — only choose from the list. British English. JSON only.';
  const prompt = `Story angle: ${angle}\nKeywords: ${keywords.join(', ')}\n\nCandidates (JSON):\n${JSON.stringify(compact)}\n\nReturn the best up to 15, ranked, as JSON: {"targets":[{"id":"…","reason":"one specific sentence why they fit this story"}]}`;
  const d = parseJson(await claude.callClaude({ max_tokens: 1500, system, user: prompt }), { targets: [] });
  const byId = Object.fromEntries(scored.map((r) => [r.id, r]));
  const targets = (d.targets || [])
    .map((t) => ({ ...(byId[t.id] || {}), reason: String(t.reason || '').slice(0, 300) }))
    .filter((t) => t.id)
    .map((t) => ({ id: t.id, name: t.name, outlet: t.outlet || '', tier: t.tier || '', strength: t.strength, strength_label: t.strength_label, published_for_client: +t.published || 0, last_featured: t.last_featured, has_email: !!(t.email && !/@import\.local$/i.test(t.email)), reason: t.reason }));
  return { angle, keywords, targets };
}

module.exports = { findTargets };
