import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import Sparkline from '../Sparkline';

// Organic → Performance → Backlinks (Phase E2). Reads the 3-day snapshots
// persisted by the E1 sweep (dfs_backlinks_summary / dfs_referring_domains)
// for the trend + RD table, and hits the two live DFS quick-win endpoints
// (anchor text, dofollow split) for the profile-health panels. "Refresh
// snapshot" runs an immediate pull instead of waiting for the cron.
//
// Pre-first-sweep the snapshot reads return an empty state; the live
// endpoints 503 until the DataForSEO Backlinks cutover (1 Jul 2026), which
// this handles gracefully rather than erroring the whole tab.

const MONEY_WORDS = ['buy', 'price', 'cost', 'cheap', 'best', 'top', 'deal', 'discount', 'shop', 'order', 'service', 'services', 'hire', 'quote', 'near me'];

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-GB');
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

// Classify an anchor as brand / commercial / other for the roll-up.
function classifyAnchor(anchor, brandTokens) {
  const a = (anchor || '').toLowerCase();
  if (brandTokens.some(t => t && a.includes(t))) return 'brand';
  if (MONEY_WORDS.some(w => a.includes(w))) return 'commercial';
  return 'other';
}

// One column of the new/lost feed — a small referring-domains table with a
// coloured dot per row and a single date column (first-seen for new,
// last-seen for lost).
function ChangeList({ title, colour, dateLabel, rows, dateKey, empty }) {
  return (
    <div className="card">
      <div className="caption" style={{ marginBottom: 12, color: colour }}>{title}</div>
      {!rows?.length ? (
        <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{empty}</div>
      ) : (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Domain</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Rank</th>
              <th style={{ padding: '6px 8px' }}>{dateLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.domain + i} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))' }}>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: colour, marginRight: 6, verticalAlign: 'middle' }} />
                  <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{d.domain}</a>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{d.rank == null ? '—' : d.rank}</td>
                <td style={{ padding: '6px 8px' }}>{fmtDate(d[dateKey])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function BacklinksPanel({ clientId, clientName, domain }) {
  const { readOnly } = useAuth();
  const [trend, setTrend] = useState(null);
  const [rds, setRds] = useState(null);
  const [changes, setChanges] = useState(null);
  const [anchors, setAnchors] = useState(null);
  const [anchorsMsg, setAnchorsMsg] = useState('');
  const [split, setSplit] = useState(null);
  const [splitMsg, setSplitMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [clientId]);

  async function loadAll() {
    setLoading(true);
    setErr('');
    // Snapshot reads (cheap, from our tables).
    try {
      const [t, r, c] = await Promise.all([
        api.get(`/seo/clients/${clientId}/backlinks/trend`),
        api.get(`/seo/clients/${clientId}/backlinks/referring-domains?limit=50`),
        api.get(`/seo/clients/${clientId}/backlinks/changes?limit=100`),
      ]);
      setTrend(t);
      setRds(r);
      setChanges(c);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
    // Live quick-win reads (may 503 pre-cutover) — independent, non-fatal.
    api.get(`/seo/clients/${clientId}/anchor-text`)
      .then(d => setAnchors(d.anchors || []))
      .catch(e => setAnchorsMsg(e.message));
    api.get(`/seo/clients/${clientId}/dofollow-split`)
      .then(setSplit)
      .catch(e => setSplitMsg(e.message));
  }

  async function refreshSnapshot() {
    setRefreshing(true);
    setErr('');
    try {
      await api.post(`/seo/clients/${clientId}/backlinks/refresh`, {});
      await loadAll();
    } catch (e) { setErr(e.message); }
    finally { setRefreshing(false); }
  }

  const latest = trend?.latest;
  const history = trend?.history || [];
  const rdSeries = history.map(h => Number(h.referring_domains_total) || 0);
  const hasSnapshot = !!latest;
  // Anchor text + dofollow split are LIVE pulls (below), independent of the
  // stored 3-day snapshot. When they've loaded but no summary snapshot exists
  // yet, don't show the scary "nothing here" banner alongside real data.
  const hasLiveData = !!(anchors && anchors.length) || !!split;

  // Anchor roll-up by brand / commercial / other.
  const brandTokens = (clientName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3);
  const rollup = { brand: 0, commercial: 0, other: 0 };
  (anchors || []).forEach(a => { rollup[classifyAnchor(a.anchor, brandTokens)] += (a.backlinks || 0); });
  const rollupTotal = rollup.brand + rollup.commercial + rollup.other;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div className="caption">Backlinks</div>
          <h2 className="h2 mt-2">Backlink profile{domain ? ` — ${domain}` : ''}</h2>
        </div>
        <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: refreshSnapshot, disabled: refreshing || loading })}>
          {refreshing ? 'Refreshing…' : 'Refresh snapshot'}
        </button>
      </div>
      <p className="body-sm text-muted mt-2" style={{ maxWidth: 760, marginBottom: 20 }}>
        Snapshotted every 3 days from DataForSEO. The trend and referring-domains table read the stored
        snapshots; anchor text and the dofollow split are pulled live. Use <strong>Refresh snapshot</strong> to
        capture a fresh cycle now rather than waiting for the scheduler.
      </p>

      {err && <div className="card text-negative" style={{ fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {loading && !trend && (
        <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading snapshots…</div>
      )}

      {!loading && !hasSnapshot && !hasLiveData && (
        <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
          No backlink snapshot captured yet. The 3-day sweep will populate this automatically, or hit
          <strong> Refresh snapshot</strong> to run one now.
        </div>
      )}
      {!loading && !hasSnapshot && hasLiveData && (
        <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
          Headline totals, the trend and the referring-domains table populate from the stored 3-day snapshot —
          none captured yet, so hit <strong>Refresh snapshot</strong> to store one. The anchor text and dofollow
          split below are pulled live.
        </div>
      )}

      {hasSnapshot && (
        <>
          {/* Headline cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            <div className="card">
              <div className="metric">{fmt(latest.backlinks_total)}</div>
              <div className="caption">Total backlinks</div>
            </div>
            <div className="card">
              <div className="metric">{fmt(latest.referring_domains_total)}</div>
              <div className="caption">Referring domains</div>
              {rdSeries.length >= 2 && (
                <div style={{ marginTop: 8 }}><Sparkline values={rdSeries} width={140} height={30} /></div>
              )}
            </div>
            <div className="card">
              <div className="metric">{latest.dofollow_ratio == null ? '—' : `${Math.round(latest.dofollow_ratio * 100)}%`}</div>
              <div className="caption">Dofollow</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>healthy ≈ 60–80%</div>
            </div>
            <div className="card">
              <div className="metric">{latest.spam_score == null ? '—' : latest.spam_score}</div>
              <div className="caption">Spam score</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>lower is better</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 24 }}>
            Snapshot captured {fmtDate(latest.captured_at)} · domain rank {latest.rank == null ? '—' : latest.rank}
          </div>

          {/* Referring domains table */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="caption" style={{ marginBottom: 12 }}>Top referring domains ({rds?.domains?.length || 0})</div>
            {!rds?.domains?.length ? (
              <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No referring domains in the latest snapshot.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 8px' }}>Domain</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Rank</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Links</th>
                    <th style={{ padding: '6px 8px' }}>Follow</th>
                    <th style={{ padding: '6px 8px' }}>First seen</th>
                    <th style={{ padding: '6px 8px' }}>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rds.domains.map((d, i) => (
                    <tr key={d.domain + i} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{d.domain}</a>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{d.rank == null ? '—' : d.rank}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(d.backlinks_count)}</td>
                      <td style={{ padding: '6px 8px' }}>{d.dofollow ? 'dofollow' : 'nofollow'}</td>
                      <td style={{ padding: '6px 8px' }}>{fmtDate(d.first_seen)}</td>
                      <td style={{ padding: '6px 8px' }}>{fmtDate(d.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* New / lost referring domains since last snapshot (E3) */}
          <div style={{ marginBottom: 24 }}>
            <div className="caption" style={{ marginBottom: 4 }}>Since last snapshot</div>
            {!changes?.previous ? (
              <div className="card" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
                Only one snapshot so far — the new / lost feed appears once a second cycle has run (the next
                3-day sweep, or hit <strong>Refresh snapshot</strong> twice).
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ChangeList
                  title={`New (${changes.gained.length})`}
                  colour="var(--positive)"
                  dateLabel="First seen"
                  rows={changes.gained}
                  dateKey="first_seen"
                  empty="No new referring domains this cycle."
                />
                <ChangeList
                  title={`Lost (${changes.lost.length})`}
                  colour="var(--negative)"
                  dateLabel="Last seen"
                  rows={changes.lost}
                  dateKey="last_seen"
                  empty="No lost referring domains this cycle."
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Anchor text + dofollow split — live quick-win panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Anchor text */}
        <div className="card">
          <div className="caption" style={{ marginBottom: 12 }}>Anchor text</div>
          {anchorsMsg && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{anchorsMsg}</div>}
          {!anchorsMsg && !anchors && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}
          {anchors && !anchors.length && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No anchors returned.</div>}
          {anchors && anchors.length > 0 && (
            <>
              {/* Brand / commercial / other roll-up */}
              {rollupTotal > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{ width: `${(rollup.brand / rollupTotal) * 100}%`, background: 'var(--accent)' }} title="Brand" />
                    <div style={{ width: `${(rollup.commercial / rollupTotal) * 100}%`, background: 'var(--warning, #d98a00)' }} title="Commercial" />
                    <div style={{ width: `${(rollup.other / rollupTotal) * 100}%`, background: 'var(--border)' }} title="Other" />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'flex', gap: 12 }}>
                    <span>Brand {Math.round((rollup.brand / rollupTotal) * 100)}%</span>
                    <span>Commercial {Math.round((rollup.commercial / rollupTotal) * 100)}%</span>
                    <span>Other {Math.round((rollup.other / rollupTotal) * 100)}%</span>
                  </div>
                </div>
              )}
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 8px' }}>Anchor</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Links</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Ref. domains</th>
                  </tr>
                </thead>
                <tbody>
                  {anchors.slice(0, 25).map((a, i) => (
                    <tr key={a.anchor + i} style={{ borderBottom: '1px solid var(--border-subtle, var(--border))' }}>
                      <td style={{ padding: '6px 8px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.anchor}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(a.backlinks)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(a.referring_domains)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Dofollow split */}
        <div className="card">
          <div className="caption" style={{ marginBottom: 12 }}>Dofollow / nofollow</div>
          {splitMsg && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{splitMsg}</div>}
          {!splitMsg && !split && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>}
          {split && (
            <div>
              <div className="metric">{split.total ? `${Math.round((split.dofollow / split.total) * 100)}%` : '—'}</div>
              <div className="caption">dofollow of {fmt(split.total)} sampled</div>
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '12px 0 6px' }}>
                <div style={{ width: split.total ? `${(split.dofollow / split.total) * 100}%` : '0%', background: 'var(--accent)' }} />
                <div style={{ width: split.total ? `${(split.nofollow / split.total) * 100}%` : '0%', background: 'var(--border)' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                {fmt(split.dofollow)} dofollow · {fmt(split.nofollow)} nofollow
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>Most natural profiles sit around 60–80% dofollow.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
