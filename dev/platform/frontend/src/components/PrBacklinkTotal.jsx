// What press has earned in links, across every campaign, in three numbers.
//
// This was a screen of its own — Earned → Measure → Reports — holding a
// per-campaign table. The Campaigns reshape put per-campaign attribution on
// each campaign's own Results, which left the screen existing for one thing
// the Results pages cannot show: the total across campaigns. A screen for one
// total is a screen nobody opens, so the total moved here, onto the Earned
// landing, and the screen went.
//
// The figure is `pitched_rds`: a referring domain counts when it matches an
// outlet the campaign actually emailed and its first backlink appeared within
// 21 days of launch. It is deliberately a small number. The old headline was
// every domain the whole site gained in the window, which counted directory
// listings, supplier pages and scrapers as press coverage and once read 939
// for a single release.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import StatStrip from './shells/StatStrip';

const WINDOW_DAYS = 21;

export default function PrBacklinkTotal({ clientId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    api.get(`/press/attribution/leaderboard?limit=200&client_id=${encodeURIComponent(clientId)}`)
      .then(r => { if (live) setRows(r.campaigns || []); })
      .catch(err => { if (live) { setError(err.message); setRows([]); } });
    return () => { live = false; };
  }, [clientId]);

  // Quiet while it loads and quiet when it fails. This sits above the
  // coverage log, which is the work; a spinner or a red box over the top of
  // somebody's actual task for a summary figure is the wrong trade.
  if (rows === null || error) return null;
  if (!rows.length) return null;

  const pitched = rows.reduce((n, c) => n + Number(c.pitched_rds || 0), 0);
  const recipients = rows.reduce((n, c) => n + Number(c.recipients || 0), 0);
  const rate = recipients ? Math.round((pitched / recipients) * 100) : null;

  return (
    <div style={{ marginBottom: 'var(--s5)' }}>
      <StatStrip items={[
        { label: 'Outlets that linked back', value: pitched, feature: true },
        { label: 'Outlets approached', value: recipients },
        { label: 'Hit rate', value: rate == null ? '—' : `${rate}%` },
      ]} />
      <p className="body-xs text-subtle" style={{ marginTop: 'var(--s2)', maxWidth: 720, lineHeight: 1.5 }}>
        Across {rows.length} campaign{rows.length === 1 ? '' : 's'}. A domain counts when it matches an
        outlet that campaign emailed and its first backlink appeared within {WINDOW_DAYS} days of launch.
        Per-campaign detail is on each campaign&apos;s Results.
      </p>
    </div>
  );
}
