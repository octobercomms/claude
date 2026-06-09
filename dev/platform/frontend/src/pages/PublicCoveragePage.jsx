import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Public, token-gated client coverage page — no login. Plain fetch (no auth).
function fmtDate(d) { if (!d) return ''; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

export default function PublicCoveragePage() {
  const { token } = useParams();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found

  useEffect(() => {
    document.title = 'Press coverage';
    fetch(`/api/pr-portal/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); if (d) document.title = `${d.client_name} — Press coverage`; })
      .catch(() => setData(null));
  }, [token]);

  const wrap = { maxWidth: 920, margin: '0 auto', padding: '40px 20px', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#111' };
  if (data === undefined) return <div style={wrap}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (data === null) return <div style={wrap}><h1>Not found</h1><p style={{ color: '#6b7280' }}>This coverage link is invalid or has expired.</p></div>;

  const published = data.items.filter((i) => i.published).length;
  const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,.04)' };
  const th = { textAlign: 'left', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', padding: '8px 10px', borderBottom: '2px solid #e5e7eb' };
  const td = { padding: '10px', borderBottom: '1px solid #e5e7eb', fontSize: 14 };

  return (
    <div style={{ background: '#f7f7f8', minHeight: '100vh' }}>
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ margin: '0 0 2px', fontSize: 26 }}>{data.client_name}</h1>
          <p style={{ margin: '0 0 14px', color: '#6b7280', fontSize: 14 }}>Press coverage · {fmtDate(new Date())}</p>
          <div style={{ display: 'flex', gap: 18, marginBottom: 14, fontSize: 14, color: '#6b7280' }}>
            <span><strong style={{ color: '#111', fontSize: 18 }}>{published}</strong> published</span>
            <span><strong style={{ color: '#111', fontSize: 18 }}>{data.items.length}</strong> tracked</span>
          </div>
          <a href={`/api/pr-portal/${encodeURIComponent(token)}/download`} style={{ display: 'inline-block', fontSize: 13, color: '#111', textDecoration: 'none', border: '1px solid #e5e7eb', padding: '6px 12px', borderRadius: 8, marginBottom: 18 }}>↓ Download CSV</a>
          {data.items.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Publication</th><th style={th}>Journalist</th><th style={th}>Country</th><th style={th}>Status</th><th style={th}>Date</th><th style={th}></th></tr></thead>
              <tbody>
                {data.items.map((i, k) => (
                  <tr key={k}>
                    <td style={{ ...td, fontWeight: 600 }}>{i.outlet || '—'}</td>
                    <td style={td}>{i.journalist || '—'}</td>
                    <td style={td}>{i.country || ''}</td>
                    <td style={td}><span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 20, background: i.published ? '#dcfce7' : '#eef2ff', color: i.published ? '#166534' : '#3730a3' }}>{i.status_label}</span></td>
                    <td style={td}>{fmtDate(i.issue_date)}</td>
                    <td style={td}>{i.story_url ? <a href={i.story_url} target="_blank" rel="noreferrer">Read →</a> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#6b7280' }}>No coverage to show yet — check back soon.</p>}
        </div>
        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 12, marginTop: 18 }}>Coverage tracked by October Comms.</p>
      </div>
    </div>
  );
}
