// Visual sequence builder. A vertical timeline of steps, channel-
// colour-coded, each editable inline. Drag-to-reorder via HTML5 drag.
// "+ Add step" slots in between every pair (and at the bottom)
// drop a new step at exactly that position.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import RefineChat from './RefineChat';

const CHANNELS = [
  { value: 'email',            label: 'Email',              tone: 'accent'  },
  { value: 'linkedin_visit',   label: 'LinkedIn · visit',    tone: 'outline' },
  { value: 'linkedin_connect', label: 'LinkedIn · connect',  tone: 'outline' },
  { value: 'linkedin_message', label: 'LinkedIn · message',  tone: 'outline' },
  { value: 'manual_task',      label: 'Manual task',         tone: 'neutral' },
];
const VALID_CHANNELS = new Set(CHANNELS.map(c => c.value));

export default function SequenceBuilder({ campaignId, clientId }) {
  const toast = useToast();
  const [steps, setSteps] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dirtyMap, setDirtyMap] = useState({});
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineErr, setRefineErr] = useState(null);

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

  async function applyRefinedSequence(content) {
    const parsed = parseSequenceSteps(content);
    if (!parsed || !parsed.length) {
      setRefineErr('Could not parse the revised sequence. Ask Claude to use the STEP N / CHANNEL: / DELAY: / BODY: format.');
      return;
    }
    setRefineErr(null);
    try {
      const saved = await api.post(`/outreach/campaigns/${campaignId}/sequences/replace`, { steps: parsed });
      setSteps(saved);
      setDirtyMap({});
      toast(`Sequence replaced — ${saved.length} step${saved.length === 1 ? '' : 's'}.`, 'success');
    } catch (e) { toast(`Apply failed: ${e.message}`, 'error'); }
  }

  if (!steps) return <div className="text-subtle">Loading sequence…</div>;

  const builderInner = (
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

  return (
    <div>
      {clientId && (
        <div className="row between center mb-3">
          <div className="caption text-subtle">{steps.length} step{steps.length === 1 ? '' : 's'}</div>
          <button onClick={() => setRefineOpen(o => !o)} className={`btn ${refineOpen ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
            {refineOpen ? 'Hide Claude' : '✦ Refine with Claude'}
          </button>
        </div>
      )}
      {refineErr && <div className="callout callout-danger mb-3">{refineErr}</div>}
      <div style={{ display: refineOpen ? 'grid' : 'block', gridTemplateColumns: refineOpen ? 'minmax(0, 1fr) 380px' : undefined, gap: refineOpen ? 'var(--s4)' : 0 }}>
        <div>{builderInner}</div>
        {refineOpen && clientId && (
          <RefineChat
            clientId={clientId}
            kind="outreach_sequence"
            artifact={renderSequenceForArtifact(steps)}
            artifactMeta={`${steps.length} step${steps.length === 1 ? '' : 's'}`}
            onApplyRevision={applyRefinedSequence}
            onClose={() => setRefineOpen(false)}
            compact
          />
        )}
      </div>
    </div>
  );
}

// Render the whole sequence as a single labelled text block so Claude
// can reason across steps (cadence, length, redundancy). The format
// matches what we expect back so Claude has a strong template to echo.
function renderSequenceForArtifact(steps) {
  if (!steps?.length) return '(empty sequence)';
  return steps.map((s, i) => {
    const lines = [
      `STEP ${i + 1}`,
      `CHANNEL: ${s.channel || 'email'}`,
      `DELAY: ${s.delay_days ?? 0} days`,
    ];
    if ((s.channel || 'email') === 'email' && s.subject) lines.push(`SUBJECT: ${s.subject}`);
    lines.push(`BODY: ${s.body || ''}`);
    return lines.join('\n');
  }).join('\n\n');
}

// Parse Claude's revision back into [{ channel, delay_days, subject,
// body }] for the bulk-replace endpoint. Tolerant of markdown bold,
// stray fences, and missing optional fields. Returns null if no STEP
// blocks were found so the caller can show a friendly error.
function parseSequenceSteps(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\*\*/g, '').trim();
  const blocks = cleaned.split(/(?=^\s*step\s+\d+\b)/im).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return null;
  const steps = [];
  for (const block of blocks) {
    if (!/^step\s+\d+/i.test(block)) continue;
    const channelMatch = block.match(/(?:^|\n)\s*channel\s*:\s*([^\n]+)/i);
    const delayMatch   = block.match(/(?:^|\n)\s*delay\s*:\s*(-?\d+)/i);
    const subjectMatch = block.match(/(?:^|\n)\s*subject\s*:\s*([^\n]+)/i);
    const bodyMatch    = block.match(/(?:^|\n)\s*body\s*:\s*([\s\S]*?)(?=\n\s*step\s+\d+\b|$)/i);
    let channel = (channelMatch?.[1] || 'email').trim().toLowerCase().replace(/\s+/g, '_');
    if (!VALID_CHANNELS.has(channel)) channel = 'email';
    steps.push({
      channel,
      delay_days: delayMatch ? parseInt(delayMatch[1], 10) : 0,
      subject: subjectMatch ? subjectMatch[1].trim() : null,
      body: bodyMatch ? bodyMatch[1].trim() : '',
    });
  }
  return steps.length ? steps : null;
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
