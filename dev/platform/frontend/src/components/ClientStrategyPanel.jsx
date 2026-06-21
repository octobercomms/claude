// Client dashboard — Marketing strategy. Set the client's business type +
// lifecycle stage to auto-assign the matching strategy playbook, then work
// through its phased checklist (checkboxes + notes + progress). "Tailor with
// Claude" adapts the checklist to this client. Backed by /api/strategy.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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
      toast('Strategy assigned.', 'success');
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
    if (!window.confirm('Tailor this checklist to the client with Claude? It rewrites the items (your ticks are kept where the wording is unchanged).')) return;
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
            <button className="btn btn-secondary btn-sm" onClick={tailor} disabled={busy}>{busy ? '…' : '✦ Tailor with Claude'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPicking(true)}>Change</button>
          </div>
        )}
      </div>

      {showPicker ? (
        <div style={{ marginTop: 10 }}>
          <p className="body-sm text-muted" style={{ marginBottom: 10 }}>
            Set the client's business type and lifecycle stage — we assign the matching strategy playbook.
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
          <div style={{ height: 6, background: 'var(--surface-raised)', borderRadius: 999, overflow: 'hidden', margin: '10px 0' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--positive, #1a7f37)' : 'var(--accent)' }} />
          </div>
          <div className="body" style={{ fontWeight: 600, marginBottom: 2 }}>{strat.template_name}</div>
          {strat.summary && <p className="body-sm text-muted" style={{ marginBottom: 12 }}>{strat.summary}</p>}

          <div className="stack stack-lg">
            {(strat.phases || []).map((ph, pi) => (
              <div key={pi}>
                <div className="caption" style={{ marginBottom: 6 }}>{ph.title}</div>
                <div className="stack stack-sm">
                  {(ph.items || []).map(it => (
                    <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={!!it.done} onChange={e => toggle(it.id, e.target.checked)} style={{ marginTop: 3 }} />
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
