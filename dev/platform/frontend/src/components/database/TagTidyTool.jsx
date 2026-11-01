import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { roWrite } from '../../utils/readOnly';
import { useAuth } from '../../context/AuthContext';

// Tag cleanup, moved off the Tags screen on 1 November.
//
// It sat beside the Tags heading, which read as a control on that list. It is
// not: it sends the whole tag catalogue to Claude and proposes rewrites
// across every journalist, which is the same shape as everything else on this
// page and nothing like renaming one tag.
//
// Moving the button on its own would have been worse than leaving it, because
// the plan it returns is the part you have to read — tag names, counts, and
// Claude's reason per operation. So the whole flow moved, and it loads the tag
// list itself rather than borrowing the screen's.

function OpSummary({ op }) {
  const chip = (txt) => <code style={{ background: 'var(--warning-soft)', padding: 'var(--s1) var(--s1)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-caption)' }}>{txt}</code>;
  if (op.type === 'rename') return <span>Rename {chip(op.from)} → {chip(op.to)}</span>;
  if (op.type === 'merge') return <span>Merge {op.from.map((t, i) => <React.Fragment key={t}>{i > 0 && ', '}{chip(t)}</React.Fragment>)} → {chip(op.into)}</span>;
  if (op.type === 'delete') return <span>Delete {chip(op.tag)} everywhere</span>;
  if (op.type === 'add_parent') return <span>Add parent {chip(op.parent)} to every journalist tagged {chip(op.child)}</span>;
  return <span>{op.type}</span>;
}

export default function TagTidyTool() {
  const { readOnly } = useAuth();
  const [tagCount, setTagCount] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState(null);            // { operations: [], tagCount }
  const [selectedOps, setSelectedOps] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  async function countTags() {
    try { setTagCount((await api.get('/outreach/tags'))?.length ?? null); }
    catch { setTagCount(null); }
  }
  useEffect(() => { countTags(); }, []);

  async function tidyWithClaude() {
    setAnalyzing(true); setErr(null); setInfo(null); setPlan(null); setSelectedOps(new Set());
    try {
      const r = await api.post('/outreach/tags/analyze', {});
      setPlan(r);
      // Pre-tick everything Claude suggested — the AM can untick anything
      // they disagree with. Safer than ticking nothing (would be missed).
      setSelectedOps(new Set((r.operations || []).map((_, i) => i)));
      if (!(r.operations || []).length) setInfo('Claude has no cleanup suggestions — the catalogue looks tidy.');
    } catch (e) { setErr(e.message); }
    finally { setAnalyzing(false); }
  }

  async function applyPlan() {
    if (!plan || !selectedOps.size) return;
    const ops = plan.operations.filter((_, i) => selectedOps.has(i));
    // eslint-disable-next-line no-alert
    if (!confirm(`Apply ${ops.length} cleanup operation${ops.length === 1 ? '' : 's'}? This rewrites tags on journalists and can't be undone in one click.`)) return;
    setApplying(true); setErr(null);
    try {
      const r = await api.post('/outreach/tags/apply-plan', { operations: ops });
      const totals = (r.results || []).reduce((acc, x) => {
        acc[x.op.type] = (acc[x.op.type] || 0) + (x.updated || 0);
        return acc;
      }, {});
      const summary = Object.entries(totals).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(' · ');
      setInfo(`Applied ${ops.length} operation${ops.length === 1 ? '' : 's'}. ${summary}`);
      setPlan(null); setSelectedOps(new Set());
      await countTags();
    } catch (e) { setErr(e.message); }
    finally { setApplying(false); }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 'var(--s2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="h3" style={{ margin: 0 }}>✦ Tidy tags with Claude</div>
          <p className="body-sm text-muted" style={{ margin: 'var(--s2) 0 0', maxWidth: 620, lineHeight: 1.55 }}>
            Reads the whole tag catalogue and proposes renames, merges, deletions and parent tags, with a
            reason for each. Nothing is applied until you tick it. Most of what it finds is leftovers from
            old CSV imports.
          </p>
        </div>
        <button {...roWrite(readOnly, { onClick: tidyWithClaude, disabled: analyzing || applying })}
          className="btn btn-secondary btn-sm">
          {analyzing ? 'Analysing…' : 'Suggest cleanups'}
        </button>
      </div>
      <p className="body-xs text-subtle" style={{ margin: 0 }}>
        {tagCount === null ? 'One Claude call per run.' : `${tagCount.toLocaleString()} tag${tagCount === 1 ? '' : 's'} in the workspace. One Claude call per run.`}
        {' '}Renaming or deleting a single tag stays on Database › Tags.
      </p>

      {err && <div style={{ padding: 'var(--s2)', background: 'var(--negative-soft)', borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 'var(--fs-caption)' }}>{err}</div>}
      {info && <div style={{ padding: 'var(--s2)', background: 'var(--positive-soft)', borderRadius: 'var(--r-sm)', color: 'var(--positive)', fontSize: 'var(--fs-caption)' }}>{info}</div>}

      {plan && plan.operations && plan.operations.length > 0 && (
        <div style={{ padding: 'var(--s4)', border: '1px solid #ddd6a8', borderRadius: 'var(--r-md)', background: 'var(--warning-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
              Claude&apos;s cleanup plan — {plan.operations.length} suggestion{plan.operations.length === 1 ? '' : 's'} across {plan.tagCount} tag{plan.tagCount === 1 ? '' : 's'}
            </div>
            <button onClick={() => { setPlan(null); setSelectedOps(new Set()); }} className="btn-icon" aria-label="Close">×</button>
          </div>
          <p className="body-sm text-muted" style={{ marginBottom: 'var(--s3)' }}>
            Untick anything you disagree with, then apply. Each operation rewrites tags on journalists and can&apos;t be undone in one click.
          </p>
          <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid #eee' }}>
            {plan.operations.map((op, i) => {
              const ticked = selectedOps.has(i);
              return (
                <label key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--s3)',
                  padding: 'var(--s3) 0', borderBottom: '1px solid #f0eccd', cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={ticked} onChange={() => {
                    setSelectedOps((prev) => {
                      const n = new Set(prev);
                      if (n.has(i)) n.delete(i); else n.add(i);
                      return n;
                    });
                  }} style={{ marginTop: 'var(--s1)' }} />
                  <div style={{ flex: 1, fontSize: 'var(--fs-caption)' }}>
                    <div style={{ marginBottom: 'var(--s1)' }}>
                      <span className="chip chip-outline" style={{ padding: 'var(--s1) var(--s2)', fontSize: 'var(--fs-caption)', marginRight: 'var(--s2)' }}>{op.type}</span>
                      <OpSummary op={op} />
                    </div>
                    {op.why && <div style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>{op.why}</div>}
                  </div>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button onClick={() => setSelectedOps(new Set(plan.operations.map((_, i) => i)))} className="btn btn-secondary btn-sm">Tick all</button>
            <button onClick={() => setSelectedOps(new Set())} className="btn btn-secondary btn-sm">Untick all</button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>{selectedOps.size} of {plan.operations.length} ticked</span>
            <button onClick={applyPlan} disabled={!selectedOps.size || applying} className="btn btn-primary btn-sm">
              {applying ? 'Applying…' : `Apply ${selectedOps.size} operation${selectedOps.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
