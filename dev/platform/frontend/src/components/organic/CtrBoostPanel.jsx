import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';

// Performance → CTR boosters. The white-hat answer to "behavioural SEO" /
// CTR-manipulation services: rather than faking the click signals Google's
// NavBoost measures, we find pages in Search Console that already rank well but
// are under-clicked for their position (a title/meta gap, not a ranking gap),
// estimate the clicks being left on the table, and have Claude rewrite the
// snippet in the client's voice to earn the real click.
export default function CtrBoostPanel({ clientId }) {
  const [opps, setOpps] = useState([]);
  const [range, setRange] = useState(null);
  const [days, setDays] = useState(28);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(null); // opportunity being rewritten

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId, days]);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/seo/clients/${clientId}/ctr-opportunities?days=${days}`);
      setOpps(r.opportunities || []);
      setRange({ startDate: r.startDate, endDate: r.endDate });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  const totalMissed = opps.reduce((s, o) => s + (o.missed_clicks || 0), 0);
  const quickWins = opps.filter(o => o.position <= 10).length;

  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 'var(--s5)' }}>
        <div>
          <div className="caption">CTR boosters</div>
          <h2 className="h2 mt-2">Pages that rank but don&apos;t get the click</h2>
          <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>
            These pages already rank — they&apos;re just under-clicked for their position. Google&apos;s NavBoost
            rewards results people actually click and stay on (and demotes the ones they bounce from), so the durable
            move isn&apos;t faking traffic — it&apos;s earning the real click with a sharper title and snippet that
            matches intent. Pulled live from Search Console; &quot;Rewrite&quot; drafts new meta copy in the
            client&apos;s voice.
          </p>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          {[7, 28, 90].map(n => (
            <button key={n} onClick={() => setDays(n)} className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} style={{ marginLeft: 4 }}>{n}D</button>
          ))}
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
        <Stat label="Opportunities" value={opps.length} />
        <Stat label="Est. missed clicks / period" value={totalMissed.toLocaleString()} tone={totalMissed ? 'positive' : 'default'} />
        <Stat label="On page 1 (≤10)" value={quickWins} tone={quickWins ? 'positive' : 'default'} />
      </div>

      {loading && !opps.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading Search Console data…</div>
      ) : !opps.length ? (
        <div className="card"><p className="body-sm text-subtle">
          No clear CTR gaps right now — either your snippets are already pulling their weight, or there isn&apos;t
          enough Search Console data in this window. Try a longer range.
        </p></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="caption" style={{ padding: '8px 10px' }}>Query</th>
                <th className="caption" style={{ padding: '8px 10px' }}>Page</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Pos.</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>CTR</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Expected</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Missed</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={{ padding: '8px 10px', fontSize: 13 }}><strong>{o.query}</strong></td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-subtle)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.url ? <a href={o.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>{o.url.replace(/^https?:\/\//, '').slice(0, 50)}</a> : <em>—</em>}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>#{o.position}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', color: 'var(--negative)', fontWeight: 700 }}>{(o.ctr * 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', color: 'var(--text-subtle)' }}>{(o.expected_ctr * 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>
                    <span style={{ background: 'var(--positive-soft)', color: 'var(--positive)', padding: '2px 8px', borderRadius: 'var(--r-pill)', fontWeight: 700 }}>+{o.missed_clicks.toLocaleString()}</span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button onClick={() => setActive(o)} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: '0 6px' }}>Rewrite →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {range && opps.length > 0 && (
        <p className="body-sm text-subtle" style={{ marginTop: 10 }}>
          Search Console window: {range.startDate} → {range.endDate}. Expected CTR is a position-based baseline used
          only to surface under-clicked pages, not a guarantee.
        </p>
      )}

      {active && <RewriteModal clientId={clientId} opp={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function RewriteModal({ clientId, opp, onClose }) {
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentDesc, setCurrentDesc] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setSuggestion(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/ctr-opportunities/rewrite`, {
        query: opp.query,
        url: opp.url,
        current_title: currentTitle.trim() || undefined,
        current_description: currentDesc.trim() || undefined,
        position: opp.position,
        ctr: opp.ctr,
      });
      setSuggestion(r.suggestion);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  function copy(text, key) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Rewrite snippet to win the click</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>{opp.query}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
              #{opp.position} · {(opp.ctr * 100).toFixed(1)}% CTR vs {(opp.expected_ctr * 100).toFixed(1)}% expected · +{opp.missed_clicks.toLocaleString()} clicks on the table
            </div>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div style={{ padding: '4px 0', overflowY: 'auto' }}>
          <p className="body-sm text-muted" style={{ marginTop: 0 }}>
            Optional: paste the live title tag and meta description so Claude rewrites from what&apos;s there. Leave
            blank and it&apos;ll infer plausible current copy from the query and URL.
          </p>
          <label className="caption">Current title tag</label>
          <input value={currentTitle} onChange={e => setCurrentTitle(e.target.value)} placeholder="(optional)"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', margin: '4px 0 12px' }} />
          <label className="caption">Current meta description</label>
          <textarea value={currentDesc} onChange={e => setCurrentDesc(e.target.value)} placeholder="(optional)" rows={2}
            style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', margin: '4px 0 12px', fontFamily: 'inherit', resize: 'vertical' }} />

          <button onClick={run} className="btn btn-primary" disabled={loading}>
            {loading ? 'Drafting…' : suggestion ? 'Re-draft' : 'Draft new snippet'}
          </button>

          {err && <div className="callout callout-danger" style={{ marginTop: 14 }}>{err}</div>}

          {suggestion && (
            <div style={{ marginTop: 18 }}>
              <Suggested label="Meta title" value={suggestion.meta_title} hint={`${(suggestion.meta_title || '').length}/60`} onCopy={() => copy(suggestion.meta_title, 'title')} copied={copied === 'title'} />
              {suggestion.alt_title && (
                <Suggested label="Alternative title" value={suggestion.alt_title} hint={`${(suggestion.alt_title || '').length}/60`} onCopy={() => copy(suggestion.alt_title, 'alt')} copied={copied === 'alt'} />
              )}
              <Suggested label="Meta description" value={suggestion.meta_description} hint={`${(suggestion.meta_description || '').length}/155`} onCopy={() => copy(suggestion.meta_description, 'desc')} copied={copied === 'desc'} />
              {suggestion.rationale && (
                <div style={{ marginTop: 6 }}>
                  <div className="caption mb-2">Why this wins the click</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{suggestion.rationale}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Suggested({ label, value, hint, onCopy, copied }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <div className="caption mb-2">{label} <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· {hint}</span></div>
        <button onClick={onCopy} className="btn btn-ghost btn-sm" style={{ color: copied ? 'var(--positive)' : 'var(--accent)', padding: '0 6px' }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="card" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === 'positive' ? 'var(--positive)'
              : tone === 'negative' ? 'var(--negative)'
              : tone === 'warning'  ? 'var(--warning)'
              : 'var(--text)';
  return (
    <div className="card">
      <div className="caption">{label}</div>
      <div className="metric" style={{ color: colour, marginTop: 4 }}>{value}</div>
    </div>
  );
}
