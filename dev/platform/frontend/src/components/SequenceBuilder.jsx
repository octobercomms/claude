// Visual sequence builder. A vertical timeline of steps, channel-
// colour-coded, each editable inline. Drag-to-reorder via HTML5 drag.
// "+ Add step" slots in between every pair (and at the bottom)
// drop a new step at exactly that position.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const CHANNELS = [
  { value: 'email',            label: 'Email',              tone: 'accent'  },
  { value: 'linkedin_visit',   label: 'LinkedIn · visit',    tone: 'outline' },
  { value: 'linkedin_connect', label: 'LinkedIn · connect',  tone: 'outline' },
  { value: 'linkedin_message', label: 'LinkedIn · message',  tone: 'outline' },
  { value: 'manual_task',      label: 'Manual task',         tone: 'neutral' },
];

export default function SequenceBuilder({ campaignId }) {
  const toast = useToast();
  const [steps, setSteps] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dirtyMap, setDirtyMap] = useState({});

  async function refresh() {
    try {
      const r = await api.get(`/outreach/campaigns/${campaignId}/sequences`);
      setSteps(r);
      setDirtyMap({});
    } catch (e) { toast(e.message, 'error'); }
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [campaignId]);

  function update(stepId, field, value) {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, [field]: value } : s));
    setDirtyMap(prev => ({ ...prev, [stepId]: true }));
  }

  async function save(step) {
    try {
      await api.put(`/outreach/sequences/${step.id}`, {
        subject:    step.subject,
        body:       step.body,
        delay_days: step.delay_days,
        channel:    step.channel,
      });
      setDirtyMap(prev => { const n = { ...prev }; delete n[step.id]; return n; });
      toast('Step saved.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addStep(channel = 'email', insertAtIndex = null) {
    try {
      const created = await api.post(`/outreach/campaigns/${campaignId}/sequences`, {
        channel, delay_days: 3, subject: '', body: '',
      });
      // If the caller wanted an insert point inside the existing
      // list, reorder so the new step lands at insertAtIndex.
      if (insertAtIndex !== null && steps) {
        const newOrder = [...steps.map(s => s.id)];
        newOrder.splice(insertAtIndex, 0, created.id);
        await api.post(`/outreach/campaigns/${campaignId}/sequences/reorder`, { order: newOrder });
      }
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(step) {
    if (!confirm('Delete this step?')) return;
    try {
      await api.delete(`/outreach/sequences/${step.id}`);
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function reorder(fromId, toId) {
    if (!steps || fromId === toId) return;
    const ids = steps.map(s => s.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx   = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    setSteps(prev => ids.map((id, i) => ({ ...prev.find(s => s.id === id), step_number: i + 1 })));
    try {
      await api.post(`/outreach/campaigns/${campaignId}/sequences/reorder`, { order: ids });
    } catch (e) { toast(e.message, 'error'); refresh(); }
  }

  if (!steps) return <div className="text-subtle">Loading sequence…</div>;

  return (
    <div className="sequence-builder">
      {steps.length === 0 && (
        <div className="empty">
          <div className="h3">No steps yet.</div>
          <p className="body-sm text-muted mt-3">Generate a draft with Claude above, or add steps manually below.</p>
        </div>
      )}

      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <AddSlot onAdd={(ch) => addStep(ch, i)} />
          <StepCard
            step={step}
            dirty={!!dirtyMap[step.id]}
            onUpdate={(field, value) => update(step.id, field, value)}
            onSave={() => save(step)}
            onDelete={() => remove(step)}
            isDragging={dragId === step.id}
            onDragStart={() => setDragId(step.id)}
            onDragEnd={() => setDragId(null)}
            onDragOverStep={() => dragId && dragId !== step.id && reorder(dragId, step.id)}
          />
        </React.Fragment>
      ))}
      <AddSlot onAdd={(ch) => addStep(ch)} />
    </div>
  );
}

function AddSlot({ onAdd }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="sequence-add-slot" onClick={() => setOpen(true)}>
        <span>+ Add step</span>
      </button>
    );
  }
  return (
    <div className="sequence-add-slot open">
      <div className="caption mb-3">Pick a channel</div>
      <div className="row wrap">
        {CHANNELS.map(c => (
          <button key={c.value} className={`chip chip-${c.tone}`}
            style={{ cursor: 'pointer' }}
            onClick={() => { onAdd(c.value); setOpen(false); }}>
            {c.label}
          </button>
        ))}
        <button className="btn-ghost" style={{ marginLeft: 6 }} onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}

function StepCard({ step, dirty, onUpdate, onSave, onDelete, isDragging, onDragStart, onDragEnd, onDragOverStep }) {
  const channel = CHANNELS.find(c => c.value === step.channel) || CHANNELS[0];
  return (
    <div
      className={`sequence-step ${isDragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOverStep(); }}
    >
      <div className="sequence-step-rail">
        <div className="sequence-step-num">{step.step_number}</div>
      </div>
      <div className="sequence-step-body card">
        <div className="row between center mb-3">
          <div className="row wrap" style={{ alignItems: 'center', gap: 8 }}>
            <span className={`chip chip-${channel.tone}`}>{channel.label}</span>
            <div className="caption">Day {step.delay_days}</div>
            {dirty && <div className="caption text-warning">· unsaved</div>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn-ghost" title="Drag to reorder" style={{ cursor: 'grab' }}>⠿</button>
            <button className="btn btn-secondary btn-sm" onClick={onSave} disabled={!dirty}>Save</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          </div>
        </div>

        <div className="grid grid-2 mb-3">
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Channel</label>
            <select className="input" value={step.channel || 'email'} onChange={e => onUpdate('channel', e.target.value)}>
              {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Delay (days from previous)</label>
            <input className="input" type="number" min="0" max="60"
              value={step.delay_days ?? 0}
              onChange={e => onUpdate('delay_days', Number(e.target.value))} />
          </div>
        </div>

        {step.channel === 'email' || !step.channel ? (
          <>
            <div className="field" style={{ margin: 0, marginBottom: 8 }}>
              <label className="field-label">Subject</label>
              <input className="input" value={step.subject || ''}
                onChange={e => onUpdate('subject', e.target.value)} placeholder="Subject line" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Body</label>
              <textarea className="input" style={{ minHeight: 140, resize: 'vertical' }}
                value={step.body || ''}
                onChange={e => onUpdate('body', e.target.value)} placeholder="Email body" />
            </div>
          </>
        ) : (
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Task prompt (what should the AM do?)</label>
            <textarea className="input" style={{ minHeight: 100, resize: 'vertical' }}
              value={step.body || ''}
              onChange={e => onUpdate('body', e.target.value)}
              placeholder="e.g. Send a short personalised connection note mentioning the {{company}} brief." />
          </div>
        )}
      </div>
    </div>
  );
}
