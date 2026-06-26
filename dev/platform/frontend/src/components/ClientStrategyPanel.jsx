// Client dashboard — Marketing strategy. Set the client's business type +
// lifecycle stage to auto-assign the matching SOSTAC playbook, then "Tailor
// with Claude" to adapt it and generate a visual strategic profile — exec
// summary, personas, SWOT, competitor map and quantified objectives — modelled
// on October's hand-written agency strategies. Backed by /api/strategy.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Each SOSTAC phase gets its own colour so the six sections read as distinct
// chapters — a tinted header, a coloured number + title, a coloured spine.
const SOSTAC = {
  'Situation Analysis': { n: 1, color: '#2f6fb0', tint: 'rgba(47,111,176,0.08)' },
  'Objectives':         { n: 2, color: '#2e7d57', tint: 'rgba(46,125,87,0.08)' },
  'Strategy':           { n: 3, color: '#7e57c2', tint: 'rgba(126,87,194,0.08)' },
  'Tactics':            { n: 4, color: '#d2823d', tint: 'rgba(210,130,61,0.08)' },
  'Action':             { n: 5, color: '#c0556b', tint: 'rgba(192,85,107,0.09)' },
  'Control':            { n: 6, color: '#4f7d7d', tint: 'rgba(79,125,125,0.08)' },
};

function Chips({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {items.map((v, i) => <span key={i} className="chip chip-neutral" style={{ fontSize: 10 }}>{v}</span>)}
    </div>
  );
}

function SwotQuad({ title, items, cls }) {
  if (!items?.length) return null;
  return (
    <div className={`card ${cls}`} style={{ padding: 'var(--s4)' }}>
      <div className="caption" style={{ marginBottom: 8 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => <li key={i} className="body-sm" style={{ marginBottom: 4 }}>{it}</li>)}
      </ul>
    </div>
  );
}

function CompetitorCol({ title, blurb, items }) {
  if (!items?.length) return null;
  return (
    <div className="card" style={{ padding: 'var(--s4)' }}>
      <div className="caption" style={{ marginBottom: 2 }}>{title}</div>
      <div className="body-xs text-subtle" style={{ marginBottom: 8 }}>{blurb}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => <li key={i} className="body-sm" style={{ marginBottom: 4 }}>{it}</li>)}
      </ul>
    </div>
  );
}

function Profile({ profile }) {
  const p = profile;
  const hasSwot = p.swot && (p.swot.strengths.length || p.swot.weaknesses.length || p.swot.opportunities.length || p.swot.threats.length);
  const hasComp = p.competitors && (p.competitors.functional.length || p.competitors.emotional.length || p.competitors.situational.length);
  return (
    <div className="stack stack-lg" style={{ marginBottom: 'var(--s7)' }}>
      {p.exec_summary && (
        <div className="card filled">
          <div className="caption" style={{ marginBottom: 8 }}>Executive summary</div>
          <p className="body" style={{ margin: 0 }}>{p.exec_summary}</p>
        </div>
      )}

      {(p.positioning || !!p.key_messages?.length) && (
        <div className="card accent">
          {p.positioning && (
            <>
              <div className="caption" style={{ marginBottom: 6 }}>Positioning</div>
              <p className="body" style={{ margin: '0 0 10px', fontWeight: 600 }}>{p.positioning}</p>
            </>
          )}
          {!!p.key_messages?.length && (
            <>
              <div className="caption" style={{ marginBottom: 6 }}>Key messages</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {p.key_messages.map((m, i) => <li key={i} className="body-sm" style={{ marginBottom: 4 }}>{m}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {!!p.objectives?.length && (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>Objectives</div>
          <div className="metric-grid">
            {p.objectives.map((o, i) => (
              <div key={i} className="card" style={{ padding: 'var(--s4)' }}>
                <div className="body-sm" style={{ fontWeight: 700 }}>{o.metric}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {o.baseline && <span className="body-xs text-subtle">{o.baseline}</span>}
                  {o.baseline && o.target && <span className="text-subtle">→</span>}
                  {o.target && <span className="metric" style={{ fontSize: 22 }}>{o.target}</span>}
                </div>
                {o.timeframe && <div className="body-xs text-subtle" style={{ marginTop: 4 }}>{o.timeframe}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!!p.personas?.length && (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>Audience</div>
          <div className="grid grid-auto">
            {p.personas.map((pe, i) => (
              <div key={i} className="card">
                <span className="chip chip-accent" style={{ fontSize: 10 }}>{pe.label}</span>
                {pe.who && <p className="body-sm" style={{ margin: '8px 0 0' }}>{pe.who}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {pe.age && <span className="chip chip-neutral" style={{ fontSize: 10 }}>🎂 {pe.age}</span>}
                  {pe.budget && <span className="chip chip-neutral" style={{ fontSize: 10 }}>💷 {pe.budget}</span>}
                  {pe.location && <span className="chip chip-neutral" style={{ fontSize: 10 }}>📍 {pe.location}</span>}
                </div>
                {!!pe.values?.length && <Chips items={pe.values} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasSwot && (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>SWOT</div>
          <div className="grid grid-2">
            <SwotQuad title="Strengths" items={p.swot.strengths} cls="success" />
            <SwotQuad title="Weaknesses" items={p.swot.weaknesses} cls="warning" />
            <SwotQuad title="Opportunities" items={p.swot.opportunities} cls="accent" />
            <SwotQuad title="Threats" items={p.swot.threats} cls="danger" />
          </div>
        </div>
      )}

      {hasComp && (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>Competitor landscape</div>
          <div className="grid grid-3">
            <CompetitorCol title="Functional" blurb="Direct alternatives" items={p.competitors.functional} />
            <CompetitorCol title="Emotional" blurb="Rival desires / big-ticket spends" items={p.competitors.emotional} />
            <CompetitorCol title="Situational" blurb="Life events that divert spend" items={p.competitors.situational} />
          </div>
        </div>
      )}

      {!!p.competitor_table?.length && (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>Competitor benchmark</div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Competitor</th><th>Domain</th><th className="num">DA</th><th>How they compete</th></tr></thead>
              <tbody>
                {p.competitor_table.map((c, i) => (
                  <tr key={i}>
                    <td className="strong">{c.name}</td>
                    <td>{c.domain ? <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-subtle)' }}>{c.domain}</a> : '—'}</td>
                    <td className="num">{c.domain_authority ?? '—'}</td>
                    <td className="body-sm">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="body-xs text-subtle" style={{ marginTop: 4 }}>DA = DataForSEO domain rank (0–1000), pulled live where available.</div>
        </div>
      )}

      {p.funnel && (p.funnel.attract.length || p.funnel.convert.length || p.funnel.close.length || p.funnel.retain.length) ? (
        <div>
          <div className="caption" style={{ marginBottom: 8 }}>Demand funnel — tactics by stage</div>
          <div className="grid grid-auto">
            {[['Attract', 'attract'], ['Convert', 'convert'], ['Close', 'close'], ['Retain', 'retain']].map(([label, key], idx) => (
              p.funnel[key].length ? (
                <div key={key} className="card" style={{ padding: 'var(--s4)', borderTop: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 999, background: 'var(--text)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{idx + 1}</span>
                    <div className="h3">{label}</div>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{p.funnel[key].map((t, i) => <li key={i} className="body-sm" style={{ marginBottom: 4 }}>{t}</li>)}</ul>
                </div>
              ) : null
            ))}
          </div>
        </div>
      ) : null}

      {(!!p.target_media?.length || !!p.target_awards?.length) && (
        <div className="grid grid-2">
          {!!p.target_media?.length && (
            <div className="card" style={{ padding: 'var(--s4)' }}>
              <div className="caption" style={{ marginBottom: 8 }}>Target media</div>
              <div className="stack stack-sm">
                {p.target_media.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="body-sm" style={{ fontWeight: 600 }}>{m.outlet}</div>
                      {m.topic && <div className="body-xs text-subtle">{m.topic}</div>}
                    </div>
                    {m.tier && <span className="chip chip-neutral" style={{ fontSize: 10, flex: '0 0 auto' }}>Tier {m.tier}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!p.target_awards?.length && (
            <div className="card" style={{ padding: 'var(--s4)' }}>
              <div className="caption" style={{ marginBottom: 8 }}>Target awards</div>
              <div className="stack stack-sm">
                {p.target_awards.map((a, i) => (
                  <div key={i}>
                    <div className="body-sm" style={{ fontWeight: 600 }}>🏆 {a.award}</div>
                    {a.note && <div className="body-xs text-subtle">{a.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClientStrategyPanel({ clientId }) {
  const toast = useToast();
  const [meta, setMeta] = useState({ business_types: [], lifecycle_stages: [] });
  const [strat, setStrat] = useState(null);
  const [bType, setBType] = useState('');
  const [stage, setStage] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [m, s] = await Promise.all([
        api.get('/strategy/meta'),
        api.get(`/strategy/clients/${clientId}/strategy`),
      ]);
      setMeta(m);
      setStrat(s.strategy || null);
      if (s.strategy) { setBType(s.strategy.business_type || ''); setStage(s.strategy.lifecycle_stage || ''); }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function assign() {
    if (!bType || !stage) { toast('Pick a business type and stage.', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.put(`/strategy/clients/${clientId}/strategy`, { business_type: bType, lifecycle_stage: stage });
      setStrat(r.strategy); setPicking(false);
      toast('Strategy assigned. Tailor it to generate the full profile.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function toggle(itemId, done) {
    try { const r = await api.patch(`/strategy/clients/${clientId}/strategy/items/${itemId}`, { done }); setStrat(r.strategy); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function saveNote(itemId, note) {
    try { const r = await api.patch(`/strategy/clients/${clientId}/strategy/items/${itemId}`, { note }); setStrat(r.strategy); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function tailor() {
    if (!window.confirm('Tailor this strategy to the client with Claude? It rewrites the checklist and (re)generates the exec summary, personas, SWOT, competitor map and objectives. Your ticks are kept where wording is unchanged.')) return;
    setBusy(true);
    try { const r = await api.post(`/strategy/clients/${clientId}/strategy/tailor`, {}); setStrat(r.strategy); toast('Tailored to the client.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  if (!loaded) return null;
  const pct = strat?.progress?.total ? Math.round((strat.progress.done / strat.progress.total) * 100) : 0;
  const showPicker = !strat || picking;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row between center" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="caption">Marketing strategy</div>
        {strat && !picking && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="body-xs text-subtle">{strat.progress.done}/{strat.progress.total} done</span>
            <button className="btn btn-secondary btn-sm" onClick={tailor} disabled={busy}>{busy ? '…' : (strat.profile ? '✦ Re-tailor' : '✦ Tailor with Claude')}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPicking(true)}>Change</button>
          </div>
        )}
      </div>

      {showPicker ? (
        <div style={{ marginTop: 10 }}>
          <p className="body-sm text-muted" style={{ marginBottom: 10 }}>
            Set the client's business type and lifecycle stage — we assign the matching strategy playbook, then Tailor builds the full profile.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: '1 1 200px' }} value={bType} onChange={e => setBType(e.target.value)}>
              <option value="">Business type…</option>
              {meta.business_types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className="input" style={{ flex: '1 1 200px' }} value={stage} onChange={e => setStage(e.target.value)}>
              <option value="">Lifecycle stage…</option>
              {meta.lifecycle_stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn btn-primary" onClick={assign} disabled={busy || !bType || !stage}>{busy ? 'Assigning…' : 'Assign strategy'}</button>
            {strat && <button className="btn btn-secondary" onClick={() => setPicking(false)}>Cancel</button>}
          </div>
        </div>
      ) : (
        <>
          <div style={{ height: 6, background: 'var(--surface-raised)', borderRadius: 999, overflow: 'hidden', margin: '10px 0 16px' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--positive, #1a7f37)' : 'var(--accent)' }} />
          </div>

          {strat.profile && <Profile profile={strat.profile} />}

          {!strat.profile && (
            <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
              <strong>{strat.template_name}</strong>{strat.summary ? ` — ${strat.summary}` : ''}<br />
              <span className="body-sm">Hit <strong>✦ Tailor with Claude</strong> to adapt this to the client and generate the exec summary, personas, SWOT, competitor map and objectives.</span>
            </div>
          )}

          {/* SOSTAC phases — each a colour-coded chapter with the working checklist */}
          <div className="caption" style={{ marginBottom: 10 }}>The SOSTAC plan</div>
          <div className="stack stack-lg">
            {(strat.phases || []).map((ph, pi) => {
              const s = SOSTAC[ph.title] || { n: pi + 1, color: 'var(--accent)', tint: 'var(--accent-soft)' };
              return (
                <div key={pi} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `5px solid ${s.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: s.tint, borderBottom: '1px solid var(--card-border)' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 999, background: s.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flex: '0 0 auto' }}>{s.n}</span>
                    <div className="h2" style={{ color: s.color, margin: 0 }}>{ph.title}</div>
                  </div>
                  <div className="stack stack-sm" style={{ padding: '16px 18px' }}>
                    {(ph.items || []).map(it => (
                      <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <input type="checkbox" checked={!!it.done} onChange={e => toggle(it.id, e.target.checked)} style={{ marginTop: 3, accentColor: s.color }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="body-sm" style={{ textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--text-subtle)' : 'var(--text)' }}>{it.text}</div>
                          <input
                            className="input"
                            style={{ marginTop: 4, fontSize: 12, padding: '4px 8px' }}
                            placeholder="Add a note…"
                            defaultValue={it.note || ''}
                            onBlur={e => { if (e.target.value !== (it.note || '')) saveNote(it.id, e.target.value); }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
