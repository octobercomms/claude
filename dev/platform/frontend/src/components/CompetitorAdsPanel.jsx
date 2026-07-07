// Ads → Competitor ads. Pull a competitor's live Google ads (Ads Transparency
// Center via SerpApi) and read what they're testing + how to counter. Inert
// until a SerpApi key is set. Backed by /api/competitor-ads.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

const REGIONS = ['GB', 'US', 'IE', 'AU', 'CA', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'];

function fmt(ts) { try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; } }

function List({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="caption" style={{ marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((x, i) => <li key={i} className="body-sm" style={{ marginBottom: 3 }}>{x}</li>)}</ul>
    </div>
  );
}

export default function CompetitorAdsPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [configured, setConfigured] = useState(true);
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('GB');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/competitor-ads/clients/${clientId}`);
      setConfigured(r.configured); setRuns(r.runs || []);
      if (!active && r.runs?.length) setActive(r.runs[0]);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function pull(qArg) {
    const q = (typeof qArg === 'string' ? qArg : query).trim();
    if (!q) { toast('Enter a competitor name or domain.', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.post(`/competitor-ads/clients/${clientId}`, { query: q, region });
      setRuns(prev => [r.run, ...prev]); setActive(r.run);
      toast(`Pulled ${r.run.ad_count} ad${r.run.ad_count === 1 ? '' : 's'}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const r = await api.get(`/competitor-ads/clients/${clientId}/suggestions`);
      setSuggestions(r.competitors || []);
      if (!r.competitors?.length) toast('No competitors suggested — check the client has a domain and brief.', 'warning');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSuggesting(false); }
  }
  function useSuggestion(c) {
    const q = c.domain || c.name;
    setQuery(q);
    if (configured) pull(q);
    else toast('Filled the box — add a SerpApi key to pull their ads.', 'warning');
  }

  async function removeRun(id) {
    try { await api.delete(`/competitor-ads/clients/${clientId}/${id}`); const next = runs.filter(r => r.id !== id); setRuns(next); if (active?.id === id) setActive(next[0] || null); }
    catch (e) { toast(e.message, 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  return (
    <div>
      <p className="body mb-4" style={{ maxWidth: 640 }}>
        Pull a competitor's live Google ads from the Ads Transparency Center and let Claude read what angles & offers they're
        testing, which have run longest (their likely winners), and how to counter — feeding your ad creative.
      </p>

      {!configured && (
        <div className="card" style={{ marginBottom: 14, background: 'rgba(154,107,0,0.06)' }}>
          <div className="body-sm">Add a <strong>SerpApi key</strong> in Settings → Integrations (October Outreach) to enable competitor-ad pulls. SerpApi powers the Ads Transparency lookup; it's paid per query.</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 240px' }} placeholder="Competitor advertiser name or domain — e.g. competitor.com"
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') pull(); }} disabled={!configured} />
          <select className="input" style={{ width: 90 }} value={region} onChange={e => setRegion(e.target.value)} disabled={!configured}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => pull(), disabled: busy || !configured })}>{busy ? 'Pulling…' : 'Pull ads'}</button>
          <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: suggest, disabled: suggesting })}>{suggesting ? 'Thinking…' : '✨ Suggest competitors'}</button>
        </div>

        {suggestions && (
          <div style={{ marginTop: 12 }}>
            {!suggestions.length ? (
              <div className="body-sm text-subtle">No suggestions — make sure the client has a domain and brief set.</div>
            ) : (
              <>
                <div className="caption mb-2">Suggested competitors — {configured ? 'look one up' : 'add a SerpApi key to look these up'}</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {suggestions.map((c, i) => (
                    <div key={i} className="card" style={{ padding: '8px 10px', flex: '1 1 220px', minWidth: 200 }}>
                      <div className="row between center" style={{ gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="body-sm" style={{ fontWeight: 700 }}>{c.name}</div>
                          {c.domain && <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.domain}</div>}
                        </div>
                        <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => useSuggestion(c), disabled: busy })}>{configured ? 'Look up' : 'Use'}</button>
                      </div>
                      {c.reason && <div className="body-xs text-muted" style={{ marginTop: 4, lineHeight: 1.4 }}>{c.reason}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {runs.map(r => (
            <button key={r.id} onClick={() => setActive(r)}
              className={`btn btn-sm ${active?.id === r.id ? 'btn-primary' : 'btn-secondary'}`}>
              {r.query} · {r.region} <span style={{ opacity: 0.7 }}>({r.ad_count})</span>
            </button>
          ))}
        </div>
      )}

      {active && (
        <div>
          <div className="row between center" style={{ marginBottom: 8 }}>
            <div className="body-xs text-subtle">{active.query} · {active.region} · {active.ad_count} ads · {fmt(active.created_at)}</div>
            <button className="btn btn-secondary btn-sm" onClick={() => removeRun(active.id)}>Delete</button>
          </div>

          {active.analysis?.overview && (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="body" style={{ margin: 0 }}>{active.analysis.overview}</p>
              <List title="Likely winners (longest-running)" items={active.analysis.longest_running} />
              <List title="Angles they're testing" items={active.analysis.angles} />
              <List title="Counter-ad ideas" items={active.analysis.counter_ideas} />
            </div>
          )}

          {(active.ads || []).length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {active.ads.map((ad, i) => (
                <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {ad.image && <img src={ad.image} alt="" style={{ width: '100%', height: 130, objectFit: 'cover', borderBottom: '1px solid #eee' }} />}
                  <div style={{ padding: 10 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      {ad.format && <span className="chip chip-neutral" style={{ textTransform: 'capitalize' }}>{ad.format}</span>}
                    </div>
                    {ad.text && <div className="body-sm" style={{ marginBottom: 4 }}>{ad.text}</div>}
                    {ad.target_domain && <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.target_domain}</div>}
                    <div className="body-xs text-subtle" style={{ marginTop: 3 }}>
                      {ad.first_shown || ad.last_shown ? `${ad.first_shown || '?'} → ${ad.last_shown || 'now'}` : ''}
                    </div>
                    {ad.details_link && <a href={ad.details_link} target="_blank" rel="noreferrer" className="body-xs text-accent">View ad →</a>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="body-sm text-subtle">No ad creatives returned for that advertiser/region.</div>
          )}
        </div>
      )}

      {!runs.length && configured && <div className="body-sm text-subtle">No pulls yet — enter a competitor above.</div>}
    </div>
  );
}
