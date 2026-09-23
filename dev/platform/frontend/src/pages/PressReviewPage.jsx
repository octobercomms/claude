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

  const wrap = { maxWidth: 760, margin: '0 auto', padding: 'var(--s8) var(--s5)', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#111' };
  if (data === undefined) return <div style={wrap}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (data === null) return <div style={wrap}><h1>Not found</h1><p style={{ color: '#6b7280' }}>This approval link is invalid or has expired.</p></div>;

  const approved = data.status === 'approved' || data.status === 'sent';
  const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 'var(--r-md)', padding: 'var(--s7)', boxShadow: '0 1px 3px rgba(0,0,0,.04)' };

  return (
    <div style={{ background: '#f7f7f8', minHeight: '100vh' }}>
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ margin: '0 0 var(--s1)', fontSize: 'var(--fs-section)' }}>{data.title}</h1>
          <p style={{ margin: '0 0 var(--s5)', color: '#6b7280', fontSize: 'var(--fs-body)' }}>{data.client_name ? `${data.client_name} · ` : ''}Press release for approval</p>
          <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: data.body_html || '<p><em>Draft not written yet.</em></p>' }} />
          <hr style={{ margin: 'var(--s6) 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
          {approved ? (
            <p style={{ display: 'inline-block', fontSize: 'var(--fs-body)', padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-lg)', background: '#dcfce7', color: '#166534' }}>
              ✓ Approved{data.approved_by ? ` by ${data.approved_by}` : ''}{data.approved_at ? ` on ${fmtDate(data.approved_at)}` : ''}
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Your name" style={{ padding: 'var(--s2) var(--s3)', border: '1px solid #d1d5db', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)' }} />
                <button onClick={approve} disabled={submitting} style={{ background: '#166534', color: '#fff', border: 'none', padding: 'var(--s3) var(--s5)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-body)' }}>{submitting ? 'Approving…' : 'Approve this release'}</button>
              </div>
              <p style={{ fontSize: 'var(--fs-body)', color: '#6b7280', marginTop: 'var(--s3)' }}>Spotted something? Reply to the email this link came from and we'll revise it.</p>
            </>
          )}
        </div>
        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 'var(--fs-caption)', marginTop: 'var(--s5)' }}>October Comms.</p>
      </div>
    </div>
  );
}
