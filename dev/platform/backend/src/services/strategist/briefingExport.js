// Compose a completed Strategist briefing into a single markdown document for
// export (PDF/DOCX via services/chatExport). Two audiences:
//   • internalMarkdown() — verbatim: synthesis + per-pillar analysis + the
//     prioritised task list + a data appendix ("the data behind this briefing").
//   • the client-facing report is generated separately (briefing.clientReport)
//     and exported straight through chatExport.
//
// snapshotToMarkdown() turns the stored data_snapshot (arbitrary per-pillar
// shapes) into a readable evidence appendix — the "fresh page showing all the
// data it used" — without hand-coding a layout per pillar.

const PILLAR_LABEL = { paid: 'Paid', earned: 'Earned', shared: 'Shared', owned: 'Owned', cross: 'Account-wide' };

function titleCase(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function isScalar(v) {
  return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function fmtScalar(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return String(v);
}

// Array of flat objects → a markdown table (union of keys, capped rows).
function objectsToTable(arr, cap = 12) {
  const rows = arr.filter(r => r && typeof r === 'object' && !Array.isArray(r));
  if (!rows.length) return '';
  const keys = [];
  for (const r of rows.slice(0, cap)) for (const k of Object.keys(r)) {
    if (!keys.includes(k) && isScalar(r[k])) keys.push(k);
  }
  if (!keys.length) return '';
  const head = `| ${keys.map(titleCase).join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.slice(0, cap)
    .map(r => `| ${keys.map(k => fmtScalar(r[k])).join(' | ')} |`)
    .join('\n');
  const more = rows.length > cap ? `\n\n_…and ${rows.length - cap} more rows._` : '';
  return `${head}\n${sep}\n${body}${more}`;
}

// Render one value under a bulleted key. Bounded recursion (one nested level)
// so a deep object can't blow up the appendix.
function renderValue(key, value, depth) {
  const pad = '  '.repeat(depth);
  if (isScalar(value)) return `${pad}- **${titleCase(key)}:** ${fmtScalar(value)}`;

  if (Array.isArray(value)) {
    if (!value.length) return `${pad}- **${titleCase(key)}:** —`;
    if (value.every(isScalar)) return `${pad}- **${titleCase(key)}:** ${value.map(fmtScalar).join(', ')}`;
    const table = objectsToTable(value);
    if (table) return `${pad}- **${titleCase(key)}** (${value.length}):\n\n${table}\n`;
    return `${pad}- **${titleCase(key)}:** ${value.length} items`;
  }

  // Plain object
  const entries = Object.entries(value);
  if (!entries.length) return `${pad}- **${titleCase(key)}:** —`;
  if (depth >= 1) {
    // Too deep to keep nesting — summarise scalars inline.
    const inline = entries.filter(([, v]) => isScalar(v)).map(([k, v]) => `${titleCase(k)} ${fmtScalar(v)}`).join(', ');
    return `${pad}- **${titleCase(key)}:** ${inline || `${entries.length} fields`}`;
  }
  const lines = entries.map(([k, v]) => renderValue(k, v, depth + 1));
  return `${pad}- **${titleCase(key)}:**\n${lines.join('\n')}`;
}

function dataBlock(data) {
  if (!data || typeof data !== 'object') return '_No data captured._';
  const entries = Object.entries(data);
  if (!entries.length) return '_No data captured._';
  return entries.map(([k, v]) => renderValue(k, v, 0)).join('\n');
}

function snapshotToMarkdown(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const parts = [];
  if (snapshot.commercial && (snapshot.commercial.revenue || snapshot.commercial.orders)) {
    const c = snapshot.commercial;
    parts.push(`**Commercial headline:** £${Number(c.revenue || 0).toLocaleString('en-GB')} revenue from ${Number(c.orders || 0).toLocaleString('en-GB')} orders (period).`);
  }
  for (const p of snapshot.pillars || []) {
    if (!p || !p.data) continue;
    parts.push(`### ${PILLAR_LABEL[p.pillar] || titleCase(p.pillar || 'Data')}\n\n${dataBlock(p.data)}`);
  }
  return parts.join('\n\n');
}

// Task list as plain bullets (no GFM task-list syntax — renders cleanly in PDF
// and Word). Crucial first, then nice-to-have; each tagged by pillar.
function taskListMarkdown(recs) {
  if (!recs || !recs.length) return '';
  const line = r => `- ${r.done ? '☑' : '☐'} **${PILLAR_LABEL[r.pillar] || titleCase(r.pillar || '')}** — ${r.text}`;
  const crucial = recs.filter(r => r.priority === 'crucial');
  const nice = recs.filter(r => r.priority !== 'crucial');
  const out = [];
  if (crucial.length) out.push(`### Crucial\n${crucial.map(line).join('\n')}`);
  if (nice.length) out.push(`### Nice to have\n${nice.map(line).join('\n')}`);
  return out.join('\n\n');
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Full internal briefing as one markdown document. The export shell (chatExport)
// adds the masthead with the client name + date, so the body starts at ##.
function internalMarkdown({ briefing, recommendations }) {
  const sections = Array.isArray(briefing.sections) ? briefing.sections : [];
  const period = briefing.period_start && briefing.period_end
    ? `${fmtDate(briefing.period_start)} – ${fmtDate(briefing.period_end)}`
    : '';
  const parts = [];

  parts.push(`## Overview`);
  if (period) parts.push(`_Period: ${period}_`);
  parts.push(briefing.synthesis || '_No synthesis._');

  const tasks = taskListMarkdown(recommendations);
  if (tasks) parts.push(`## Priorities — task list\n\n${tasks}`);

  for (const s of sections) {
    const label = PILLAR_LABEL[s.pillar] || s.label || s.pillar;
    if (s.ok && s.markdown) {
      parts.push(`## ${label}\n\n${s.markdown}`);
    } else {
      parts.push(`## ${label}\n\n_No ${label} data this period._`);
    }
  }

  const appendix = snapshotToMarkdown(briefing.data_snapshot);
  if (appendix) {
    parts.push(`## Appendix — the data behind this briefing\n\n_Every figure above is drawn from the stored data below._\n\n${appendix}`);
  }

  return parts.join('\n\n');
}

module.exports = { internalMarkdown, snapshotToMarkdown, taskListMarkdown };
