// CSV helpers shared by the per-client contacts import and the
// workspace-wide Contacts library import on Settings. Header aliases
// are intentionally generous so an import works no matter which export
// tool the AM dropped the CSV out of (Google Contacts, Mautic, etc.).

export function csvEscape(v) {
  const s = String(v ?? '');
  if (/["\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build a CSV and hand it to the browser as a download.
//
// Every table that exports rolled its own copy of this, and the copies get
// three things wrong that only show up on someone else's machine.
//
// A leading =, +, - or @ makes Excel and Sheets treat a cell as a formula.
// Journalist names, outlet names and the matched-topic strings in these
// exports are scraped from the open web, so the content is not ours and a
// cell beginning "=" is a real possibility rather than a theoretical one. A
// leading apostrophe makes it text again.
//
// A UTF-8 byte-order mark, because Excel on Windows reads a CSV without one
// as the system codepage: a £ becomes Â£ and an accented byline turns to
// mojibake.
//
// And the anchor has to be in the document before it is clicked, or Firefox
// ignores it, with the object URL revoked on the next tick rather than
// immediately, which races the download in Safari.
//
//   downloadCsv('matches-northgate.csv', [['Name', r => r.name]], rows)
export function downloadCsv(filename, columns, rows) {
  const text = buildCsv(columns, rows);
  const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return (rows || []).length;   // rows written, for the toast
}

// The CSV itself, as text. Separate from the download so the escaping and the
// formula guard can be tested without a browser.
export function buildCsv(columns, rows) {
  const lines = [columns.map(([h]) => csvEscape(h)).join(',')];
  for (const row of rows || []) {
    lines.push(columns.map(([, get]) => csvEscape(csvCell(get(row)))).join(','));
  }
  return lines.join('\r\n');
}

// One cell's text, with the formula guard applied.
export function csvCell(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// A filename stem from whatever the export is of: lowercase, hyphenated,
// bounded. "Northgate Studio / Q4" must not reach the filesystem intact.
export function csvSlug(...parts) {
  return parts
    .map(p => String(p ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
    .slice(0, 60) || 'export';
}

// Simple CSV parser. Handles quoted fields with embedded commas / newlines /
// escaped quotes. Maps a flexible set of header aliases to our canonical
// contact fields per the product brief.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const ALIASES = {
    first: 'first_name', firstname: 'first_name', first_name: 'first_name',
    last: 'last_name', lastname: 'last_name', last_name: 'last_name',
    full_name: 'name', name: 'name',
    email_address: 'email', email: 'email', e_mail: 'email',
    company_name: 'company', practice: 'company', company: 'company', organisation: 'company', organization: 'company', outlet: 'company',
    type: 'contact_type', contact_type: 'contact_type', beat: 'contact_type',
    role: 'title', position: 'title', job_title: 'title', title: 'title',
    city: 'location', location: 'location', address: 'location',
    linkedin: 'linkedin_url', linkedin_url: 'linkedin_url',
    notes: 'notes', note: 'notes',
    source: 'source',
    tags: 'tags', topics: 'tags',
  };
  const headers = rows[0].map(h => {
    const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ALIASES[k] || k;
  });
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.length || cells.every(c => !c.trim())) continue;
    const o = {};
    headers.forEach((h, i) => {
      const val = (cells[i] || '').trim();
      if (val) o[h] = val;
    });
    if (!o.email) continue;
    // Tags column → array. Allow comma OR semicolon OR pipe separator since
    // commas inside a CSV cell get escaped by the parser already.
    if (typeof o.tags === 'string') {
      o.tags = o.tags.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
    }
    out.push(o);
  }
  return out;
}
