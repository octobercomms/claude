import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { parseCsv } from '../utils/csv';

// Three-step contact import wizard used by both Settings → Contacts
// library and the per-client Email → Contacts page. Steps:
//   1. Upload the CSV (parsed in the browser so we can show a preview)
//   2. Map each CSV column to one of our canonical contact fields, plus
//      pick tags that should be applied to every imported row
//   3. Confirm + send. The backend dedupes by email and merges tags so
//      re-imports are safe.
const FIELD_OPTIONS = [
  { value: '', label: '— ignore —' },
  { value: 'email', label: 'Email' },
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'name', label: 'Full name' },
  { value: 'company', label: 'Company / outlet' },
  { value: 'contact_type', label: 'Beat / contact type' },
  { value: 'title', label: 'Title / role' },
  { value: 'location', label: 'Location' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'website', label: 'Website' },
  { value: 'source', label: 'Source' },
  { value: 'notes', label: 'Notes' },
  { value: 'tags', label: 'Tags (comma/semicolon separated)' },
];

// Aliases used to auto-detect a mapping. Lower-case + non-alphanum
// stripped before matching against this dictionary.
const AUTO_DETECT = {
  email: 'email', emailaddress: 'email', e_mail: 'email',
  first: 'first_name', firstname: 'first_name', forename: 'first_name',
  last: 'last_name', lastname: 'last_name', surname: 'last_name',
  name: 'name', fullname: 'name', contact: 'name',
  company: 'company', companyname: 'company', practice: 'company',
  organisation: 'company', organization: 'company', outlet: 'company', publication: 'company',
  type: 'contact_type', contacttype: 'contact_type', beat: 'contact_type', category: 'contact_type',
  role: 'title', position: 'title', jobtitle: 'title', title: 'title',
  city: 'location', location: 'location', address: 'location', country: 'location',
  linkedin: 'linkedin_url', linkedinurl: 'linkedin_url',
  website: 'website', site: 'website', url: 'website',
  source: 'source',
  notes: 'notes', note: 'notes',
  tags: 'tags', topics: 'tags', segments: 'tags', segment: 'tags', lists: 'tags',
};
function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function ImportWizard({
  open,
  onClose,
  onImported,
  allowClients = false,
  defaultClientIds = [],
  clientIdForAttach = null,
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [rawRows, setRawRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [tags, setTags] = useState(new Set());
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState([]);
  const [clients, setClients] = useState([]);
  const [attachClients, setAttachClients] = useState(new Set(defaultClientIds));
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.get('/outreach/tags').then(setKnownTags).catch(() => setKnownTags([]));
    if (allowClients) api.get('/clients').then(setClients).catch(() => setClients([]));
  }, [open, allowClients]);

  useEffect(() => {
    if (!open) {
      setStep(1); setFile(null); setRawRows(null); setHeaders([]); setPreviewRows([]);
      setMapping({}); setTags(new Set()); setTagInput(''); setAttachClients(new Set(defaultClientIds));
      setImporting(false); setErr(null); setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onPickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setErr(null);
    try {
      const text = await f.text();
      const parsedObjects = parseCsv(text);
      if (!parsedObjects.length) {
        setErr('No rows with an email found in this CSV.');
        return;
      }
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const rawHeaders = splitCsvLine(lines[0] || '');
      const sampleRows = lines.slice(1, 6).map(splitCsvLine);
      const auto = {};
      for (const h of rawHeaders) {
        const k = normaliseHeader(h);
        if (AUTO_DETECT[k]) auto[h] = AUTO_DETECT[k];
      }
      setHeaders(rawHeaders);
      setPreviewRows(sampleRows);
      setMapping(auto);
      setRawRows({ totalRows: parsedObjects.length, rawHeaders, lines });
      setStep(2);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  function toggleTag(t) {
    setTags(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }
  function addTypedTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (t) setTags(prev => new Set([...prev, t]));
    setTagInput('');
  }
  function toggleClient(id) {
    setAttachClients(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Rebuild the contacts array honouring the mapping.
  const builtRows = useMemo(() => {
    if (!rawRows) return [];
    const out = [];
    for (let i = 1; i < rawRows.lines.length; i++) {
      const cells = splitCsvLine(rawRows.lines[i]);
      if (!cells.length || cells.every(c => !String(c || '').trim())) continue;
      const o = {};
      rawRows.rawHeaders.forEach((h, idx) => {
        const field = mapping[h];
        if (!field) return;
        const val = String(cells[idx] ?? '').trim();
        if (!val) return;
        if (field === 'tags') {
          o.tags = [...(o.tags || []), ...val.split(/[,;|]/).map(s => s.trim()).filter(Boolean)];
        } else {
          o[field] = val;
        }
      });
      if (tags.size) o.tags = [...(o.tags || []), ...Array.from(tags)];
      if (o.email) out.push(o);
    }
    return out;
  }, [rawRows, mapping, tags]);

  async function runImport() {
    setImporting(true);
    setErr(null);
    try {
      const body = { contacts: builtRows };
      if (clientIdForAttach) body.client_id = clientIdForAttach;
      if (allowClients && attachClients.size) body.attach_clients = Array.from(attachClients);
      const res = await api.post('/outreach/contacts/bulk', body);
      setResult(res);
      onImported?.(res);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const mappingHasEmail = Object.values(mapping).includes('email');

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <div style={eyebrow}>Step {step} of 3</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Import contacts</h2>
          </div>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>

        {err && <div style={errBox}>{err}</div>}

        {step === 1 && (
          <div>
            <p style={hint}>
              Pick a CSV file. The first row should be column headers (email, name, company,
              etc). We'll let you map each column to the right contact field on the next step.
            </p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onPickFile} />
            <div style={{ marginTop: 14 }}>
              <button onClick={() => fileRef.current?.click()} style={btn}>Choose CSV file</button>
              {file && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>{file.name}</span>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={hint}>
              {rawRows?.totalRows} rows detected. Map each column to one of our contact fields.
              Anything mapped to "ignore" is dropped on import. <strong>Email</strong> is required.
            </p>
            <div style={{ overflowX: 'auto', border: '2px solid var(--accent)', borderRadius: 6, marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {headers.map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #ddd', minWidth: 140 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{h}</div>
                        <select
                          value={mapping[h] || ''}
                          onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                          style={select}
                        >
                          {FIELD_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ padding: '6px 10px', borderTop: '1px solid #f4f4f4', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Apply these tags to every imported contact
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                {Array.from(tags).map(t => (
                  <span key={t} style={tagChipOn} onClick={() => toggleTag(t)}>{t} ×</span>
                ))}
                <input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTypedTag(); } }}
                  placeholder="type a tag and press Enter"
                  style={{ ...input, flex: '1 1 200px', minWidth: 160 }}
                />
              </div>
              {!!knownTags.length && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>Existing tags — click to add:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {knownTags.slice(0, 24).filter(t => !tags.has(t.tag)).map(t => (
                      <button key={t.tag} onClick={() => toggleTag(t.tag)} style={tagChip}>
                        {t.tag} <span style={{ opacity: 0.5 }}>· {t.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {allowClients && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Also attach to (optional)
                </div>
                {!clients.length
                  ? <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No clients to choose — contacts will land in the library only.</div>
                  : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {clients.map(c => (
                        <button key={c.id} onClick={() => toggleClient(c.id)}
                          style={attachClients.has(c.id) ? tagChipOn : tagChip}>
                          {attachClients.has(c.id) ? '✓ ' : ''}{c.name}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            )}

            <div style={footer}>
              <button onClick={() => setStep(1)} style={ghostBtn}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setStep(3)} disabled={!mappingHasEmail || !builtRows.length} style={btn}>
                Continue →
              </button>
            </div>
            {!mappingHasEmail && (
              <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 6 }}>Map one column to Email to continue.</div>
            )}
          </div>
        )}

        {step === 3 && !result && (
          <div>
            <p style={hint}>Here's what's about to be imported. Click Import to send it.</p>
            <div style={{ background: 'var(--surface-raised)', border: '2px solid var(--accent)', borderRadius: 6, padding: 14, fontSize: 13, lineHeight: 1.8, marginTop: 10 }}>
              <div><strong>{builtRows.length}</strong> contacts with a valid email</div>
              <div>Library: <strong>add new or merge tags into existing</strong> (re-imports are safe)</div>
              {clientIdForAttach && <div>Attach to: <strong>this client</strong></div>}
              {allowClients && attachClients.size > 0 && (
                <div>Attach to clients: <strong>{Array.from(attachClients).map(id => clients.find(c => c.id === id)?.name || id).join(', ')}</strong></div>
              )}
              {tags.size > 0 && (
                <div>Tags to add to every row: <strong>{Array.from(tags).join(', ')}</strong></div>
              )}
            </div>

            <div style={footer}>
              <button onClick={() => setStep(2)} style={ghostBtn} disabled={importing}>← Back</button>
              <div style={{ flex: 1 }} />
              <button onClick={runImport} disabled={importing} style={importing ? { ...btn, opacity: 0.6 } : btn}>
                {importing ? 'Importing…' : `Import ${builtRows.length} contact${builtRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div>
            <div style={{ padding: 14, background: '#e7f4ea', border: '1px solid #b6dcc1', borderRadius: 6, color: '#1b5e20', fontSize: 13 }}>
              ✓ Imported {result.inserted} new contact{result.inserted === 1 ? '' : 's'}, merged tags into {result.reused} existing.
              {clientIdForAttach && ` Attached to this client.`}
              {allowClients && attachClients.size > 0 && ` Attached to ${attachClients.size} client${attachClients.size === 1 ? '' : 's'}.`}
            </div>
            <div style={footer}>
              <div style={{ flex: 1 }} />
              <button onClick={onClose} style={btn}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Slim CSV line splitter — same quoting rules as utils/csv.js but
// returns one row's worth so the wizard can drive a column-by-column
// preview without re-parsing the whole file twice.
function splitCsvLine(line) {
  const out = []; let cur = ''; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1100, overflowY: 'auto' };
const modal = { background: 'var(--surface)', borderRadius: 8, width: '100%', maxWidth: 880, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 };
const eyebrow = { fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 3 };
const closeBtn = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-subtle)', lineHeight: 1, padding: 4 };
const hint = { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 };
const footer = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid #eee' };
const btn = { background: 'var(--accent)', color: 'var(--text)', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const ghostBtn = { background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--accent)', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const input = { padding: '7px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' };
const select = { padding: '5px 8px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer', width: '100%' };
const tagChip = { padding: '3px 9px', borderRadius: 999, fontSize: 11, border: '2px solid var(--accent)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' };
const tagChipOn = { padding: '3px 9px', borderRadius: 999, fontSize: 11, border: '1px solid #1a1a1a', background: 'var(--text)', color: 'var(--surface)', cursor: 'pointer' };
const errBox = { padding: 10, background: '#fdecea', border: '1px solid #f5c6cb', color: 'var(--negative)', borderRadius: 4, fontSize: 12, marginBottom: 12 };
