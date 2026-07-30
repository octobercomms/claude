// Owned Overview PDF — gathers the headline of the Owned (SEO) pillar into one
// branded, client-ready document: search-visibility KPIs, top rank movers, rank
// distribution, AI Overview coverage, the latest technical site-audit score +
// top issues, and the latest authority metrics. Reads STORED data only — it
// never triggers a fresh crawl or rank check.

const pool = require('../db');
const R = require('./overviewReport');

// Enriched keyword rows — same shape the Owned Overview panel consumes.
const KEYWORDS_SQL = `
  SELECT k.id, k.keyword, k.intent,
    (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS current_position,
    (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1) AS previous_position,
    (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id AND position IS NOT NULL) AS best_position,
    (SELECT present FROM aio_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS aio_present,
    (SELECT brand_cited FROM aio_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS aio_brand_cited
  FROM seo_keywords k
  WHERE k.client_id = $1 AND k.active = true
  ORDER BY k.keyword ASC`;

const INTENT_LABEL = { informational: 'Informational', commercial: 'Commercial', transactional: 'Transactional', navigational: 'Navigational' };

async function reportData(clientId, { days = 30 } = {}) {
  const { rows: kws } = await pool.query(KEYWORDS_SQL, [clientId]);

  const pos = (v) => (v == null ? null : Number(v));
  let ranking = 0, top10 = 0, top3 = 0, aioPresent = 0, aioCited = 0;
  const dist = { '#1': 0, '#2–3': 0, '#4–10': 0, '#11–20': 0, '#21–50': 0, '#51+': 0 };
  const intents = {};
  const movers = [];
  for (const k of kws) {
    const cur = pos(k.current_position);
    if (cur != null) {
      ranking++;
      if (cur <= 3) top3++;
      if (cur <= 10) top10++;
      if (cur === 1) dist['#1']++;
      else if (cur <= 3) dist['#2–3']++;
      else if (cur <= 10) dist['#4–10']++;
      else if (cur <= 20) dist['#11–20']++;
      else if (cur <= 50) dist['#21–50']++;
      else dist['#51+']++;
    }
    if (k.aio_present) aioPresent++;
    if (k.aio_brand_cited) aioCited++;
    const label = INTENT_LABEL[k.intent] || 'Unclassified';
    intents[label] = (intents[label] || 0) + 1;
    const prev = pos(k.previous_position);
    if (cur != null && prev != null && cur !== prev) {
      movers.push({ keyword: k.keyword, current: cur, previous: prev, delta: prev - cur }); // +ve = climbed
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const gainers = movers.filter(m => m.delta > 0).slice(0, 6);
  const droppers = movers.filter(m => m.delta < 0).slice(0, 6);

  // Latest completed technical site audit.
  const { rows: ar } = await pool.query(
    `SELECT score, summary_json, pages_crawled, domain, completed_at
       FROM site_audits WHERE client_id = $1 AND status = 'complete'
       ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
    [clientId]
  );
  let audit = null;
  if (ar.length) {
    const a = ar[0];
    const sj = a.summary_json || {};
    const issues = Object.entries(sj)
      .map(([category, count]) => ({ category, count: Number(count) || 0 }))
      .filter(i => i.count > 0)
      .sort((a2, b2) => b2.count - a2.count)
      .slice(0, 10);
    audit = { score: a.score, pages_crawled: a.pages_crawled, completed_at: a.completed_at, total_issues: issues.reduce((s, i) => s + i.count, 0), issues };
  }

  // Latest authority metrics (manual monthly snapshot).
  const { rows: mm } = await pool.query(
    `SELECT to_char(month, 'YYYY-MM-DD') AS month, moz_da, authority_score, referring_domains
       FROM seo_manual_metrics WHERE client_id = $1 ORDER BY month DESC LIMIT 1`,
    [clientId]
  );
  const authority = mm.length ? mm[0] : null;

  return {
    days,
    kpis: {
      tracked: kws.length, ranking, top10, top3,
      not_ranking: kws.length - ranking,
      aio_present: aioPresent, aio_cited: aioCited,
      aio_coverage: aioPresent ? Math.round((aioCited / aioPresent) * 100) : 0,
    },
    distribution: dist,
    intents,
    gainers, droppers,
    audit, authority,
    has_data: kws.length > 0 || !!audit,
  };
}

// A category slug like "missing_meta_title" → "Missing meta title".
function humanCategory(c) {
  return String(c || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

function scoreColour(s) {
  const n = Number(s);
  return n >= 80 ? R.GREEN : n >= 55 ? R.AMBER : R.RED;
}

function buildSummaryPrompt({ client, data }) {
  const k = data.kpis;
  return {
    system: 'You are a senior SEO consultant at October Communications writing the opening summary of an Owned/SEO Overview report for a client. British English. 2–3 short sentences, plain and confident, no jargon or lists. Say how the site is performing in organic search overall, and the ONE thing to focus on next. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''} (${client.domain || ''})
Tracked keywords: ${k.tracked}, ranking: ${k.ranking}, in top 10: ${k.top10}, in top 3: ${k.top3}.
In AI Overviews: cited on ${k.aio_cited} of ${k.aio_present} where an AI Overview appears.
Latest technical audit score: ${data.audit ? data.audit.score + '/100 with ' + data.audit.total_issues + ' issues' : 'none run yet'}.`,
  };
}

function buildHtml({ client, data, aiSummary = null }) {
  const k = data.kpis;
  const distMax = Math.max(1, ...Object.values(data.distribution));
  const distBars = Object.entries(data.distribution).map(([label, v]) => R.barRow(label, v, distMax)).join('');
  const intentEntries = Object.entries(data.intents).sort((a, b) => b[1] - a[1]);
  const intentMax = Math.max(1, ...intentEntries.map(e => e[1]));
  const intentBars = intentEntries.map(([label, v]) => R.barRow(label, v, intentMax, '#6b7cff')).join('');

  const moverRow = (m, up) => `<tr>
    <td>${R.esc(m.keyword)}</td>
    <td class="num" style="color:${up ? R.GREEN : R.RED};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(m.delta)}</td>
    <td class="num">#${m.previous} → #${m.current}</td></tr>`;
  const gainerRows = data.gainers.map(m => moverRow(m, true)).join('');
  const dropperRows = data.droppers.map(m => moverRow(m, false)).join('');

  const auditBlock = data.audit ? `
    <h2 class="sec">Technical health <span class="src">audited ${R.esc(R.fmtDate(data.audit.completed_at))} · ${R.fmtInt(data.audit.pages_crawled)} pages</span></h2>
    <div class="metrics" style="margin-bottom:10px">
      ${R.metric('Site health score', `${data.audit.score == null ? '—' : data.audit.score}${data.audit.score == null ? '' : '/100'}`, scoreColour(data.audit.score))}
      ${R.metric('Issues found', R.fmtInt(data.audit.total_issues))}
      ${R.metric('Pages crawled', R.fmtInt(data.audit.pages_crawled))}
    </div>
    ${data.audit.issues.length ? `<table><thead><tr><th>Issue category</th><th class="num">Pages affected</th></tr></thead><tbody>
      ${data.audit.issues.map(i => `<tr><td>${R.esc(humanCategory(i.category))}</td><td class="num">${R.fmtInt(i.count)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No technical issues flagged — clean bill of health.</div>'}` : `
    <h2 class="sec">Technical health</h2>
    <div class="empty">No site audit has been run yet. Run one from the Owned → Optimise tab to include technical health here.</div>`;

  const authBlock = data.authority ? `
    <h2 class="sec">Authority</h2>
    <div class="metrics">
      ${R.metric('Domain authority', data.authority.moz_da ?? '—')}
      ${R.metric('Authority score', data.authority.authority_score ?? '—')}
      ${R.metric('Referring domains', data.authority.referring_domains == null ? '—' : R.fmtInt(data.authority.referring_domains))}
    </div>` : '';

  const body = `
    <div class="metrics">
      ${R.metric('Keywords tracked', R.fmtInt(k.tracked))}
      ${R.metric('Ranking', R.fmtInt(k.ranking), k.ranking ? R.GREEN : null)}
      ${R.metric('Top 10', R.fmtInt(k.top10), R.GREEN)}
      ${R.metric('Top 3', R.fmtInt(k.top3), R.GREEN)}
      ${R.metric('Not ranking', R.fmtInt(k.not_ranking), k.not_ranking ? R.AMBER : null)}
      ${R.metric('In AI Overviews', R.fmtInt(k.aio_cited), null, `of ${R.fmtInt(k.aio_present)} shown`)}
    </div>
    <div class="note">The organic search position of every tracked keyword, plus how often the brand is cited inside Google's AI Overviews. Higher-ranked and top-10 keywords drive the most traffic; keywords <strong>not ranking</strong> are the biggest opportunities.</div>

    <div class="two">
      <div class="group"><h2 class="sec">Rank distribution</h2>${distBars || '<div class="empty">No ranking data yet.</div>'}</div>
      <div class="group"><h2 class="sec">Search intent mix</h2>${intentBars || '<div class="empty">Keywords not classified yet.</div>'}</div>
    </div>

    <div class="two">
      <div class="group"><h2 class="sec">Top climbers</h2>${gainerRows ? `<table><thead><tr><th>Keyword</th><th class="num">Move</th><th class="num">Change</th></tr></thead><tbody>${gainerRows}</tbody></table>` : '<div class="empty">No climbers in this period.</div>'}</div>
      <div class="group"><h2 class="sec">Biggest drops</h2>${dropperRows ? `<table><thead><tr><th>Keyword</th><th class="num">Move</th><th class="num">Change</th></tr></thead><tbody>${dropperRows}</tbody></table>` : '<div class="empty">No drops in this period.</div>'}</div>
    </div>

    ${auditBlock}
    ${authBlock}`;

  return R.renderShell({
    client, wordmark: 'Owned Overview', title: client.name || 'Owned Overview',
    metaBits: [client.domain, R.fmtDate(new Date().toISOString()), `${R.fmtInt(k.tracked)} keywords tracked`],
    aiSummary, bodyHtml: body,
  });
}

module.exports = { reportData, buildHtml, buildSummaryPrompt };
