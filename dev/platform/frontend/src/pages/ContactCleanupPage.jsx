import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SuiteTabs from '../components/SuiteTabs';

// Contact Cleanup Centre. Replaces the cramped 460-px modal with a real page
// because a 20k-contact library produces hundreds of clusters — the AM needs
// space to work through them, plus an inline Delete affordance to drop a
// duplicate outright instead of merging it.
//
// Phase 1: Duplicates tab only. Coverage matchups + Tidy fixes tabs are
// placeholders; they wire up in phases 2 and 3 of the cleanup roadmap.
//
// UI conventions: reuses the platform's kicker/hero/SuiteTabs/card/chip/table
// pattern from the other suite pages (Client PR, Outlet profile, etc.) so it
// reads as "another suite page" rather than a one-off.

function methodBadge(method) {
  if (method === 'exact_email') return { label: 'Same email · safe', cls: 'chip-success' };
  if (method === 'name_and_domain') return { label: 'Same name + email domain · review', cls: 'chip-warning' };
  if (method === 'coverage_matchup') return { label: 'Coverage matchup · review', cls: 'chip-accent' };
  return { label: 'Same name + outlet · review', cls: 'chip-warning' };
}

// Each cleanup tab has independent state — clusters / chosen / done / scanning —
// so toggling tabs doesn't wipe progress on the other. The cluster shape is
// identical across scans, so the cluster card / merge handler / delete handler
// don't care which endpoint produced the data.
const SCANS = {
  duplicates: '/outreach/contacts/dedup/scan',
  coverage: '/outreach/contacts/coverage-matchups/scan',
};

function emptyTabState() {
  return { clusters: null, scanning: false, chosen: {}, done: {} };
}

function countRemaining(s) {
  if (!s?.clusters) return 0;
  return s.clusters.filter((c, i) => !s.done[i] && (c.members?.length || 0) >= 2).length;
}

export default function ContactCleanupPage() {
  const toast = useToast();
  const [tab, setTab] = useState('duplicates');
  const [byTab, setByTab] = useState({ duplicates: emptyTabState(), coverage: emptyTabState() });
  const [busy, setBusy] = useState(false);

  const state = byTab[tab] || emptyTabState();
  const { clusters, scanning, chosen, done } = state;

  function patchTab(t, patch) {
    setByTab((cur) => ({ ...cur, [t]: { ...cur[t], ...patch } }));
  }
  function setChosenFor(t, updater) {
    setByTab((cur) => ({ ...cur, [t]: { ...cur[t], chosen: updater(cur[t].chosen) } }));
  }
  function setDoneFor(t, updater) {
    setByTab((cur) => ({ ...cur, [t]: { ...cur[t], done: updater(cur[t].done) } }));
  }
  function setClustersFor(t, updater) {
    setByTab((cur) => ({ ...cur, [t]: { ...cur[t], clusters: updater(cur[t].clusters) } }));
  }

  async function scan(t = tab) {
    const url = SCANS[t]; if (!url) return;
    patchTab(t, { scanning: true, done: {} });
    try {
      const r = await api.get(url);
      const pick = {};
      (r.clusters || []).forEach((c, i) => { if (r.suggested?.[i]) pick[i] = r.suggested[i]; });
      patchTab(t, { clusters: r.clusters || [], chosen: pick });
    } catch (e) { toast(e.message, 'error'); }
    finally { patchTab(t, { scanning: false }); }
  }
  // Auto-scan the duplicates tab on mount. Coverage is lazy: scans the first
  // time the user clicks it, then sticks. Avoids two heavy queries on entry.
  useEffect(() => { scan('duplicates'); }, []);
  useEffect(() => { if (tab === 'coverage' && byTab.coverage.clusters === null && !byTab.coverage.scanning) scan('coverage'); }, [tab]);

  async function mergeOne(ci) {
    const cluster = clusters[ci];
    const canon = chosen[ci];
    if (!canon) { toast('Pick which contact to keep', 'error'); return; }
    if (!confirm(`Merge ${cluster.members.length - 1} duplicate${cluster.members.length === 2 ? '' : 's'} into the selected contact? Cannot be undone.`)) return;
    const memberIds = cluster.members.map((m) => m.id).filter((id) => id !== canon);
    setBusy(true);
    try {
      const r = await api.post('/outreach/contacts/dedup/merge', { canonical_id: canon, member_ids: memberIds });
      setDoneFor(tab, (d) => ({ ...d, [ci]: r.merged }));
      toast(`Merged ${r.merged} contact${r.merged === 1 ? '' : 's'}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function deleteRow(ci, memberId, memberName) {
    if (!confirm(`Delete "${memberName}" outright? This wipes the contact and every history row attached to it — not the same as merging.`)) return;
    setBusy(true);
    try {
      await api.delete(`/outreach/contacts/${memberId}`);
      setClustersFor(tab, (cs) => cs.map((c, i) => {
        if (i !== ci) return c;
        return { ...c, members: c.members.filter((m) => m.id !== memberId) };
      }));
      // If the surviving cluster has <2 members, mark it done so it disappears.
      setByTab((cur) => {
        const next = { ...cur[tab] };
        const cluster = next.clusters?.[ci];
        if (cluster && cluster.members.length < 2) next.done = { ...next.done, [ci]: 0 };
        if (next.chosen?.[ci] === memberId) {
          const c2 = { ...next.chosen }; delete c2[ci]; next.chosen = c2;
        }
        return { ...cur, [tab]: next };
      });
      toast('Contact deleted', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function mergeAllExactEmail() {
    if (!clusters) return;
    const targets = clusters
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.method === 'exact_email' && !done[i] && chosen[i] && c.members.length >= 2);
    if (!targets.length) return;
    if (!confirm(`Auto-merge ${targets.length} "same email" cluster${targets.length === 1 ? '' : 's'} using the suggested canonical? Cannot be undone.`)) return;
    setBusy(true);
    let total = 0;
    try {
      for (const { c, i } of targets) {
        const memberIds = c.members.map((m) => m.id).filter((id) => id !== chosen[i]);
        const r = await api.post('/outreach/contacts/dedup/merge', { canonical_id: chosen[i], member_ids: memberIds });
        total += r.merged || 0;
        setDoneFor(tab, (d) => ({ ...d, [i]: r.merged }));
      }
      toast(`Merged ${total} duplicate${total === 1 ? '' : 's'}`, 'success');
      await scan(tab);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const remaining = clusters ? clusters.filter((_, i) => !done[i] && (clusters[i].members?.length || 0) >= 2) : [];
  const exactCount = clusters ? clusters.filter((c, i) => c.method === 'exact_email' && !done[i]).length : 0;

  return (
    <div className="suite-cleanup">
      <div className="kicker"><span className="pip" /><span>Admin • Contacts</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display">Cleanup Centre</h1>
          <p style={{ color: 'var(--text-subtle)', fontSize: 14, margin: '6px 0 0' }}>
            Trim duplicates, fold orphaned coverage onto real contacts, and let Claude tidy the obvious fixes.
          </p>
        </div>
        <Link to="/settings?tab=contacts" className="btn btn-secondary">← Back to contacts</Link>
      </header>

      <SuiteTabs tabs={[
        { key: 'duplicates', label: `Duplicates${byTab.duplicates.clusters ? ` (${countRemaining(byTab.duplicates)})` : ''}`, active: tab === 'duplicates', onClick: () => setTab('duplicates') },
        { key: 'coverage', label: `Coverage matchups${byTab.coverage.clusters ? ` (${countRemaining(byTab.coverage)})` : ''}`, active: tab === 'coverage', onClick: () => setTab('coverage') },
        { key: 'tidy', label: 'Tidy fixes', active: tab === 'tidy', onClick: () => setTab('tidy') },
        { key: 'autopilot', label: 'CRM Manager', active: tab === 'autopilot', onClick: () => setTab('autopilot') },
      ]} />

      {tab === 'duplicates' && (
        <div>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
              {scanning ? 'Scanning the contact library…' : clusters
                ? `${remaining.length} cluster${remaining.length === 1 ? '' : 's'} to review${exactCount ? ` · ${exactCount} same-email (safe to auto-merge)` : ''}`
                : 'Click Scan to look for duplicates.'}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => scan('duplicates')} disabled={scanning || busy}>{scanning ? 'Scanning…' : 'Re-scan'}</button>
            {exactCount > 0 && (
              <button className="btn btn-primary btn-sm" onClick={mergeAllExactEmail} disabled={busy}>
                Merge all {exactCount} same-email clusters
              </button>
            )}
          </div>

          {!scanning && clusters && remaining.length === 0 && (
            <div className="card" style={{ background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', fontSize: 13 }}>
              ✓ No duplicates left. Your contact library is clean.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(clusters || []).map((c, i) => done[i] || (c.members?.length || 0) < 2 ? null : (
              <ClusterCard
                key={i}
                cluster={c}
                ci={i}
                chosenId={chosen[i]}
                onChoose={(id) => setChosenFor(tab, (s) => ({ ...s, [i]: id }))}
                onMerge={() => mergeOne(i)}
                onDelete={(id, name) => deleteRow(i, id, name)}
                busy={busy}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'coverage' && (
        <div>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
              {scanning
                ? 'Scanning for coverage-only contacts that match a richer library record…'
                : clusters
                  ? `${remaining.length} matchup${remaining.length === 1 ? '' : 's'} to review${remaining.length ? ' · merging folds the coverage history onto the contact with the email' : ''}`
                  : 'Click Scan to look for coverage matchups.'}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => scan('coverage')} disabled={scanning || busy}>{scanning ? 'Scanning…' : 'Re-scan'}</button>
          </div>

          {!scanning && clusters && remaining.length === 0 && (
            <div className="card" style={{ background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', fontSize: 13 }}>
              ✓ No coverage matchups left. Every journalist with coverage history is already on a contact with an email.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(clusters || []).map((c, i) => done[i] || (c.members?.length || 0) < 2 ? null : (
              <ClusterCard
                key={i}
                cluster={c}
                ci={i}
                chosenId={chosen[i]}
                onChoose={(id) => setChosenFor(tab, (s) => ({ ...s, [i]: id }))}
                onMerge={() => mergeOne(i)}
                onDelete={(id, name) => deleteRow(i, id, name)}
                busy={busy}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'tidy' && (
        <TidyFixesTab onChanged={() => scan(tab)} />
      )}

      {tab === 'autopilot' && (
        <CrmManagerTab onChanged={() => { scan('duplicates'); scan('coverage'); }} />
      )}
    </div>
  );
}

function ClusterCard({ cluster, ci, chosenId, onChoose, onMerge, onDelete, busy }) {
  const b = methodBadge(cluster.method);
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <span className={`chip ${b.cls}`}>{b.label}</span>
        <button className="btn btn-primary btn-sm" onClick={onMerge} disabled={busy || !chosenId}>
          Merge {cluster.members.length - 1} into selected →
        </button>
      </div>
      <table className="table" style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase' }}>
            <th style={{ width: 36, textAlign: 'left' }}>Keep</th>
            <th style={{ textAlign: 'left' }}>Name</th>
            <th style={{ textAlign: 'left' }}>Email</th>
            <th style={{ textAlign: 'left' }}>Outlet</th>
            <th style={{ textAlign: 'right' }}>Coverage</th>
            <th style={{ textAlign: 'right' }}>Clients</th>
            <th style={{ width: 90, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {cluster.members.map((m) => (
            <tr key={m.id}>
              <td><input type="radio" name={`dedup_${ci}`} checked={chosenId === m.id} onChange={() => onChoose(m.id)} disabled={busy} /></td>
              <td style={{ fontWeight: 600 }}>{m.name || '—'}</td>
              <td style={{ color: 'var(--text-muted)' }}>{m.email || '—'}</td>
              <td style={{ color: 'var(--text-muted)' }}>{m.outlet || '—'}</td>
              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{m.coverage}</td>
              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{m.clients}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => onDelete(m.id, m.name)} disabled={busy} title="Delete this contact outright (not a merge)">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tidy fixes tab — starts a background Claude tidy run across the whole library,
// polls for progress, then lets the AM tick which suggestions to apply. Same
// flow as the old Settings modal, lifted into the page so it lives alongside
// the duplicate / matchup workflows. Also exposes the one-shot "Repair imported
// names" action (Notion-URL fragment stripper) that previously had its own
// Settings button — same place, less confusing.
function TidyFixesTab({ onChanged }) {
  const toast = useToast();
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ processed: 0, total: 0, found: 0 });
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [appliedCount, setAppliedCount] = useState(0);
  const pollRef = React.useRef(null);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function start() {
    setPhase('running');
    setProgress({ processed: 0, total: 0, found: 0 });
    setSuggestions([]); setSelected(new Set()); setAppliedCount(0);
    try {
      const r = await api.post('/outreach/contacts/analyze-tidy', {});
      const runId = r.runId;
      setProgress((p) => ({ ...p, total: r.total || 0 }));
      const tick = async () => {
        try {
          const run = await api.get(`/outreach/contacts/analyze-tidy/runs/${runId}`);
          setProgress({ processed: run.processed || 0, total: run.total || 0, found: (run.suggestions || []).length });
          if (run.status === 'done') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setSuggestions(run.suggestions || []);
            setSelected(new Set((run.suggestions || []).map((_, i) => i)));
            setPhase('review');
          } else if (run.status === 'failed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            toast(run.error || 'Run failed', 'error');
            setPhase('idle');
          }
        } catch (e) { /* keep polling on transient */ }
      };
      await tick();
      pollRef.current = setInterval(tick, 2000);
    } catch (e) { toast(e.message, 'error'); setPhase('idle'); }
  }

  async function apply() {
    if (!selected.size) return;
    const accepted = suggestions.filter((_, i) => selected.has(i));
    setPhase('applying');
    try {
      const r = await api.post('/outreach/contacts/apply-tidy', { suggestions: accepted });
      setAppliedCount(r.applied || 0);
      setPhase('done');
      if (onChanged) onChanged();
    } catch (e) { toast(e.message, 'error'); setPhase('review'); }
  }

  async function repairImportedNames() {
    if (!confirm('Strip leftover Notion-URL fragments from every contact + outlet name? Safe to run multiple times.')) return;
    setRepairing(true);
    try {
      const r = await api.post('/pr/repair-imported-names', {});
      toast(`Repaired ${r.contacts} contact${r.contacts === 1 ? '' : 's'} and ${r.outlets} outlet${r.outlets === 1 ? '' : 's'}.`, 'success');
      if (onChanged) onChanged();
    } catch (e) { toast(e.message, 'error'); }
    finally { setRepairing(false); }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="h3 mb-2">Field cleanups</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Claude reads every contact in your library and proposes fixes — capitalisation, missing company derived from email domain, lowercase emails, URL schemes, name splits. You review each suggestion before anything changes; every applied change writes an audit row.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {phase === 'idle' && <button className="btn btn-primary btn-sm" onClick={start}>✦ Start analysis</button>}
          {phase === 'done' && <button className="btn btn-secondary btn-sm" onClick={start}>Run again</button>}
          <button className="btn btn-secondary btn-sm" onClick={repairImportedNames} disabled={repairing}
            title="Strip leftover (https://app.notion.com/…) fragments from contact + outlet names — a one-shot fix for older Notion-export imports.">
            {repairing ? 'Repairing…' : '✦ Repair imported names'}
          </button>
        </div>
      </div>

      {phase === 'running' && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <div style={{ marginBottom: 10 }}>
            Claude is reading the contacts in batches of 40 — {progress.processed.toLocaleString()} of {progress.total.toLocaleString()} done.
          </div>
          <div style={{ background: 'var(--surface-raised)', borderRadius: 999, height: 8, overflow: 'hidden', margin: '8px auto 12px', maxWidth: 420 }}>
            <div style={{
              background: 'var(--accent)', height: '100%',
              width: progress.total ? `${Math.min(100, (progress.processed / progress.total) * 100)}%` : '4%',
              transition: 'width 400ms ease',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            {progress.found.toLocaleString()} suggestion{progress.found === 1 ? '' : 's'} found so far · You can switch tabs — the run continues in the background.
          </div>
        </div>
      )}

      {phase === 'review' && suggestions.length === 0 && (
        <div className="card" style={{ background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', fontSize: 13 }}>
          ✓ Claude has no cleanup suggestions — the library is already tidy.
        </div>
      )}

      {phase === 'review' && suggestions.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} · {selected.size} ticked
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(suggestions.map((_, i) => i)))}>Select all</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn btn-primary btn-sm" onClick={apply} disabled={!selected.size}>Apply {selected.size} fix{selected.size === 1 ? '' : 'es'}</button>
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ width: 28 }}></th>
                  <th style={{ textAlign: 'left' }}>Contact</th>
                  <th style={{ textAlign: 'left' }}>Field</th>
                  <th style={{ textAlign: 'left' }}>Before</th>
                  <th style={{ textAlign: 'left' }}>After</th>
                  <th style={{ textAlign: 'left' }}>Why</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={selected.has(i)} onChange={(e) => {
                      const n = new Set(selected);
                      if (e.target.checked) n.add(i); else n.delete(i);
                      setSelected(n);
                    }} /></td>
                    <td style={{ fontWeight: 600 }}>{s.contact_name || s.contact_email || '—'}</td>
                    <td><code style={{ background: 'var(--surface-raised)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{s.field}</code></td>
                    <td style={{ color: 'var(--text-muted)' }}>{s.before || <em>(empty)</em>}</td>
                    <td style={{ color: 'var(--text)' }}>{s.new_value}</td>
                    <td style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{s.why || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {phase === 'applying' && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Applying…</div>
      )}

      {phase === 'done' && (
        <div className="card" style={{ background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', fontSize: 13 }}>
          ✓ Applied {appliedCount.toLocaleString()} field change{appliedCount === 1 ? '' : 's'}. Every change wrote an audit row visible from the contact's Edit modal.
        </div>
      )}
    </div>
  );
}

// CRM Manager tab — the autopilot. Shows the on/off + per-action toggles,
// the last run summary (merged / tidied / queued), a "Run now" button for
// the AM to trigger a manual sweep, and an "Undo last run" for the recovery
// case where a sweep did something the AM didn't want.
function CrmManagerTab({ onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setData(await api.get('/outreach/contacts/crm-manager/status')); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(field, value) {
    setBusy(true);
    try {
      const r = await api.patch('/outreach/contacts/crm-manager/settings', { [field]: value });
      setData((d) => ({ ...d, settings: r.settings }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function runNow() {
    if (!confirm('Run the CRM Manager sweep now? Same effect as the weekly cron — auto-merges same-email duplicates and auto-applies safe field fixes.')) return;
    setBusy(true);
    try {
      await api.post('/outreach/contacts/crm-manager/run', {});
      toast('Sweep started — refresh this tab in a couple of minutes to see the result.', 'success');
      setTimeout(load, 2000);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function undo(runId) {
    if (!confirm('Undo this sweep? Restores merged contacts and rolls back tidied fields. Run a fresh scan after to re-decide.')) return;
    setBusy(true);
    try {
      const r = await api.post(`/outreach/contacts/crm-manager/runs/${runId}/undo`, {});
      toast(`Undone: ${r.unmerged} merge${r.unmerged === 1 ? '' : 's'} reversed, ${r.untidied} field${r.untidied === 1 ? '' : 's'} restored.`, 'success');
      await load();
      if (onChanged) onChanged();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;
  if (!data) return null;
  const { settings, lastRun, recent } = data;

  function ago(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <h3 className="h3 mb-2">Autopilot</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
          Runs every Sunday at 05:00 (UK). Auto-merges same-email duplicate clusters and auto-applies deterministic field fixes (capitalisation, email-case, URL schemes). Anything fuzzier — name+outlet clusters, publication-in-name splits — stays queued for you to tick in the other tabs.
        </p>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" disabled={busy} checked={!!settings.enabled} onChange={(e) => toggle('enabled', e.target.checked)} />
            Autopilot {settings.enabled ? 'ON' : 'OFF'}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" disabled={busy || !settings.enabled} checked={!!settings.auto_merge} onChange={(e) => toggle('auto_merge', e.target.checked)} />
            Auto-merge same-email duplicates
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" disabled={busy || !settings.enabled} checked={!!settings.auto_tidy} onChange={(e) => toggle('auto_tidy', e.target.checked)} />
            Auto-apply safe tidy fixes
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={runNow} disabled={busy || !settings.enabled}>Run sweep now</button>
        </div>
      </div>

      {lastRun && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <h3 className="h3" style={{ margin: 0 }}>Last sweep · {ago(lastRun.started_at)}</h3>
            {lastRun.status === 'done' && (
              <button className="btn btn-secondary btn-sm" onClick={() => undo(lastRun.id)} disabled={busy}>Undo last run</button>
            )}
          </div>
          {lastRun.status === 'failed' ? (
            <div style={{ background: 'var(--negative-soft)', padding: 10, borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 13 }}>
              Failed: {lastRun.error || 'unknown error'}
            </div>
          ) : lastRun.status === 'running' ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Still running — refresh in a moment.</div>
          ) : (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
              <div><strong style={{ fontSize: 20 }}>{(lastRun.merged_count || 0).toLocaleString()}</strong> contacts merged</div>
              <div><strong style={{ fontSize: 20 }}>{(lastRun.tidied_count || 0).toLocaleString()}</strong> fields tidied</div>
              <div><strong style={{ fontSize: 20 }}>{((lastRun.queued_dupes || 0) + (lastRun.queued_tidies || 0)).toLocaleString()}</strong> queued for your review</div>
            </div>
          )}
        </div>
      )}

      {recent && recent.length > 1 && (
        <div className="card">
          <h3 className="h3 mb-2">Recent sweeps</h3>
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left' }}>When</th>
                <th style={{ textAlign: 'left' }}>Trigger</th>
                <th style={{ textAlign: 'right' }}>Merged</th>
                <th style={{ textAlign: 'right' }}>Tidied</th>
                <th style={{ textAlign: 'right' }}>Queued</th>
                <th style={{ textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(1).map((r) => (
                <tr key={r.id}>
                  <td>{ago(r.started_at)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.trigger}</td>
                  <td style={{ textAlign: 'right' }}>{r.merged_count}</td>
                  <td style={{ textAlign: 'right' }}>{r.tidied_count}</td>
                  <td style={{ textAlign: 'right' }}>{(r.queued_dupes || 0) + (r.queued_tidies || 0)}</td>
                  <td><span className={`chip ${r.status === 'done' ? 'chip-success' : r.status === 'failed' ? 'chip-danger' : ''}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
