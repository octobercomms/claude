// Client-facing PDF of the Site Audit (Owned → Optimise → Scan). Builds a
// branded, October-styled HTML document from a site_audits row + its issues,
// which routes/seoSuite.js renders to a PDF via pdfService.generatePDFBuffer.
//
// Reuses the Brockmann font + October logo from pdfService so it matches the
// Growth Snapshot / monthly reports.

const { buildFontCSS, getLogoDataUri } = require('./pdfService');

const ACCENT = '#e7cd41';
const SEV_COLOUR = { high: '#c0392b', medium: '#c77f0a', low: '#6b7280' };
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

// Friendly labels for the crawl's issue categories.
const CATEGORY_LABELS = {
  fetch_failed: 'Pages that failed to load',
  waf_blocked: 'Pages blocked by the firewall',
  broken_link: 'Broken links',
  slow_response: 'Slow page responses',
  noindex_blocked: 'Pages set to noindex',
  missing_meta_title: 'Missing page titles',
  meta_title_length: 'Page title length',
  missing_meta_description: 'Missing meta descriptions',
  meta_description_length: 'Meta description length',
  missing_h1: 'Missing H1 heading',
  multiple_h1: 'Multiple H1 headings',
  no_alt_text: 'Images missing alt text',
  image_legacy_format: 'Images in legacy formats',
  image_no_dimensions: 'Images without dimensions',
  image_no_lazyload: 'Images not lazy-loaded',
  thin_content: 'Thin content',
  no_clear_focus: 'Unclear page focus',
};
function categoryLabel(cat) {
  if (String(cat).startsWith('hreflang')) return 'Hreflang / international issues';
  return CATEGORY_LABELS[cat] || String(cat || 'Other').replace(/_/g, ' ');
}
const SEV_RANK = { high: 3, medium: 2, low: 1 };

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function scoreColour(score) {
  const n = Number(score);
  return n >= 80 ? '#1e8449' : n >= 60 ? '#c77f0a' : '#c0392b';
}
function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}

function ratingColour(r) {
  const s = String(r || '').toLowerCase();
  if (s.includes('good')) return '#1e8449';
  if (s.includes('poor') || s.includes('slow')) return '#c0392b';
  if (s.includes('improve') || s.includes('average') || s.includes('moderate')) return '#c77f0a';
  return '#6b7280';
}

// Compact Claude prompt for the consultant-style summary paragraph.
function buildSummaryPrompt({ client, audit, issues, cwv }) {
  const active = (issues || []).filter(i => i.status !== 'dismissed');
  const byCat = {};
  for (const i of active) (byCat[i.category] ||= { n: 0, sev: i.severity }) && (byCat[i.category].n++);
  const top = Object.entries(byCat)
    .sort((a, b) => b[1].n - a[1].n).slice(0, 6)
    .map(([cat, v]) => `- ${categoryLabel(cat)}: ${v.n}`).join('\n');
  const cwvLine = cwv && cwv.metrics
    ? `Core Web Vitals (${cwv.strategy || 'mobile'}): LCP ${cwv.metrics.lcp?.value || '—'} (${cwv.metrics.lcp?.rating || '—'}), INP ${cwv.metrics.inp?.value || '—'} (${cwv.metrics.inp?.rating || '—'}), CLS ${cwv.metrics.cls?.value || '—'} (${cwv.metrics.cls?.rating || '—'}).`
    : 'Core Web Vitals: not available.';
  return {
    system: 'You are a senior SEO consultant at October Communications writing the opening summary of a technical site-audit report for a client. British English. 2–3 short sentences, plain and confident, no jargon or lists. Say where the site stands overall and the ONE or TWO things worth fixing first. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''} (${audit.domain || client.domain || ''})
Health score: ${audit.score == null ? 'n/a' : audit.score}/100. Pages crawled: ${audit.pages_crawled || 0}. Total issues: ${active.length}.
Top issue types:
${top || '- none'}
${cwvLine}`,
  };
}

function metric(label, value, colour) {
  return `<div class="metric">
    <div class="metric-value"${colour ? ` style="color:${colour}"` : ''}>${esc(value)}</div>
    <div class="metric-label">${esc(label)}</div>
  </div>`;
}

// audit = site_audits row; issues = site_audit_issues rows.
// Optional: cwv (Core Web Vitals payload), aiSummary (string), prevScore (number).
function buildHtml({ client, audit, issues, cwv = null, aiSummary = null, prevScore = null }) {
  const active = (issues || []).filter(i => i.status !== 'dismissed');
  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of active) if (counts[i.severity] != null) counts[i.severity]++;
  const openCount = active.filter(i => i.status === 'open').length;

  // Group by category, ordered by worst severity then size.
  const groups = {};
  for (const i of active) (groups[i.category] ||= []).push(i);
  const ordered = Object.entries(groups).map(([cat, list]) => {
    const worst = Math.max(...list.map(x => SEV_RANK[x.severity] || 0));
    list.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));
    return { cat, list, worst };
  }).sort((a, b) => b.worst - a.worst || b.list.length - a.list.length);

  const sections = ordered.map(g => {
    const rows = g.list.map(i => `<tr>
      <td class="url">${esc(i.page_url)}</td>
      <td>${esc(i.detail)}</td>
      <td class="sev"><span class="chip" style="background:${SEV_COLOUR[i.severity] || '#6b7280'}">${SEV_LABEL[i.severity] || i.severity}</span></td>
    </tr>`).join('');
    return `<div class="group">
      <h3>${esc(categoryLabel(g.cat))} <span class="count">${g.list.length}</span></h3>
      <table><thead><tr><th>Page</th><th>What we found</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  const domain = audit.domain || client.domain || '';
  const logo = getLogoDataUri();

  // Score trend vs the previous audit.
  let trend = '';
  if (prevScore != null && audit.score != null) {
    const d = Number(audit.score) - Number(prevScore);
    if (d > 0) trend = `<span class="trend up">▲ +${d} vs last audit</span>`;
    else if (d < 0) trend = `<span class="trend down">▼ ${d} vs last audit</span>`;
    else trend = `<span class="trend flat">no change vs last audit</span>`;
  }

  // Core Web Vitals block.
  const m = cwv && cwv.metrics ? cwv.metrics : null;
  const cwvCell = (label, metric) => metric ? `<div class="metric">
    <div class="metric-value" style="font-size:17pt;color:${ratingColour(metric.rating)}">${esc(metric.value)}</div>
    <div class="metric-label">${esc(label)}${metric.rating ? ` · ${esc(metric.rating)}` : ''}</div></div>` : '';
  const cwvBlock = m ? `<h2 class="sec">Core Web Vitals <span class="src">${esc(cwv.source === 'field' ? 'real-user field data' : 'lab estimate')} · ${esc(cwv.strategy || 'mobile')}</span></h2>
    <div class="metrics" style="margin-bottom:22px">${cwvCell('LCP', m.lcp)}${cwvCell('INP', m.inp)}${cwvCell('CLS', m.cls)}${cwvCell('FCP', m.fcp)}${cwvCell('TTFB', m.ttfb)}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${buildFontCSS()}
    * { box-sizing: border-box; }
    body { font-family: 'Brockmann', Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 10.5pt; line-height: 1.45; }
    .page { padding: 18mm 15mm; }
    .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 22px; }
    .masthead .wordmark { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #111; }
    h1 { font-size: 26pt; font-weight: 700; margin: 0 0 2px; letter-spacing: -0.5px; }
    .sub { color: #555; font-size: 11pt; margin-bottom: 22px; }
    .metrics { display: flex; gap: 10px; margin-bottom: 8px; }
    .metric { flex: 1; border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 14px 12px; text-align: center; }
    .metric-value { font-size: 24pt; font-weight: 700; letter-spacing: -1px; }
    .metric-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: #777; margin-top: 4px; }
    .note { color: #555; font-size: 10pt; margin: 14px 0 24px; }
    .summary { background: #faf6df; border-left: 4px solid ${ACCENT}; border-radius: 8px; padding: 14px 16px; margin: 16px 0 6px; font-size: 11pt; line-height: 1.5; }
    .summary .lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #9a8a2a; font-weight: 700; display: block; margin-bottom: 5px; }
    .trend { font-size: 9pt; font-weight: 700; margin-left: 8px; }
    .trend.up { color: #1e8449; } .trend.down { color: #c0392b; } .trend.flat { color: #888; }
    h2.sec { font-size: 13pt; font-weight: 700; margin: 26px 0 10px; }
    h2.sec .src { font-size: 8.5pt; font-weight: 400; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 6px; }
    .group { margin-bottom: 20px; page-break-inside: avoid; }
    .group h3 { font-size: 12pt; font-weight: 700; margin: 0 0 6px; }
    .group h3 .count { display: inline-block; background: ${ACCENT}; color: #111; border-radius: 20px; font-size: 9pt; padding: 1px 9px; margin-left: 6px; vertical-align: middle; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    th { text-align: left; text-transform: uppercase; letter-spacing: 0.5px; font-size: 7.5pt; color: #888; border-bottom: 1.5px solid #e5e5e5; padding: 5px 8px; }
    td { border-bottom: 1px solid #f0f0f0; padding: 6px 8px; vertical-align: top; }
    td.url { color: #1a4fb4; word-break: break-all; width: 42%; }
    td.sev { width: 70px; text-align: right; }
    .chip { color: #fff; font-size: 7.5pt; font-weight: 700; border-radius: 12px; padding: 2px 8px; }
    .footer { margin-top: 26px; border-top: 1px solid #e5e5e5; padding-top: 10px; font-size: 8.5pt; color: #999; display: flex; justify-content: space-between; }
    .empty { color: #1e8449; font-weight: 600; padding: 20px 0; }
  </style></head><body><div class="page">
    <div class="masthead">
      <div>${logo ? `<img src="${logo}" height="34" alt="October">` : '<div class="wordmark">October</div>'}</div>
      <div class="wordmark">Site Audit</div>
    </div>
    <h1>${esc(client.name || 'Site audit')}</h1>
    <div class="sub">${esc(domain)} · Audited ${esc(fmtDate(audit.completed_at || audit.started_at))} · ${audit.pages_crawled || 0} pages crawled${trend}</div>

    ${aiSummary ? `<div class="summary"><span class="lbl">Summary</span>${esc(aiSummary)}</div>` : ''}

    <div class="metrics">
      ${metric('Health score', `${audit.score == null ? '—' : audit.score}/100`, scoreColour(audit.score))}
      ${metric('Pages crawled', audit.pages_crawled || 0)}
      ${metric('Issues found', active.length)}
      ${metric('High severity', counts.high, counts.high ? SEV_COLOUR.high : undefined)}
      ${metric('Still open', openCount)}
    </div>
    <div class="note">A technical health check of the live site — up to 30 pages crawled for broken links, missing titles and headings, slow responses, missing alt text and thin content. Higher scores are better; fixing the high-severity items first has the biggest impact.</div>

    ${cwvBlock}

    ${active.length ? `<h2 class="sec">Issues to fix</h2>${sections}` : '<div class="empty">No outstanding issues found — the site is in good technical health. 🎉</div>'}

    <div class="footer">
      <span>Prepared by October Communications</span>
      <span>octobercomms.com</span>
    </div>
  </div></body></html>`;
}

module.exports = { buildHtml, buildSummaryPrompt };
