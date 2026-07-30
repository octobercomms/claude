// Earned Overview PDF — gathers the headline of the Earned (PR) pillar into one
// branded, client-ready document: coverage totals, the outreach status funnel,
// recent published coverage, and the strongest journalist relationships. Reads
// STORED editorial-log data only.

const pool = require('../db');
const R = require('./overviewReport');

const STATUS_LABEL = {
  new: 'New', pitched: 'Pitched', published: 'Published', download: 'Downloaded',
  declined: 'Declined', dismissed: 'Dismissed', in_review: 'Awaiting sign-off',
};

async function reportData(clientId, { days = 90 } = {}) {
  // Headline stats — mirrors /pr/clients/:id/stats.
  const { rows: sr } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('published','download')) AS published,
       COUNT(*) AS tracked,
       COUNT(DISTINCT contact_id) FILTER (WHERE contact_id IS NOT NULL) AS journalists
     FROM pr_editorial_log WHERE client_id = $1 AND status NOT IN ('new','dismissed')`,
    [clientId]
  );
  const s = sr[0] || {};
  const stats = { published: +s.published || 0, tracked: +s.tracked || 0, journalists: +s.journalists || 0 };

  // Status funnel — counts by status across the log.
  const { rows: fr } = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM pr_editorial_log
       WHERE client_id = $1 AND status NOT IN ('dismissed') GROUP BY status`,
    [clientId]
  );
  const funnel = {};
  for (const r of fr) funnel[r.status] = r.n;

  // Recent coverage — most recent published pieces within the window.
  const { rows: cov } = await pool.query(
    `SELECT l.story_title, l.status, l.issue_date, l.story_url,
            o.name AS outlet, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       LEFT JOIN outreach_contacts c ON c.id = l.contact_id
      WHERE l.client_id = $1 AND l.status IN ('published','download')
      ORDER BY COALESCE(l.issue_date, l.request_date) DESC NULLS LAST, l.created_at DESC
      LIMIT 12`,
    [clientId]
  );
  const coverage = cov.map(r => ({
    title: r.story_title, outlet: r.outlet, journalist: (r.journalist || '').trim(),
    issue_date: r.issue_date, url: r.story_url,
  }));

  // Strongest journalist relationships.
  const { rows: jr } = await pool.query(
    `SELECT TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet, o.tier,
            COUNT(*) FILTER (WHERE l.status IN ('published','download')) AS published,
            COUNT(*) FILTER (WHERE l.status = 'pitched') AS pitched,
            MAX(CASE WHEN l.status IN ('published','download') THEN COALESCE(l.issue_date, l.request_date) END) AS last_featured
       FROM outreach_contacts c
       JOIN pr_editorial_log l ON l.contact_id = c.id AND l.client_id = $1 AND l.status NOT IN ('new','dismissed')
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
      GROUP BY c.id, o.name, o.tier
      ORDER BY published DESC, pitched DESC
      LIMIT 10`,
    [clientId]
  );
  const journalists = jr.map(r => ({
    name: (r.name || '').trim() || '—', outlet: r.outlet, tier: r.tier,
    published: +r.published || 0, pitched: +r.pitched || 0, last_featured: r.last_featured,
  }));

  return { days, stats, funnel, coverage, journalists, has_data: stats.tracked > 0 };
}

function buildSummaryPrompt({ client, data }) {
  const st = data.stats;
  const topOutlets = data.coverage.slice(0, 5).map(c => c.outlet).filter(Boolean).join(', ');
  return {
    system: 'You are a senior PR consultant at October Communications writing the opening summary of an Earned Media Overview report for a client. British English. 2–3 short sentences, plain and confident, no jargon or lists. Say how the earned-media programme is performing overall, and the ONE thing to focus on next. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''} (${client.domain || ''})
Published coverage: ${st.published}, total tracked items: ${st.tracked}, journalist relationships: ${st.journalists}.
Recent outlets: ${topOutlets || 'none recorded'}.`,
  };
}

function buildHtml({ client, data, aiSummary = null }) {
  const st = data.stats;

  // Funnel — the meaningful progression, published folds download in.
  const published = (data.funnel.published || 0) + (data.funnel.download || 0);
  const funnelStages = [
    { label: 'Pitched', n: data.funnel.pitched || 0, colour: '#6b7cff' },
    { label: 'Awaiting sign-off', n: data.funnel.in_review || 0, colour: R.AMBER },
    { label: 'Published', n: published, colour: R.GREEN },
    { label: 'Declined', n: data.funnel.declined || 0, colour: R.RED },
  ];
  const funnelMax = Math.max(1, ...funnelStages.map(f => f.n));
  const funnelBars = funnelStages.map(f => R.barRow(f.label, f.n, funnelMax, f.colour)).join('');

  const covRows = data.coverage.map(c => `<tr>
    <td class="q">${R.esc(c.title || '—')}</td>
    <td>${R.esc(c.outlet || '—')}</td>
    <td>${R.esc(c.journalist || '—')}</td>
    <td class="num" style="width:110px">${R.esc(R.fmtDate(c.issue_date))}</td></tr>`).join('');

  const jRows = data.journalists.map((j, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td>${R.esc(j.name)}${j.outlet ? ` <span style="color:#888">· ${R.esc(j.outlet)}</span>` : ''}</td>
    <td class="num">${j.published}</td>
    <td class="num" style="width:110px">${R.esc(R.fmtDate(j.last_featured))}</td></tr>`).join('');

  const body = `
    <div class="metrics">
      ${R.metric('Published coverage', R.fmtInt(st.published), st.published ? R.GREEN : null)}
      ${R.metric('Items tracked', R.fmtInt(st.tracked))}
      ${R.metric('Journalist relationships', R.fmtInt(st.journalists))}
    </div>
    <div class="note">Every piece of earned coverage secured for the brand, plus the outreach pipeline behind it. Published coverage is the outcome; the pitched and awaiting-sign-off stages show what's in flight.</div>

    <h2 class="sec">Outreach funnel</h2>
    ${funnelBars}

    <h2 class="sec">Recent coverage <span class="src">${data.coverage.length} most recent</span></h2>
    ${covRows ? `<table><thead><tr><th>Story</th><th>Outlet</th><th>Journalist</th><th class="num">Published</th></tr></thead><tbody>${covRows}</tbody></table>` : '<div class="empty">No published coverage recorded yet.</div>'}

    <h2 class="sec">Strongest relationships</h2>
    ${jRows ? `<table><thead><tr><th>#</th><th>Journalist</th><th class="num">Pieces</th><th class="num">Last featured</th></tr></thead><tbody>${jRows}</tbody></table>` : '<div class="empty">No journalist relationships recorded yet.</div>'}`;

  return R.renderShell({
    client, wordmark: 'Earned Overview', title: client.name || 'Earned Overview',
    metaBits: [client.domain, R.fmtDate(new Date().toISOString()), `${R.fmtInt(st.published)} pieces published`],
    aiSummary, bodyHtml: body,
  });
}

module.exports = { reportData, buildHtml, buildSummaryPrompt };
