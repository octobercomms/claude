// Renders a Snapshot Studio draft into the branded "October Growth Snapshot"
// HTML, driven by the drafted JSON + the AM's chosen images. Reuses the exact
// same logo asset + brand yellow as the real client reports (pdfService), so
// the snapshot is on-brand rather than an approximation.

const fs = require('fs');
const path = require('path');

// The real October mark — same SVG the client PDF reports embed. Read once and
// inlined as a data URI so it travels into both the preview and the PDF.
const LOGO_URI = (() => {
  try {
    const svg = fs.readFileSync(path.join(__dirname, '../assets/october-logo.svg'), 'utf8');
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch { return null; }
})();

function logoTag(height = 40) {
  return LOGO_URI
    ? `<img src="${LOGO_URI}" height="${height}" alt="October" style="display:block;">`
    : `<span style="font-weight:800;letter-spacing:.02em;">OCTOBER</span>`;
}

// Embed the Brockmann brand font — the same woff2 files the client PDF reports
// use — as base64 @font-face rules, so the snapshot renders in the real brand
// typeface both on screen and in the exported PDF (Chromium won't fetch the
// public font path when printing from setContent).
const FONTS_DIR = path.join(__dirname, '../../../frontend/public/fonts');
function fontFace(weight, style, file) {
  try {
    const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
    return `@font-face{font-family:'Brockmann';font-weight:${weight};font-style:${style};src:url('data:font/woff2;base64,${b64}') format('woff2');}`;
  } catch { return ''; }
}
const FONT_CSS = [
  fontFace('400', 'normal', 'brockmann-regular-webfont.woff2'),
  fontFace('400', 'italic', 'brockmann-regularitalic-webfont.woff2'),
  fontFace('600', 'normal', 'brockmann-semibold-webfont.woff2'),
  fontFace('700', 'normal', 'brockmann-bold-webfont.woff2'),
  fontFace('700', 'italic', 'brockmann-bolditalic-webfont.woff2'),
].filter(Boolean).join('\n');

// A masthead used on the cover + CTA: real October mark on the left, the
// "Growth Snapshot" wordmark top-right (mirrors the "Report for …" block on the
// client reports), sitting on a hard rule. Gives the header a deliberate,
// on-brand structure instead of a logo floating above the title.
function masthead(rightSub) {
  return `<div class="masthead">
    <div>${logoTag(38)}</div>
    <div class="mast-r"><div class="mast-title">Growth Snapshot</div><div class="mast-sub">${esc(rightSub)}</div></div>
  </div>`;
}

// Slim running header for the interior pages — logo left, report identifier
// right, on a light rule.
function runningHead(company) {
  return `<div class="runhead"><div>${logoTag(22)}</div><div class="small">Growth Snapshot · ${esc(company)}</div></div>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Turn "**bold**" into <strong> after escaping, so drafted copy can emphasise.
function rich(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --ink:#231f20; --muted:#5b5b5b; --line:#e4e4e4; --accent:#e7cd41; --accent-soft:#faf3c9; --accent-ink:#6f5e10; --pos:#1f7a4d; --neg:#b3261e; --sunken:#faf9f6; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Brockmann', -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink); font-size: 13px; line-height: 1.55; }
  .page { width: 210mm; min-height: 297mm; padding: 20mm 18mm; page-break-after: always; position: relative; background: #fff; }
  .page:last-child { page-break-after: auto; }
  .kicker { font-size: 10px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 40px; line-height: 1.02; letter-spacing: -1px; font-weight: 800; margin-top: 10px; }
  /* Masthead — logo left, "Growth Snapshot" wordmark right, on a hard rule. */
  .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid var(--ink); padding-bottom: 13px; }
  .mast-r { text-align: right; }
  .mast-title { font-size: 15px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; line-height: 1; }
  .mast-sub { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-top: 5px; }
  .runhead { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 11px; }
  h2 { font-size: 22px; letter-spacing: -.4px; font-weight: 800; }
  h3 { font-size: 15px; font-weight: 800; }
  .lede { font-size: 15px; color: var(--muted); max-width: 150mm; margin-top: 12px; }
  .small { font-size: 11px; color: var(--muted); }
  .strong { font-weight: 800; }
  .accent-text { color: var(--accent-ink); }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .pill { display: inline-block; padding: 4px 11px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .pill.sample { background: var(--ink); color: #fff; }
  .cover { display: flex; flex-direction: column; min-height: 257mm; }
  .cover .mid { margin-top: auto; } .cover .foot { margin-top: auto; border-top: 2px solid var(--ink); padding-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .hero-img { width: 100%; height: 62mm; object-fit: cover; border-radius: 12px; margin-top: 18px; border: 2px solid var(--line); }
  .scoregrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 22px; }
  .stat { border: 2px solid var(--line); border-radius: 10px; padding: 14px; }
  .stat .lab { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .stat .val { font-size: 26px; font-weight: 800; letter-spacing: -1px; margin-top: 6px; line-height: 1.05; }
  .stat .sub { font-size: 10.5px; color: var(--muted); margin-top: 5px; }
  .stat.hot { background: var(--ink); border-color: var(--ink); color: #fff; }
  .stat.hot .lab, .stat.hot .sub { color: #cfcfcf; } .stat.hot .val { color: var(--accent); }
  .panelhead { display: flex; align-items: baseline; gap: 10px; border-bottom: 2px solid var(--ink); padding-bottom: 8px; margin-bottom: 14px; }
  .panelhead .no { font-size: 12px; font-weight: 800; color: #fff; background: var(--ink); width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .panelhead .svc { margin-left: auto; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .block { border: 2px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .block .tag { font-size: 9.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .block.find { border-left: 4px solid var(--accent); }
  .block.idea { background: var(--sunken); }
  .opp { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; background: var(--accent-soft); border-radius: 10px; }
  .opp .arrow { font-weight: 800; color: var(--accent-ink); }
  .sec-img { width: 100%; height: 40mm; object-fit: cover; border-radius: 8px; margin-bottom: 12px; border: 2px solid var(--line); }
  .footer { position: absolute; bottom: 12mm; left: 18mm; right: 18mm; display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }
  .cta { background: var(--ink); color: #fff; border-radius: 14px; padding: 34px; }
  .cta h2 { font-size: 28px; letter-spacing: -.6px; }
  .cta .btn { display: inline-block; margin-top: 20px; background: var(--accent); color: var(--ink); font-weight: 800; padding: 14px 26px; border-radius: 999px; font-size: 15px; }
  .cta .sub { color: #cfcfcf; margin-top: 12px; max-width: 130mm; }
`;

function statTile(lab, val, sub, hot) {
  return `<div class="stat${hot ? ' hot' : ''}"><div class="lab">${esc(lab)}</div><div class="val">${esc(val || '—')}</div><div class="sub">${esc(sub || '')}</div></div>`;
}

// draft: { company_name, scores:{search,ai,social,pr}, score_notes?, headline_opportunity,
//          summary:[{service,text}|string], sections:[{title,service,finding,idea,opportunity}] }
// featured: array of image URLs (already resolved to something the renderer can load)
// opts: { sample:boolean, bookUrl, contactEmail }
function renderReportHtml(draft = {}, featured = [], opts = {}) {
  const company = draft.company_name || 'your brand';
  const scores = draft.scores || {};
  const notes = draft.score_notes || {};
  const summary = Array.isArray(draft.summary) ? draft.summary : [];
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const hero = featured[0];
  const contact = opts.contactEmail || 'hello@octobercomms.com';

  const cover = `
  <section class="page cover">
    ${masthead(opts.sample ? 'Sample report' : 'Prepared by October')}
    <div class="mid">
      <div class="kicker">Prepared for</div>
      <h1>${esc(company)}</h1>
      <p class="lede">A 60-second, personalised read on where you're winning attention, where you're invisible, and the moves we'd make first — across search, paid, social, PR and brand.</p>
      ${hero ? `<img class="hero-img" src="${esc(hero)}" alt="">` : ''}
      <div class="scoregrid">
        ${statTile('Search health', scores.search, notes.search || 'On-page & rankings')}
        ${statTile('AI visibility', scores.ai, notes.ai || 'In AI answers', true)}
        ${statTile('Social presence', scores.social, notes.social || 'Reach & consistency')}
        ${statTile('PR footprint', scores.pr, notes.pr || 'Earned coverage')}
      </div>
    </div>
    <div class="foot">
      <div><div class="strong">The opportunity in one line</div><div class="small" style="max-width:120mm">${rich(draft.headline_opportunity || '')}</div></div>
      <div class="small" style="text-align:right">octobercomms.com</div>
    </div>
  </section>`;

  const summaryPage = summary.length ? `
  <section class="page">
    ${runningHead(company)}
    <div style="margin-top:30px">
      <div class="kicker">What we found in 60 seconds</div>
      <h2 style="margin-top:8px">A few things worth a conversation</h2>
    </div>
    <div style="margin-top:20px">
      ${summary.map((s, i) => {
        const svc = typeof s === 'object' ? s.service : '';
        const text = typeof s === 'object' ? s.text : s;
        return `<div class="block find"><span class="tag">${String(i + 1).padStart(2, '0')}${svc ? ' · ' + esc(svc) : ''}</span><div style="margin-top:5px">${rich(text)}</div></div>`;
      }).join('')}
    </div>
    <div class="footer"><span>October · Growth Snapshot</span><span></span></div>
  </section>` : '';

  const sectionPages = sections.map((sec, i) => {
    const img = featured[i + 1];
    return `
  <section class="page">
    <div class="panelhead"><span class="no">${i + 1}</span><h3>${esc(sec.title || 'Opportunity')}</h3><span class="svc">${esc(sec.service || '')}</span></div>
    ${img ? `<img class="sec-img" src="${esc(img)}" alt="">` : ''}
    ${sec.finding ? `<div class="block find"><span class="tag">What we found</span><div style="margin-top:6px">${rich(sec.finding)}</div></div>` : ''}
    ${sec.idea ? `<div class="block idea"><span class="tag">An idea we'd run</span><div style="margin-top:6px">${rich(sec.idea)}</div></div>` : ''}
    ${sec.opportunity ? `<div class="opp"><span class="arrow">→</span><div><span class="strong">The opportunity:</span> ${rich(sec.opportunity)}</div></div>` : ''}
    <div class="footer"><span>October · Growth Snapshot</span><span></span></div>
  </section>`;
  }).join('');

  const cta = `
  <section class="page">
    ${masthead(opts.sample ? 'Sample report' : 'Prepared by October')}
    <div class="cta" style="margin-top:40px">
      <div class="kicker" style="color:var(--accent)">Your next 20 minutes</div>
      <h2 style="margin-top:10px">We've done the first hour of thinking.<br>Let's walk through it together.</h2>
      <p class="sub">This snapshot is the shortlist. On a short call we'll turn it into a prioritised 90-day plan — which moves come first, what they'd cost, and what "good" looks like. No pitch deck, just your plan.</p>
      ${opts.bookUrl ? `<a class="btn" href="${esc(opts.bookUrl)}">Book your walkthrough →</a>` : '<span class="btn">Book your walkthrough →</span>'}
    </div>
    <div style="margin-top:26px" class="small"><span class="strong">How we made this:</span> October runs its own marketing-intelligence platform. We pointed it at your public website, then a human reviewed it before it reached you. Everything here is a starting point to pressure-test on the call.</div>
    <div class="footer"><span>October · octobercomms.com · ${esc(contact)}</span><span></span></div>
  </section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${FONT_CSS}\n${STYLE}</style></head><body>${cover}${summaryPage}${sectionPages}${cta}</body></html>`;
}

module.exports = { renderReportHtml };
