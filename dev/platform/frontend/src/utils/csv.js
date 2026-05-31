// CSV helpers shared by the per-client contacts import and the
// workspace-wide Contacts library import on Settings. Header aliases
// are intentionally generous so an import works no matter which export
// tool the AM dropped the CSV out of (Google Contacts, Mautic, etc.).

export function csvEscape(v) {
  const s = String(v ?? '');
  if (/["\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
