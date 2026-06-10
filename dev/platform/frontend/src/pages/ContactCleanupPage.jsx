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
  return { label: 'Same name + outlet · review', cls: 'chip-warning' };
}

export default function ContactCleanupPage() {
  const toast = useToast();
  const [tab, setTab] = useState('duplicates');
  const [clusters, setClusters] = useState(null); // null = not yet scanned
  const [scanning, setScanning] = useState(false);
  const [chosen, setChosen] = useState({});
  const [done, setDone] = useState({}); // ci -> merged_count (cluster cleared)
  const [busy, setBusy] = useState(false);

  async function scan() {
    setScanning(true); setDone({});
    try {
      const r = await api.get('/outreach/contacts/dedup/scan');
      setClusters(r.clusters || []);
      const pick = {};
      (r.clusters || []).forEach((c, i) => { if (r.suggested?.[i]) pick[i] = r.suggested[i]; });
      setChosen(pick);
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }
  useEffect(() => { scan(); }, []);

  async function mergeOne(ci) {
    const cluster = clusters[ci];
    const canon = chosen[ci];
    if (!canon) { toast('Pick which contact to keep', 'error'); return; }
    if (!confirm(`Merge ${cluster.members.length - 1} duplicate${cluster.members.length === 2 ? '' : 's'} into the selected contact? Cannot be undone.`)) return;
    const memberIds = cluster.members.map((m) => m.id).filter((id) => id !== canon);
    setBusy(true);
    try {
      const r = await api.post('/outreach/contacts/dedup/merge', { canonical_id: canon, member_ids: memberIds });
      setDone((d) => ({ ...d, [ci]: r.merged }));
      toast(`Merged ${r.merged} contact${r.merged === 1 ? '' : 's'}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function deleteRow(ci, memberId, memberName) {
    if (!confirm(`Delete "${memberName}" outright? This wipes the contact and every history row attached to it — not the same as merging.`)) return;
    setBusy(true);
    try {
      await api.delete(`/outreach/contacts/${memberId}`);
      // Strip the row from the local cluster; if it leaves <2 members, mark
      // the cluster done so it disappears from the list.
      setClusters((cs) => cs.map((c, i) => {
        if (i !== ci) return c;
        const remaining = c.members.filter((m) => m.id !== memberId);
        return { ...c, members: remaining };
      }));
      setClusters((cs) => {
        const next = [...cs];
        if (next[ci] && next[ci].members.length < 2) setDone((d) => ({ ...d, [ci]: 0 }));
        return next;
      });
      if (chosen[ci] === memberId) setChosen((s) => { const n = { ...s }; delete n[ci]; return n; });
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
        setDone((d) => ({ ...d, [i]: r.merged }));
      }
      toast(`Merged ${total} duplicate${total === 1 ? '' : 's'}`, 'success');
      await scan();
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
        { key: 'duplicates', label: `Duplicates${clusters ? ` (${remaining.length})` : ''}`, active: tab === 'duplicates', onClick: () => setTab('duplicates') },
        { key: 'coverage', label: 'Coverage matchups', active: tab === 'coverage', onClick: () => setTab('coverage') },
        { key: 'tidy', label: 'Tidy fixes', active: tab === 'tidy', onClick: () => setTab('tidy') },
      ]} />

      {tab === 'duplicates' && (
        <div>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
              {scanning ? 'Scanning the contact library…' : clusters
                ? `${remaining.length} cluster${remaining.length === 1 ? '' : 's'} to review${exactCount ? ` · ${exactCount} same-email (safe to auto-merge)` : ''}`
                : 'Click Scan to look for duplicates.'}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning || busy}>{scanning ? 'Scanning…' : 'Re-scan'}</button>
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
                onChoose={(id) => setChosen((s) => ({ ...s, [i]: id }))}
                onMerge={() => mergeOne(i)}
                onDelete={(id, name) => deleteRow(i, id, name)}
                busy={busy}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'coverage' && (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Coverage matchups — coming next. Will scan the editorial log for name-only journalist rows where another contact in the library carries the matching email, and propose folding them onto a single record.
        </div>
      )}

      {tab === 'tidy' && (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Tidy fixes — coming next. For now, run <Link to="/settings?tab=contacts">Settings → Contacts → ✦ Tidy with Claude</Link>; that flow moves into this tab once the CRM Manager autopilot lands.
        </div>
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
