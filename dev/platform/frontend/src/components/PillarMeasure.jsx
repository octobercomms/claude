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
function fmtShare(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0 && pct < 1) return '<1% of the account';
  return `${Math.round(pct)}% of the account`;
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

  return (
    <div className="card pillar-measure">
      <div className="pillar-measure-head">
        <div>
          <div className="caption" style={{ color: 'var(--text-subtle)' }}>{label} · contribution</div>
          <div className="body-xs text-subtle" style={{ marginTop: 2 }}>
            What {label.toLowerCase()} channels drove, and their share of the whole account.
          </div>
        </div>
        <div className="pillar-measure-ranges">
          {RANGES.map(r => (
            <button key={r.key} type="button"
              className={`pillar-measure-range${range === r.key ? ' active' : ''}`}
              onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>
      </div>

      {!data && !err && <div className="body-sm text-subtle" style={{ padding: 'var(--s4) 0' }}>Loading…</div>}

      {data && !data.pillars && (
        <div className="body-sm text-subtle" style={{ padding: 'var(--s4) 0' }}>
          No GA4 connector, so there is no channel data to split. Connect GA4 to see what {label.toLowerCase()} is contributing.
        </div>
      )}

      {p && (
        <>
          <div className="pillar-measure-stats">
            {[
              { label: 'Revenue', value: formatMoney(p.revenue, data.currency), share: p.share.revenue },
              { label: 'Orders', value: fmtNum(p.orders), share: p.share.orders },
              { label: 'Sessions', value: fmtNum(p.sessions), share: p.share.sessions },
            ].map(s => (
              <div key={s.label}>
                <div className="caption" style={{ color: 'var(--text-subtle)' }}>{s.label}</div>
                <div className="pillar-measure-value">{s.value}</div>
                <div className="pillar-measure-share">{fmtShare(s.share) || 'no account data'}</div>
              </div>
            ))}
          </div>

          {/* Which channels make up the pillar, because "Paid" is three or four
              different things and the split is usually the finding. */}
          {p.channels.length > 0 && (
            <div className="pillar-measure-channels">
              {p.channels.map(c => (
                <div key={c.channel} className="pillar-measure-channel">
                  <span>{c.channel}</span>
                  <span className="text-subtle">
                    {fmtNum(c.sessions)} sessions · {formatMoney(c.revenue, data.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!p.channels.length && (
            <div className="body-sm text-subtle" style={{ marginTop: 'var(--s3)' }}>
              No {label.toLowerCase()} traffic in this period.
            </div>
          )}

          {/* Same caveat as the Measure panel, because this prints money from
              the same response. A pillar's revenue is a slice of the mixed
              sum, so if the whole is not a true figure in its currency,
              neither is the slice — and this panel is read on its own, with
              Measure nowhere in sight. */}
          {data.currency_unset ? (
            <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>
              Money is shown without a currency: none is set for this client and no connected store reported one.
            </p>
          ) : data.notes && data.notes.length > 0 ? (
            <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>{data.notes.join(' · ')}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
