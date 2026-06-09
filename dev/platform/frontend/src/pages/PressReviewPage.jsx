import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Public, token-gated press-release approval page — no login. Plain fetch.
function fmtDate(d) { if (!d) return ''; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

export default function PressReviewPage() {
  const { token } = useParams();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found
  const [approver, setApprover] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Press release — approval';
    fetch(`/api/pr-portal/review/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); if (d) document.title = `${d.title} — Approval`; })
      .catch(() => setData(null));
  }, [token]);

  async function approve() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/pr-portal/review/${encodeURIComponent(token)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approver }),
      });
      if (r.ok) setData(await r.json());
    } finally { setSubmitting(false); }
  }

  const wrap = { maxWidth: 760, margin: '0 auto', padding: '40px 20px', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#111' };
  if (data === undefined) return <div style={wrap}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (data === null) return <div style={wrap}><h1>Not found</h1><p style={{ color: '#6b7280' }}>This approval link is invalid or has expired.</p></div>;

  const approved = data.status === 'approved' || data.status === 'sent';
  const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,.04)' };

  return (
    <div style={{ background: '#f7f7f8', minHeight: '100vh' }}>
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ margin: '0 0 2px', fontSize: 26 }}>{data.title}</h1>
          <p style={{ margin: '0 0 18px', color: '#6b7280', fontSize: 14 }}>{data.client_name ? `${data.client_name} · ` : ''}Press release for approval</p>
          <div style={{ fontSize: 15, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: data.body_html || '<p><em>Draft not written yet.</em></p>' }} />
          <hr style={{ margin: '22px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
          {approved ? (
            <p style={{ display: 'inline-block', fontSize: 14, padding: '6px 12px', borderRadius: 20, background: '#dcfce7', color: '#166534' }}>
              ✓ Approved{data.approved_by ? ` by ${data.approved_by}` : ''}{data.approved_at ? ` on ${fmtDate(data.approved_at)}` : ''}
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Your name" style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15 }} />
                <button onClick={approve} disabled={submitting} style={{ background: '#166534', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}>{submitting ? 'Approving…' : 'Approve this release'}</button>
              </div>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 10 }}>Spotted something? Reply to the email this link came from and we'll revise it.</p>
            </>
          )}
        </div>
        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 12, marginTop: 18 }}>October Comms.</p>
      </div>
    </div>
  );
}
