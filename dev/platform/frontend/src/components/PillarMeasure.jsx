// What this pillar actually drove, and whether that is a lot.
//
// Measure on the client Dashboard answers "how is the account doing". Each
// PESO page needs that narrowed to itself, and narrowed is the point: dropping
// the whole Measure panel onto four pages would put refund rate and top
// products on the PR page, which is noise wearing the costume of data.
//
// So this is the account's three headline numbers filtered to the pillar's own
// GA4 channels, each with its share of the account. A number on its own ("Paid
// drove 2,000 sessions") says nothing. The share is the half that makes it a
// judgement: 20% of the account, from the channel you are paying for.
//
// It reads the same endpoint the Dashboard's Measure does, so the two can
// never disagree about the period.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { formatMoney } from '../utils/money';

const LABEL = { paid: 'Paid', earned: 'Earned', shared: 'Shared', owned: 'Owned' };

// The ranges the Dashboard's Measure offers, so moving between them is not a
// change of frame.
const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '12m', label: '12 months', days: 365 },
];

const iso = d => d.toISOString().slice(0, 10);

function fmtNum(n) {
  return n == null ? '—' : Math.round(Number(n)).toLocaleString('en-GB');
}

// A share is only meaningful once there is an account to be a share of. Null
// means no sessions at all in the period, where 0% would be a claim the data
// does not support.
// Bare percentage. On one line, "25% of the account orders" reads as a
// mangled sentence; the line says "25% orders" and the tooltip spells out
// what it is a share of.
function fmtShare(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export default function PillarMeasure({ clientId, pillar }) {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    const days = (RANGES.find(r => r.key === range) || RANGES[0]).days;
    const end = iso(new Date());
    const start = iso(new Date(Date.now() - days * 86400000));
    api.get(`/sales-traffic/${clientId}?start=${start}&end=${end}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [clientId, range]);

  if (err) return <div className="card body-sm" style={{ color: 'var(--negative)' }}>{err}</div>;

  const p = data && data.pillars && data.pillars[pillar];
  const label = LABEL[pillar] || pillar;

  // The channel split, as a tooltip. It used to be a stack of rows under the
  // numbers and it is still the finding most of the time — "Paid" is three or
  // four different things — so it moves to hover rather than disappearing.
  const channelTip = p && p.channels.length
    ? p.channels.map(c => `${c.channel}: ${fmtNum(c.sessions)} sessions, ${formatMoney(c.revenue, data.currency)}`).join('\n')
    : `No ${label.toLowerCase()} traffic in this period.`;

  const caveat = !data ? null
    : data.currency_unset
      ? 'Money is shown without a currency: none is set for this client and no connected store reported one.'
      : (data.notes && data.notes.length ? data.notes.join(' · ') : null);

  return (
    <div className="pillar-contrib">
      <span className="pillar-contrib-label" title={`What ${label.toLowerCase()} channels drove, and their share of the whole account.`}>
        {label} · contribution
      </span>

      {!data && !err && <span className="body-xs text-subtle">Loading…</span>}

      {data && !data.pillars && (
        <span className="body-xs text-subtle">
          No GA4 connector, so there is no {label.toLowerCase()} split.
        </span>
      )}

      {p && [
        { label: 'revenue',  value: formatMoney(p.revenue, data.currency), share: p.share.revenue },
        { label: 'orders',   value: fmtNum(p.orders),                      share: p.share.orders },
        { label: 'sessions', value: fmtNum(p.sessions),                    share: p.share.sessions },
      ].map(s => (
        // The share leads and the absolute sits in the tooltip: the share is
        // the bit that answers "is this pillar pulling its weight", and it is
        // what the full-height card led with in colour anyway.
        <span key={s.label} className="pillar-contrib-stat"
          title={`${s.value} ${s.label} — ${fmtShare(s.share) || 'share unknown'} of the whole account\n\n${channelTip}`}>
          <strong>{fmtShare(s.share) || '—'}</strong> {s.label}
        </span>
      ))}

      {caveat && (
        <span className="pillar-contrib-note" title={caveat}>⚠ currency</span>
      )}

      <span className="pillar-measure-ranges">
        {RANGES.map(r => (
          <button key={r.key} type="button"
            className={`pillar-measure-range${range === r.key ? ' active' : ''}`}
            onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
      </span>
    </div>
  );
}
