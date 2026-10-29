// PR → backlinks for one client. Launched press campaigns ranked by referring
// domains earned per recipient inside the 21-day window after launch.
//
// This lived on the old agency Dashboard as a cross-client table and was dead
// there: the endpoint scopes to the caller's visible client ids, and an admin's
// is null (the "all clients" sentinel), which the service reads as "no clients"
// and answers with an empty list. Asking for one client gives it a real array
// and a real answer, and the figures belong beside that client's coverage
// anyway.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';

const WINDOW_DAYS = 21;

export default function PrBacklinkRoi({ clientId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    api.get(`/press/attribution/leaderboard?limit=25&client_id=${encodeURIComponent(clientId)}`)
      .then(r => { if (live) setRows(r.campaigns || []); })
      .catch(err => { if (live) { setError(err.message); setRows([]); } });
    return () => { live = false; };
  }, [clientId]);

  if (rows === null) return <div className="card"><p className="text-subtle" style={{ padding: 'var(--s6)', margin: 0 }}>Loading…</p></div>;
  if (error) return <div className="card"><p className="text-negative" style={{ padding: 'var(--s6)', margin: 0 }}>{error}</p></div>;
  if (!rows.length) {
    return (
      <div className="card">
        <p className="text-subtle" style={{ padding: 'var(--s6)', margin: 0 }}>
          No campaign has launched yet. Once a release goes out, the referring domains it earns in
          the following {WINDOW_DAYS} days appear here.
        </p>
      </div>
    );
  }

  const totalRds = rows.reduce((n, c) => n + Number(c.new_rds || 0), 0);

  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="table">
        <thead>
          <tr>{['Campaign', 'Launched', 'New RDs', 'Dofollow', 'Recipients', 'RDs / recipient'].map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.press_release_id}>
              <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || '(untitled release)'}
              </td>
              <td className="text-subtle">{formatDate(c.launch_at)}</td>
              <td><strong className="text-ink">{c.new_rds}</strong></td>
              <td className="text-subtle">{c.dofollow_rds}</td>
              <td className="text-subtle">{c.recipients}</td>
              <td><strong className="text-accent">{c.rds_per_recipient ?? '—'}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="body-xs text-subtle" style={{ padding: 'var(--s3) var(--s5)' }}>
        {totalRds} referring domain{totalRds === 1 ? '' : 's'} across {rows.length} campaign{rows.length === 1 ? '' : 's'}.
        Counts domains whose first backlink appeared within {WINDOW_DAYS} days of launch. Correlation
        within the standard PR window, not attribution.
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
