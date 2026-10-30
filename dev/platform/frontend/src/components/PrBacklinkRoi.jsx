// What a press campaign actually earned in links.
//
// This panel used to lead on "New RDs" in bold: every referring domain the
// whole site gained in the 21 days after a release went out. Nothing in that
// number checks the linking domain was pitched, or that the link points at
// the release. A directory listing, a supplier page and a scraper all counted
// as press coverage, two releases three weeks apart both claimed the same
// domains, and `first_seen` is DataForSEO's DISCOVERY date, so a site newly
// indexed dumps years of existing domains into one window. One campaign was
// reading 939, which is not a number any press release has ever earned.
//
// The honest figure was already being computed and simply not displayed:
// `pitched_rds`, the count of earned domains matching an outlet the campaign
// actually emailed. That is what leads now. It is a smaller number — 0 to 4
// for a typical campaign rather than dozens — because it is the real one, and
// a figure that goes into a client report has to be defensible.
//
// The window total is kept beside it, named for what it is and not bolded, so
// the context is there without the wrong number being the headline.

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
          No campaign has launched yet. Once a release goes out, the outlets you pitched that
          then linked to {clientId ? 'this client' : 'the site'} appear here.
        </p>
      </div>
    );
  }

  const totalPitched = rows.reduce((n, c) => n + Number(c.pitched_rds || 0), 0);
  const totalRecipients = rows.reduce((n, c) => n + Number(c.recipients || 0), 0);

  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="table">
        <thead>
          <tr>{['Campaign', 'Launched', 'Pitched', 'Linked back', 'Hit rate', `All new domains (${WINDOW_DAYS}d)`]
            .map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(c => {
            const pitched = Number(c.pitched_rds || 0);
            const recipients = Number(c.recipients || 0);
            // Hit rate against outlets emailed, which is the question an
            // account lead is actually asking: of the people we approached,
            // how many ran it.
            const rate = recipients ? (pitched / recipients) : null;
            return (
              <tr key={c.press_release_id}>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title || '(untitled release)'}
                </td>
                <td className="text-subtle">{formatDate(c.launch_at)}</td>
                <td className="text-subtle">{recipients}</td>
                <td><strong className="text-ink">{pitched}</strong></td>
                <td><strong className="text-accent">{rate == null ? '—' : `${Math.round(rate * 100)}%`}</strong></td>
                {/* Deliberately quiet. This is every domain the site gained in
                    the window, most of which has nothing to do with the
                    release; it is context, not a result. */}
                <td className="text-subtle">{c.new_rds}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="body-xs text-subtle" style={{ padding: 'var(--s3) var(--s5)' }}>
        {totalPitched} pitched outlet{totalPitched === 1 ? '' : 's'} linked back across {rows.length} campaign
        {rows.length === 1 ? '' : 's'}, from {totalRecipients} approached. A domain counts when it matches an
        outlet this campaign emailed and its first backlink appeared within {WINDOW_DAYS} days of launch.
        The last column is every new referring domain in that window, whatever its source — it is not
        attributable to the campaign, which is why it is not the headline.
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
