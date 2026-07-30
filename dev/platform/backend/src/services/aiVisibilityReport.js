// Client-facing PDF of AI Brand Visibility (Owned → SEO → AI Visibility). Builds
// a branded, October-styled HTML document from the visibility summary + trend +
// per-prompt breakdown, which routes/aiVisibility.js renders to a PDF via
// pdfService.generatePDFBuffer. Matches the Site Audit / Growth Snapshot look.

const { buildFontCSS, getLogoDataUri } = require('./pdfService');

const ACCENT = '#e7cd41';
const ENGINE_LABEL = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', google_aio: 'Google AI Overviews' };

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}
function sovColour(pct) {
  const n = Number(pct);
  return n >= 60 ? '#1e8449' : n >= 30 ? '#c77f0a' : '#c0392b';
}
function metric(label, value, colour) {
  return `<div class="metric">
    <div class="metric-value"${colour ? ` style="color:${colour}"` : ''}>${esc(value)}</div>
    <div class="metric-label">${esc(label)}</div>
  </div>`;
}

// Consultant-style opening summary prompt (best-effort; report renders without it).
function buildSummaryPrompt({ client, data }) {
  const s = data.summary || {};
  const engines = Object.entries(s.engines || {}).map(([k, v]) => `${ENGINE_LABEL[k] || k}: ${v.share_of_voice}% SoV`).join(', ');
  const comp = (s.competitors || []).slice(0, 5).map(c => `${c.name} (${c.mentions})`).join(', ');
  return {
    system: 'You are a senior SEO consultant at October Communications writing the opening summary of an AI Search Visibility report for a client. British English. 2–3 short sentences, plain and confident, no jargon or lists. Say how visible the brand is in AI answers overall, and the ONE thing to focus on to improve it. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''} (${client.domain || ''})
Overall share of voice in AI answers: ${s.brand_share_of_voice || 0}% across ${s.total_runs || 0} answers.
Per engine: ${engines || 'n/a'}.
Top competitors appearing in the same answers: ${comp || 'none recorded'}.`,
  };
}

// A minimal inline SVG sparkline for the weekly share-of-voice trend.
function sparkline(trend) {
  const pts = (trend || []).filter(t => t && t.total > 0);
  if (pts.length < 2) return '';
  const W = 460, H = 60, pad = 4;
  const xs = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const ys = (v) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.sov).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(p.sov).toFixed(1)}" r="2.5" fill="#111"/>`).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <path d="${d}" fill="none" stroke="#111" stroke-width="2"/>${dots}</svg>`;
}

// data = output of aiVisibility.reportData. Optional aiSummary string.
function buildHtml({ client, data, aiSummary = null }) {
  const s = data.summary || {};
  const logo = getLogoDataUri();

  const engineRows = Object.entries(s.engines || {})
    .sort((a, b) => (b[1].share_of_voice || 0) - (a[1].share_of_voice || 0))
    .map(([k, v]) => `<tr>
      <td>${esc(ENGINE_LABEL[k] || k)}</td>
      <td class="num" style="color:${sovColour(v.share_of_voice)}">${v.share_of_voice}%</td>
      <td class="num">${v.avg_position == null ? '—' : `#${v.avg_position}`}</td>
      <td class="num">${v.brand_hits}/${v.runs}</td>
    </tr>`).join('');

  const compRows = (s.competitors || []).slice(0, 10).map((c, i) => `<tr>
    <td class="rank">${i + 1}</td><td>${esc(c.name)}</td><td class="num">${c.mentions}</td>
  </tr>`).join('');

  const promptRows = (data.prompts || []).map(p => {
    const badge = p.tested === false
      ? `<span class="chip" style="background:#9a958a">Not yet tested</span>`
      : p.mentioned
        ? `<span class="chip" style="background:#1e8449">Named${p.best_position ? ` · #${p.best_position}` : ''}</span>`
        : `<span class="chip" style="background:#c0392b">Absent</span>`;
    const eng = p.engines && p.engines.length ? p.engines.map(e => ENGINE_LABEL[e] || e).join(', ') : '—';
    const comp = p.competitors && p.competitors.length ? esc(p.competitors.join(', ')) : '—';
    return `<tr>
      <td class="q">${esc(p.prompt)}</td>
      <td class="st">${badge}</td>
      <td class="eng">${esc(eng)}</td>
      <td class="cmp">${comp}</td>
    </tr>`;
  }).join('');

  const spark = sparkline(data.trend);

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
    h2.sec { font-size: 13pt; font-weight: 700; margin: 26px 0 10px; }
    h2.sec .src { font-size: 8.5pt; font-weight: 400; color: #999; text-transform: none; letter-spacing: 0; margin-left: 6px; }
    .trendbox { border: 1.5px solid #e5e5e5; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
    .trendbox .cap { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: #777; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { text-align: left; text-transform: uppercase; letter-spacing: 0.5px; font-size: 7.5pt; color: #888; border-bottom: 1.5px solid #e5e5e5; padding: 5px 8px; }
    td { border-bottom: 1px solid #f0f0f0; padding: 6px 8px; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; width: 70px; }
    td.rank { width: 28px; color: #888; font-weight: 700; }
    td.q { width: 44%; }
    td.st { width: 90px; }
    td.eng { color: #555; font-size: 9pt; }
    td.cmp { color: #555; font-size: 9pt; }
    .chip { color: #fff; font-size: 7.5pt; font-weight: 700; border-radius: 12px; padding: 2px 8px; white-space: nowrap; }
    .group { page-break-inside: avoid; margin-bottom: 20px; }
    .two { display: flex; gap: 18px; }
    .two > div { flex: 1; }
    .footer { margin-top: 26px; border-top: 1px solid #e5e5e5; padding-top: 10px; font-size: 8.5pt; color: #999; display: flex; justify-content: space-between; }
    .empty { color: #c0392b; font-weight: 600; padding: 16px 0; }
  </style></head><body><div class="page">
    <div class="masthead">
      <div>${logo ? `<img src="${logo}" height="34" alt="October">` : '<div class="wordmark">October</div>'}</div>
      <div class="wordmark">AI Search Visibility</div>
    </div>
    <h1>${esc(client.name || 'AI Visibility')}</h1>
    <div class="sub">${esc(client.domain || '')} · ${esc(fmtDate(new Date().toISOString()))} · last ${data.days || 30} days · ${s.total_runs || 0} AI answers analysed</div>

    ${aiSummary ? `<div class="summary"><span class="lbl">Summary</span>${esc(aiSummary)}</div>` : ''}

    <div class="metrics">
      ${metric('Share of voice', `${s.brand_share_of_voice || 0}%`, sovColour(s.brand_share_of_voice))}
      ${metric('Answers analysed', s.total_runs || 0)}
      ${metric('Engines', Object.keys(s.engines || {}).length)}
      ${metric('Competitors seen', (s.competitors || []).length)}
    </div>
    <div class="note">How often this brand is named when a prospective customer asks an AI assistant a buyer question — measured across leading AI engines. Higher share of voice is better; the buyer questions where the brand is <strong>Absent</strong> are the biggest opportunities.</div>

    ${spark ? `<div class="trendbox"><div class="cap">Share of voice — weekly trend</div>${spark}</div>` : ''}

    <div class="two">
      <div class="group">
        <h2 class="sec">By engine</h2>
        ${engineRows ? `<table><thead><tr><th>Engine</th><th class="num">SoV</th><th class="num">Avg rank</th><th class="num">Hits</th></tr></thead><tbody>${engineRows}</tbody></table>` : '<div class="note">No engine data yet.</div>'}
      </div>
      <div class="group">
        <h2 class="sec">Competitor leaderboard</h2>
        ${compRows ? `<table><thead><tr><th>#</th><th>Competitor</th><th class="num">Mentions</th></tr></thead><tbody>${compRows}</tbody></table>` : '<div class="note">No competitors recorded.</div>'}
      </div>
    </div>

    <h2 class="sec">Every buyer question <span class="src">${(data.prompts || []).length} in the set${(data.prompts || []).some(p => p.tested === false) ? ' · “Not yet tested” ones are available on request' : ''}</span></h2>
    ${promptRows ? `<table><thead><tr><th>Question asked</th><th>Result</th><th>Named on</th><th>Competitors named</th></tr></thead><tbody>${promptRows}</tbody></table>` : '<div class="empty">No questions set up yet.</div>'}

    <div class="footer">
      <span>Prepared by October Communications</span>
      <span>octobercomms.com</span>
    </div>
  </div></body></html>`;
}

module.exports = { buildHtml, buildSummaryPrompt };
