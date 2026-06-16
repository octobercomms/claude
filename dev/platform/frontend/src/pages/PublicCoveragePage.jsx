import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

// Public, token-gated client coverage page — no login. Plain fetch (no auth).
// Restyled to match the platform's October Marketing Intelligence look
// (yellow accent, black ink, off-white surface) so the page a client sees
// reads as part of the same product they're billed for.

function fmtDate(d) { if (!d) return ''; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

// Mirrors the colour map on the internal Coverage tab so the client sees the
// same visual language: greens for "shipped", oranges for "in motion", reds
// for "no". Anything not listed renders default (black border, white fill).
const STATUS_PILL = {
  published:      { bg: '#e6f4ea', fg: '#1f7a3d', border: '#9bcfa8' },
  download:       { bg: '#e6f4ea', fg: '#1f7a3d', border: '#9bcfa8' },
  confirmed:      { bg: '#fff1d6', fg: '#8c5a00', border: '#f0c98a' },
  pending:        { bg: '#fff1d6', fg: '#8c5a00', border: '#f0c98a' },
  interview_prep: { bg: '#fff1d6', fg: '#8c5a00', border: '#f0c98a' },
  declined:       { bg: '#fde7e7', fg: '#a32020', border: '#f0b3b3' },
  no_response:    { bg: '#fde7e7', fg: '#a32020', border: '#f0b3b3' },
};
function StatusPill({ status, label }) {
  const s = STATUS_PILL[status];
  const style = s
    ? { background: s.bg, color: s.fg, border: `1px solid ${s.border}` }
    : { background: '#fff', color: '#111', border: '1px solid #111' };
  return (
    <span style={{
      ...style, display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{label || status}</span>
  );
}

export default function PublicCoveragePage() {
  const { token } = useParams();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Press coverage';
    fetch(`/api/pr-portal/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); if (d) document.title = `${d.client_name} — Press coverage`; })
      .catch(() => setData(null));
  }, [token]);

  // Filter against the client-facing label rather than the raw status — the
  // backend collapses `download` (magazine scan) and `published` (online URL)
  // into a single "Published" label for clients, and the filter chips need to
  // mirror that grouping. Picking either raw status would split one human-
  // visible bucket into two identical-looking chips with different counts.
  const sorted = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const items = data.items.filter((i) => {
      if (statusFilter !== 'all' && i.status_label !== statusFilter) return false;
      if (!q) return true;
      return [i.outlet, i.journalist, i.story_title, i.story_url, i.country]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
    items.sort((a, b) => {
      if (sort === 'date_asc') return new Date(a.issue_date || 0) - new Date(b.issue_date || 0);
      if (sort === 'outlet') return (a.outlet || '').localeCompare(b.outlet || '');
      if (sort === 'journalist') return (a.journalist || '').localeCompare(b.journalist || '');
      return new Date(b.issue_date || 0) - new Date(a.issue_date || 0);
    });
    return items;
  }, [data, statusFilter, sort, query]);

  // Brand palette — matches index.css design tokens.
  const ink = '#0a0a0a';
  const accent = '#FFD600';
  const surface = '#FAFAF7';
  const cardBorder = '#e5e3dc';
  const subtle = '#6b7280';

  const wrap = { maxWidth: 1100, margin: '0 auto', padding: '40px 24px', fontFamily: "'Brockmann', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif", color: ink };
  if (data === undefined) return <div style={{ background: surface, minHeight: '100vh' }}><div style={wrap}><p style={{ color: subtle }}>Loading…</p></div></div>;
  if (data === null) return <div style={{ background: surface, minHeight: '100vh' }}><div style={wrap}><h1>Not found</h1><p style={{ color: subtle }}>This coverage link is invalid or has expired.</p></div></div>;

  const published = data.items.filter((i) => i.published).length;
  const card = { background: '#fff', border: `1px solid ${cardBorder}`, borderRadius: 12, padding: 28 };
  const th = { textAlign: 'left', color: subtle, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 12px', borderBottom: `2px solid ${cardBorder}` };
  const td = { padding: '12px', borderBottom: `1px solid ${cardBorder}`, fontSize: 14, verticalAlign: 'top' };
  const chipBtn = (active) => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: 'pointer',
    background: active ? ink : '#fff', color: active ? '#fff' : ink, border: `1px solid ${active ? ink : cardBorder}`,
  });

  // Filter chips group by the client-facing label so a single "Published"
  // chip covers both `published` (live URL) and `download` (magazine scan)
  // — the client doesn't care about the internal distinction. Counts sum
  // across every raw status that maps to the same label.
  const presentLabels = [];
  const labelCounts = {};
  data.items.forEach((i) => {
    const lbl = i.status_label || i.status;
    if (!(lbl in labelCounts)) { presentLabels.push(lbl); labelCounts[lbl] = 0; }
    labelCounts[lbl] += 1;
  });

  return (
    <div style={{ background: surface, minHeight: '100vh' }}>
      <div style={wrap}>
        {/* Brand header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <img src="/coverage-logo.gif" alt="October" style={{ height: 46, width: 'auto', display: 'block' }} />
          <span style={{ fontSize: 12, color: subtle }}>Press coverage report</span>
        </header>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <h1 style={{ margin: '0 0 4px', fontSize: 30, letterSpacing: '-0.01em' }}>{data.client_name}</h1>
              <p style={{ margin: 0, color: subtle, fontSize: 13 }}>Press coverage · Updated {fmtDate(new Date())}</p>
            </div>
            <div style={{ display: 'flex', gap: 22, alignItems: 'baseline' }}>
              <div><div style={{ fontSize: 26, fontWeight: 800 }}>{published}</div><div style={{ fontSize: 11, color: subtle, textTransform: 'uppercase', letterSpacing: '.06em' }}>Published</div></div>
              <div><div style={{ fontSize: 26, fontWeight: 800 }}>{data.items.length}</div><div style={{ fontSize: 11, color: subtle, textTransform: 'uppercase', letterSpacing: '.06em' }}>Tracked</div></div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <a href={`/api/pr-portal/${encodeURIComponent(token)}/download`} style={{ ...chipBtn(false), textDecoration: 'none' }}>↓ Download CSV</a>
            <a href={`/api/pr-portal/${encodeURIComponent(token)}/pdf`} style={{ ...chipBtn(false), textDecoration: 'none' }}>↓ Download PDF</a>
          </div>

          {/* Filter + sort row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${cardBorder}` }}>
            <button type="button" style={chipBtn(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>All ({data.items.length})</button>
            {presentLabels.map((lbl) => (
              <button key={lbl} type="button" style={chipBtn(statusFilter === lbl)} onClick={() => setStatusFilter(lbl)}>
                {lbl} ({labelCounts[lbl]})
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coverage…"
              aria-label="Search coverage"
              style={{ padding: '5px 12px', fontSize: 12, border: `1px solid ${cardBorder}`, borderRadius: 999, background: '#fff', color: ink, minWidth: 180 }}
            />
            <label style={{ fontSize: 12, color: subtle }}>Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12, border: `1px solid ${cardBorder}`, borderRadius: 6, background: '#fff', color: ink }}>
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
                <option value="outlet">Publication A→Z</option>
                <option value="journalist">Journalist A→Z</option>
              </select>
            </label>
          </div>

          {sorted.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Publication</th>
                <th style={th}>Journalist</th>
                <th style={th}>Country</th>
                <th style={th}>Status</th>
                <th style={th}>Date</th>
                <th style={th}>Story</th>
              </tr></thead>
              <tbody>
                {sorted.map((i, k) => (
                  <tr key={k}>
                    <td style={{ ...td, fontWeight: 600 }}>{i.outlet || '—'}{i.story_title ? <div style={{ fontWeight: 400, color: '#6b7280', fontSize: 13 }}>{i.story_title}</div> : null}</td>
                    <td style={td}>{i.journalist || '—'}</td>
                    <td style={td}>{i.country || ''}</td>
                    <td style={td}><StatusPill status={i.status} label={i.status_label} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                    <td style={td}>
                      {i.story_url ? (
                        <div>
                          <a href={i.story_url} target="_blank" rel="noreferrer" style={{ color: ink, fontWeight: 600 }}>
                            {i.story_title || 'Read →'}
                          </a>
                          <div style={{ fontSize: 11, color: subtle, marginTop: 2, wordBreak: 'break-all' }}>{i.story_url}</div>
                        </div>
                      ) : (i.story_title || '—')}
                      {i.attachment_url ? (
                        <div style={{ marginTop: 4 }}>
                          <a href={i.attachment_url} target="_blank" rel="noreferrer" style={{ color: ink, fontSize: 12 }}>📎 {i.attachment_filename || 'PDF'}</a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: subtle }}>
            {data.items.length ? (query.trim() ? `No coverage matches “${query.trim()}”.` : 'No coverage matches that filter.') : 'No coverage to show yet — check back soon.'}
          </p>}
        </div>

        <p style={{ textAlign: 'center', color: subtle, fontSize: 12, marginTop: 24 }}>
          Coverage tracked by October Communications · <a href="https://octobercomms.com" style={{ color: subtle }}>octobercomms.com</a>
        </p>
      </div>
    </div>
  );
}
