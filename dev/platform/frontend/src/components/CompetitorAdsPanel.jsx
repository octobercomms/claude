// Paid → Research → Competitors.
//
// Three things were wrong and they were connected.
//
// The suggestions lived in component state, so leaving the screen lost them
// and the only way back was another Claude call. Quick Start had already
// asked the same question at client setup and kept only the hostnames, so
// the two lists could disagree and the agency paid twice for one answer.
// And the suggestions rendered as a grid of cards with a "Look up" button,
// which is a phrase that tells you nothing about what it will do or what it
// will cost.
//
// So the competitors are a stored table now, shared with Quick Start, with
// a region per row because a UK client's competitors do not all advertise in
// the UK. Pulling opens the ads in a modal rather than pushing the table off
// the screen.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';
import { briefSeedFor } from '../utils/competitorBrief';

const REGIONS = ['GB', 'US', 'IE', 'AU', 'CA', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'];

function fmt(ts) {
  if (!ts) return null;
  try { return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch { return null; }
}

function List({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <div className="caption" style={{ marginBottom: 'var(--s2)' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 'var(--s5)' }}>
        {items.map((x, i) => <li key={i} className="body-sm" style={{ marginBottom: 'var(--s1)' }}>{x}</li>)}
      </ul>
    </div>
  );
}

export default function CompetitorAdsPanel({ clientId, onUseInBrief }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [configured, setConfigured] = useState(true);
  const [competitors, setCompetitors] = useState([]);
  const [runs, setRuns] = useState([]);
  const [viewing, setViewing] = useState(null);   // the run shown in the modal
  const [loaded, setLoaded] = useState(false);
  const [pulling, setPulling] = useState(null);   // competitor id being pulled
  const [suggesting, setSuggesting] = useState(false);
  const [newName, setNewName] = useState('');

  async function load() {
    try {
      const [state, list] = await Promise.all([
        api.get(`/competitor-ads/clients/${clientId}`),
        api.get(`/competitor-ads/clients/${clientId}/competitors`),
      ]);
      setConfigured(state.configured);
      setRuns(state.runs || []);
      setCompetitors(list.competitors || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }

  // Everything is cleared on a client change before the fetch goes out. The
  // panel has shipped the "if nothing is selected, keep what is there" bug
  // before, which keyed on a condition that is false after a switch and so
  // showed one client's research under another client's name.
  useEffect(() => {
    setCompetitors([]); setRuns([]); setViewing(null); setLoaded(false);
    load(); /* eslint-disable-line */
  }, [clientId]);

  // Reads storage. Only calls Claude when the list is empty, or when this
  // button is pressed on a list that already has rows, which is the one case
  // where paying again is what was asked for.
  async function suggest() {
    const more = competitors.length > 0;
    setSuggesting(true);
    try {
      const r = await api.get(`/competitor-ads/clients/${clientId}/suggestions${more ? '?force=1' : ''}`);
      setCompetitors(r.competitors || []);
      if (!r.competitors?.length) toast('Nothing suggested — check the client has a domain and a brief.', 'warning');
      else if (r.from === 'claude') toast(`${r.competitors.length} competitors on the list.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSuggesting(false); }
  }

  async function addByHand() {
    const value = newName.trim();
    if (!value) return;
    try {
      // A domain if it looks like one, otherwise a name. Typing "rival.com"
      // and typing "Rival Supply" are both reasonable things to do here.
      const isDomain = /^[^\s@]+\.[a-z]{2,}(\/|$)/i.test(value.replace(/^https?:\/\//, ''));
      await api.post(`/competitor-ads/clients/${clientId}/competitors`,
        isDomain ? { domain: value } : { name: value });
      setNewName('');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function setRegion(row, region) {
    try {
      await api.patch(`/competitor-ads/clients/${clientId}/competitors/${row.id}`, { region });
      setCompetitors(prev => prev.map(c => c.id === row.id ? { ...c, region } : c));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removeCompetitor(row) {
    try {
      await api.delete(`/competitor-ads/clients/${clientId}/competitors/${row.id}`);
      setCompetitors(prev => prev.filter(c => c.id !== row.id));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function pull(row) {
    const query = row.domain || row.name;
    setPulling(row.id);
    try {
      const r = await api.post(`/competitor-ads/clients/${clientId}`, { query, region: row.region });
      setRuns(prev => [r.run, ...prev]);
      setViewing(r.run);
      await load();
      toast(`Found ${r.run.ad_count} ad${r.run.ad_count === 1 ? '' : 's'}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setPulling(null); }
  }

  function openLastRun(row) {
    const run = runs.find(r => String(r.id) === String(row.last_run_id));
    if (run) setViewing(run);
  }

  async function removeRun(id) {
    try {
      await api.delete(`/competitor-ads/clients/${clientId}/${id}`);
      setRuns(prev => prev.filter(r => r.id !== id));
      setViewing(null);
      await load();
    } catch (e) { toast(e.message, 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;

  return (
    <div>
      <p className="body mb-4" style={{ maxWidth: 640 }}>
        What your competitors are running on Google right now, from the Ads Transparency Center,
        with Claude reading which angles they are testing and which have run longest. Those are
        their likely winners, and they feed your brief.
      </p>

      {!configured && (
        <div className="card" style={{ marginBottom: 'var(--s4)', background: 'rgba(154,107,0,0.06)' }}>
          <div className="body-sm">
            Add a <strong>SerpApi key</strong> in Settings → Integrations to pull ads. The list below
            still works without one; only the pulls are blocked. SerpApi charges per query.
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="row between center" style={{ marginBottom: 'var(--s3)', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <div className="caption">Competitors</div>
          <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 220 }} placeholder="Add a name or domain"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addByHand(); }} />
            <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: addByHand, disabled: !newName.trim() })}>Add</button>
            {/* Named for what it costs. On an empty list it reads the stored
                list first and spends nothing; on a full one it is explicitly
                a second Claude call, so the label says so. */}
            <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: suggest, disabled: suggesting })}
              title={competitors.length
                ? 'Asks Claude for more names on top of the ones already listed.'
                : 'Asks Claude to name this client\'s competitors from its domain and brief.'}>
              {suggesting ? 'Thinking…' : competitors.length ? '✦ Suggest more' : '✦ Suggest competitors'}
            </button>
          </div>
        </div>

        {!competitors.length ? (
          <div className="body-sm text-subtle">
            No competitors yet. Add one above, or let Claude name them from the client&apos;s domain and brief.
            Quick Start fills this in at setup.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Domain</th>
                <th style={{ width: 90 }}>Region</th>
                <th className="num" style={{ width: 110 }}>Ads found</th>
                <th style={{ width: 100 }}>Last pulled</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {competitors.map(row => (
                <tr key={row.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    {row.reason && (
                      <div className="body-xs text-muted" style={{ marginTop: 2, lineHeight: 1.4, maxWidth: 380 }}>{row.reason}</div>
                    )}
                  </td>
                  <td className="body-sm text-subtle">
                    {row.domain || <span title="Claude named this brand but could not place a domain on it. Add one to pull its ads.">—</span>}
                  </td>
                  <td>
                    {/* Per row. A single select above the table meant changing
                        it, pulling, and remembering to change it back. */}
                    <select className="select" style={{ padding: '2px 4px', fontSize: 'var(--fs-caption)' }}
                      value={row.region} onChange={e => setRegion(row, e.target.value)} disabled={readOnly}>
                      {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="num">{row.last_ad_count == null ? '—' : row.last_ad_count}</td>
                  <td className="body-sm text-subtle">{fmt(row.last_pulled_at) || '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 'var(--s2)', justifyContent: 'flex-end' }}>
                      {row.last_run_id && (
                        <button className="btn btn-secondary btn-sm" onClick={() => openLastRun(row)}>View ads</button>
                      )}
                      <button className="btn btn-primary btn-sm"
                        {...roWrite(readOnly, { onClick: () => pull(row), disabled: !configured || pulling === row.id })}
                        title={configured ? 'Queries the Ads Transparency Center. Costs one SerpApi query.' : 'Needs a SerpApi key.'}>
                        {pulling === row.id ? 'Pulling…' : row.last_run_id ? 'Pull again' : 'Pull their ads'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => removeCompetitor(row)} title="Remove from the list">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewing && (
        <AdsModal
          run={viewing}
          onClose={() => setViewing(null)}
          onDelete={() => removeRun(viewing.id)}
          onUseInBrief={onUseInBrief}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

// The pulled ads, over the table rather than instead of it.
//
// On what is shown: the Ads Transparency Center returns a thumbnail, the ad
// text, the destination and the dates it ran. It does not hand over the
// video, and for many image ads the thumbnail is all there is, so every card
// keeps a link out to the original. Rendering a placeholder and calling it
// the ad would be worse than saying where the ad lives.
function AdsModal({ run, onClose, onDelete, onUseInBrief, readOnly }) {
  const seed = briefSeedFor(run);
  const ads = run.ads || [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="h2" style={{ margin: 0 }}>{run.query}</h2>
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
              {run.region} · {run.ad_count} ad{run.ad_count === 1 ? '' : 's'} · pulled {fmt(run.created_at)}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        {run.analysis?.overview && (
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <p className="body" style={{ margin: 0 }}>{run.analysis.overview}</p>
            <List title="Likely winners (longest-running)" items={run.analysis.longest_running} />
            <List title="Angles they're testing" items={run.analysis.angles} />
            <List title="Counter-ad ideas" items={run.analysis.counter_ideas} />
          </div>
        )}

        {ads.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--s3)' }}>
            {ads.map((ad, i) => (
              <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {ad.image
                  ? <img src={ad.image} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', borderBottom: '1px solid var(--card-border)' }} />
                  : (
                    <div style={{ height: 150, display: 'grid', placeItems: 'center', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--card-border)' }}>
                      <span className="body-xs text-subtle">
                        {ad.format === 'video' ? 'Video — open to watch' : 'No preview'}
                      </span>
                    </div>
                  )}
                <div style={{ padding: 'var(--s3)' }}>
                  {ad.format && <span className="chip chip-neutral" style={{ textTransform: 'capitalize', marginBottom: 'var(--s2)' }}>{ad.format}</span>}
                  {ad.text && <div className="body-sm" style={{ marginBottom: 'var(--s1)' }}>{ad.text}</div>}
                  {ad.target_domain && (
                    <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.target_domain}</div>
                  )}
                  {(ad.first_shown || ad.last_shown) && (
                    <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
                      {ad.first_shown || '?'} → {ad.last_shown || 'now'}
                    </div>
                  )}
                  {ad.details_link && (
                    <a href={ad.details_link} target="_blank" rel="noreferrer" className="body-xs text-accent"
                      style={{ display: 'inline-block', marginTop: 'var(--s2)' }}>
                      Open in Ads Transparency ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="body-sm text-subtle">
            Nothing returned for that advertiser in {run.region}. They may not be running Google ads
            there, or the advertiser name may not match how Google has them registered — the domain
            usually works better than the brand name.
          </div>
        )}

        <div className="row end mt-5" style={{ gap: 'var(--s2)' }}>
          <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--negative)' }}
            onClick={onDelete}>Delete this pull</button>
          {onUseInBrief && !!seed && (
            <button className="btn btn-primary"
              {...roWrite(readOnly, { onClick: () => { onUseInBrief(seed); onClose(); } })}>
              Use this in a brief →
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
