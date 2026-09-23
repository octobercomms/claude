import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Every proposal and where it sits. Sorted by what needs Daniel: opened and
// unanswered first, because that is the 24-hour window that decides most wins.
const STATUS = {
  draft: { label: 'Draft', tone: 'var(--text-subtle)' },
  sent: { label: 'Sent, unopened', tone: 'var(--text-subtle)' },
  viewed: { label: 'Opened, no reply', tone: 'var(--accent)' },
  replied: { label: 'Replied', tone: 'var(--positive)' },
  accepted: { label: 'Accepted', tone: 'var(--positive)' },
  lost: { label: 'Lost', tone: 'var(--negative)' },
};
const ORDER = { viewed: 0, sent: 1, draft: 2, replied: 3, accepted: 4, lost: 5 };

export default function ProposalsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get('/proposals').then(setRows).catch(e => { toast(e.message, 'error'); setRows([]); });
  }, []); // eslint-disable-line

  if (rows === null) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;
  const sorted = [...rows].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || new Date(b.created_at) - new Date(a.created_at));
  const won = rows.filter(r => r.status === 'accepted').length;
  const sent = rows.filter(r => r.sent_at).length;
  const opened = rows.filter(r => r.first_opened_at).length;
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
  const hrs = (a, b) => {
    if (!a || !b) return '—';
    const h = (new Date(b) - new Date(a)) / 3600000;
    return h < 1 ? '<1h' : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  };

  return (
    <div>
      <div className="row wrap mb-4" style={{ gap: 'var(--s5)' }}>
        <Stat n={sent} label="sent" />
        <Stat n={sent ? `${Math.round((opened / sent) * 100)}%` : '—'} label="opened" />
        <Stat n={sent ? `${Math.round((won / sent) * 100)}%` : '—'} label="accepted" />
      </div>
      {!rows.length ? (
        <div className="card"><div className="text-subtle" style={{ padding: 'var(--s5)' }}>No proposals yet. Open a lead, mark the call booked, then hit <strong>Draft proposal</strong>.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Company</th><th>Status</th><th>Sent</th><th>Time to open</th><th>Opens</th><th>Read</th><th>On pricing</th></tr></thead>
            <tbody>
              {sorted.map(r => {
                const st = STATUS[r.status] || STATUS.draft;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/proposals/${r.id}`)}>
                    <td className="strong">{r.company_name || r.lead_url}</td>
                    <td><span style={{ color: st.tone, fontWeight: 700 }}>{st.label}</span></td>
                    <td className="text-muted">{fmt(r.sent_at)}</td>
                    <td className="text-muted">{hrs(r.sent_at, r.first_opened_at)}</td>
                    <td className="text-muted">{r.open_count || 0}</td>
                    <td className="text-muted">{r.seconds ? `${Math.round(r.seconds / 60)}m` : '—'}</td>
                    <td className="text-muted">{r.pricing_seconds ? `${r.pricing_seconds}s` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label }) {
  return <div><div className="h2">{n}</div><div className="caption">{label}</div></div>;
}
