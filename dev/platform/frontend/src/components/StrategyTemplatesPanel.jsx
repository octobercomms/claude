// Settings → Strategy templates (admin). Edit the seeded strategy-playbook
// library and add your own: name, business type, lifecycle stage, summary, and
// a phased checklist (phases → items). These become the assignable library on
// every client dashboard. Backed by /api/strategy/templates.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const blank = () => ({ name: '', business_type: '', lifecycle_stage: '', summary: '', phases: [{ title: '', items: [''] }] });

export default function StrategyTemplatesPanel() {
  const toast = useToast();
  const [meta, setMeta] = useState({ business_types: [], lifecycle_stages: [] });
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // template object being edited (id present = update)
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [m, t] = await Promise.all([api.get('/strategy/meta'), api.get('/strategy/templates')]);
      setMeta(m); setTemplates(t.templates || []);
    } catch (e) { toast(e.message, 'error'); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  function startEdit(t) {
    setEditing(t ? { ...t, phases: (t.phases || []).map(p => ({ title: p.title, items: [...(p.items || [])] })) } : blank());
  }

  async function save() {
    const e = editing;
    if (!e.name || !e.business_type || !e.lifecycle_stage) { toast('Name, business type and stage are required.', 'error'); return; }
    setSaving(true);
    try {
      const body = { name: e.name, business_type: e.business_type, lifecycle_stage: e.lifecycle_stage, summary: e.summary, phases: e.phases };
      if (e.id) await api.put(`/strategy/templates/${e.id}`, body);
      else await api.post('/strategy/templates', body);
      toast('Template saved.', 'success');
      setEditing(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function remove(t) {
    if (!window.confirm(`Delete "${t.name}"? Clients already assigned keep their copy.`)) return;
    try { await api.delete(`/strategy/templates/${t.id}`); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // phases editing helpers (operate on `editing`)
  const set = (patch) => setEditing(p => ({ ...p, ...patch }));
  const setPhase = (pi, patch) => set({ phases: editing.phases.map((p, i) => i === pi ? { ...p, ...patch } : p) });
  const setItem = (pi, ii, val) => setPhase(pi, { items: editing.phases[pi].items.map((it, i) => i === ii ? val : it) });
  const addItem = (pi) => setPhase(pi, { items: [...editing.phases[pi].items, ''] });
  const delItem = (pi, ii) => setPhase(pi, { items: editing.phases[pi].items.filter((_, i) => i !== ii) });
  const addPhase = () => set({ phases: [...editing.phases, { title: '', items: [''] }] });
  const delPhase = (pi) => set({ phases: editing.phases.filter((_, i) => i !== pi) });

  const typeLabel = (v) => meta.business_types.find(t => t.value === v)?.label || v;
  const stageLabel = (v) => meta.lifecycle_stages.find(s => s.value === v)?.label || v;

  if (editing) {
    return (
      <div style={{ maxWidth: 760 }}>
        <div className="row between center" style={{ marginBottom: 12 }}>
          <h3 className="h3">{editing.id ? 'Edit template' : 'New template'}</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>← Back</button>
        </div>
        <div className="field"><label className="field-label">Name</label>
          <input className="input" value={editing.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Retail · Launch" /></div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}><label className="field-label">Business type</label>
            <select className="input" value={editing.business_type} onChange={e => set({ business_type: e.target.value })}>
              <option value="">Select…</option>
              {meta.business_types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label className="field-label">Lifecycle stage</label>
            <select className="input" value={editing.lifecycle_stage} onChange={e => set({ lifecycle_stage: e.target.value })}>
              <option value="">Select…</option>
              {meta.lifecycle_stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select></div>
        </div>
        <div className="field"><label className="field-label">Summary</label>
          <textarea className="input" style={{ minHeight: 60 }} value={editing.summary || ''} onChange={e => set({ summary: e.target.value })} placeholder="The strategic intent in 1–2 sentences." /></div>

        <div className="caption" style={{ margin: '14px 0 6px' }}>Phases & checklist</div>
        {editing.phases.map((ph, pi) => (
          <div key={pi} className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1, fontWeight: 600 }} value={ph.title} onChange={e => setPhase(pi, { title: e.target.value })} placeholder="Phase title (e.g. Foundations)" />
              <button className="btn btn-secondary btn-sm" onClick={() => delPhase(pi)}>✕ phase</button>
            </div>
            <div className="stack stack-sm" style={{ marginTop: 8 }}>
              {ph.items.map((it, ii) => (
                <div key={ii} className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ flex: 1 }} value={it} onChange={e => setItem(pi, ii, e.target.value)} placeholder="Checklist item" />
                  <button className="btn btn-secondary btn-sm" onClick={() => delItem(pi, ii)}>×</button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={() => addItem(pi)}>+ item</button>
            </div>
          </div>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={addPhase}>+ phase</button>

        <div className="row end mt-5" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="row between center" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p className="body-sm text-muted" style={{ margin: 0, maxWidth: 520 }}>
          The strategy-playbook library. Each is assigned to clients by business type + lifecycle stage on their dashboard.
        </p>
        <button className="btn btn-primary" onClick={() => startEdit(null)}>+ New template</button>
      </div>
      <div className="stack stack-sm">
        {templates.map(t => (
          <div key={t.id} className="card" style={{ padding: '10px 14px' }}>
            <div className="row between center" style={{ gap: 10 }}>
              <div>
                <div className="body" style={{ fontWeight: 600 }}>{t.name} {t.is_seed && <span className="body-xs text-subtle">· seed</span>}</div>
                <div className="body-xs text-subtle">{typeLabel(t.business_type)} · {stageLabel(t.lifecycle_stage)} · {(t.phases || []).reduce((n, p) => n + (p.items || []).length, 0)} items</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(t)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(t)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        {!templates.length && <div className="body-sm text-subtle">No templates yet.</div>}
      </div>
    </div>
  );
}
