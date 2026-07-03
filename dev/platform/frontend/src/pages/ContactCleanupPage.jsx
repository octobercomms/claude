import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SuiteTabs from '../components/SuiteTabs';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

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
  // Open with the tab requested via ?tab=… so the Cleanup Centre link on the
  // Publications panel lands the user directly on the Publications dupes tab.
  const [params] = useSearchParams();
  const initialTab = params.get('tab') || 'duplicates';
  const [tab, setTab] = useState(initialTab);
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
        { groupLabel: 'Contacts' },
        { key: 'duplicates', label: `Duplicates${byTab.duplicates.clusters ? ` (${countRemaining(byTab.duplicates)})` : ''}`, active: tab === 'duplicates', onClick: () => setTab('duplicates') },
        { key: 'coverage', label: `Coverage matchups${byTab.coverage.clusters ? ` (${countRemaining(byTab.coverage)})` : ''}`, active: tab === 'coverage', onClick: () => setTab('coverage') },
        { key: 'tidy', label: 'Tidy fixes', active: tab === 'tidy', onClick: () => setTab('tidy') },
        { groupLabel: 'Publications' },
        { key: 'pubdupes', label: 'Duplicates', active: tab === 'pubdupes', onClick: () => setTab('pubdupes') },
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

      {tab === 'pubdupes' && (
        <PublicationDupesTab />
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
                <button className="btn btn-danger btn-sm" onClick={() => onDelete(m.id, m.name)} disabled={busy} title="Delete this contact outright (not a merge)">Delete</button>
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
  const { readOnly } = useAuth();
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
          {phase === 'idle' && <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: start })}>✦ Start analysis</button>}
          {phase === 'done' && <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: start })}>Run again</button>}
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

// Publications duplicate workflow — mirrors the Contacts dedup UX but reads
// from /pr/dedup/outlets/scan and posts /pr/dedup/outlets/merge or /dismiss.
// Keeps Find Duplicates out of the Publications panel so all dedup work lives
// in one place.
function PublicationDupesTab() {
  const toast = useToast();
  const [clusters, setClusters] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [chosen, setChosen] = useState({});
  const [done, setDone] = useState({});
  const [busy, setBusy] = useState(false);

  async function scan() {
    setScanning(true); setDone({});
    try {
      const r = await api.get('/pr/dedup/outlets/scan');
      setClusters(r.clusters || []);
      const pick = {};
      (r.clusters || []).forEach((c, i) => {
        const m = c.members.find((x) => x.name === c.suggested) || c.members[0];
        if (m) pick[i] = m.id;
      });
      setChosen(pick);
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }
  useEffect(() => { scan(); }, []);

  async function merge(ci) {
    const cluster = clusters[ci];
    const canonId = chosen[ci];
    if (!canonId) { toast('Pick which publication to keep', 'error'); return; }
    const memberIds = cluster.members.map((m) => m.id).filter((id) => id !== canonId);
    if (!confirm(`Merge ${memberIds.length} duplicate${memberIds.length === 1 ? '' : 's'} into the selected publication? Cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await api.post('/pr/dedup/outlets/merge', { canonical_id: canonId, member_ids: memberIds });
      setDone((d) => ({ ...d, [ci]: r.merged }));
      toast(`Merged ${r.merged} publication${r.merged === 1 ? '' : 's'}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function dismiss(ci) {
    const cluster = clusters[ci];
    const ids = cluster.members.map((m) => m.id);
    setBusy(true);
    try {
      await api.post('/pr/dedup/outlets/dismiss', { outlet_ids: ids });
      setDone((d) => ({ ...d, [ci]: 0 }));
      toast('Marked as not duplicates — future scans will skip', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function mergeAllExact() {
    if (!clusters) return;
    const targets = clusters.map((c, i) => ({ c, i })).filter(({ c, i }) => c.method === 'exact' && !done[i] && chosen[i]);
    if (!targets.length) return;
    if (!confirm(`Merge all ${targets.length} exact-match clusters? Cannot be undone.`)) return;
    setBusy(true);
    try {
      for (const { c, i } of targets) {
        const memberIds = c.members.map((m) => m.id).filter((id) => id !== chosen[i]);
        const r = await api.post('/pr/dedup/outlets/merge', { canonical_id: chosen[i], member_ids: memberIds });
        setDone((d) => ({ ...d, [i]: r.merged }));
      }
      toast('Done', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const remaining = clusters ? clusters.filter((c, i) => done[i] == null) : [];
  const exactCount = clusters ? clusters.filter((c, i) => c.method === 'exact' && done[i] == null).length : 0;

  function pubBadge(method, confidence) {
    if (method === 'exact') return { label: 'Exact · safe', cls: 'chip-success' };
    if (method === 'ai') return { label: `AI confirmed · ${Math.round((confidence || 0) * 100)}%`, cls: 'chip-accent' };
    return { label: 'Possible · review', cls: 'chip-warning' };
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
          {scanning ? 'Scanning the publications list…' : clusters
            ? `${remaining.length} cluster${remaining.length === 1 ? '' : 's'} to review${exactCount ? ` · ${exactCount} exact-safe` : ''}`
            : 'Click Scan to look for duplicates.'}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning || busy}>{scanning ? 'Scanning…' : 'Re-scan'}</button>
        {exactCount > 0 && (
          <button className="btn btn-primary btn-sm" onClick={mergeAllExact} disabled={busy}>Merge all {exactCount} exact-safe</button>
        )}
      </div>

      {!scanning && clusters && remaining.length === 0 && (
        <div className="card" style={{ background: 'var(--positive-soft)', border: '1px solid #b6dcc1', color: 'var(--positive)', fontSize: 13 }}>
          ✓ No duplicate publications — the list is clean.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(clusters || []).map((c, ci) => done[ci] != null ? null : (
          <div key={ci} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              {(() => { const b = pubBadge(c.method, c.confidence); return <span className={`chip ${b.cls}`}>{b.label}</span>; })()}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => merge(ci)} disabled={busy || !chosen[ci]}>
                  Merge {c.members.length - 1} into selected →
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismiss(ci)}
                  title="These aren't the same publication — record it so future scans don't suggest this cluster again.">
                  ✗ Not duplicates
                </button>
              </div>
            </div>
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ width: 36, textAlign: 'left' }}>Keep</th>
                  <th style={{ textAlign: 'left' }}>Publication</th>
                </tr>
              </thead>
              <tbody>
                {c.members.map((m) => (
                  <tr key={m.id}>
                    <td><input type="radio" name={`pubdup_${ci}`} checked={chosen[ci] === m.id} onChange={() => setChosen((s) => ({ ...s, [ci]: m.id }))} disabled={busy} /></td>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
