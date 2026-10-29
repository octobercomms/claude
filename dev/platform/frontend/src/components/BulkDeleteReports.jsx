// Clearing out reports that were never delivered.
//
// Nine months of weekly reports that generated and went nowhere leaves a long
// list of rows that say nothing the delivery panel above does not say better.
// This removes them, and the PDF files they left on disk with them.
//
// It asks twice on purpose. A bulk delete on production data is irreversible
// and the request arrives as a single click, so the count is shown first, the
// statuses are named, and the confirm step repeats both. The server then
// checks the count again before deleting anything: if a scheduled run landed
// between looking and clicking, nothing is removed and the new number comes
// back. Delivered reports are not offered here at all, and the server refuses
// them even if asked.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { reportStatusLabel } from '../utils/reportStatus';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

export default function BulkDeleteReports({ onDeleted }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [counts, setCounts] = useState(null);
  const [chosen, setChosen] = useState(() => new Set(['skipped_no_recipients']));
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const load = () => api.get('/reports/bulk-deletable').then(setCounts).catch(() => setCounts(null));
  useEffect(() => { load(); }, []);

  if (!counts || !counts.total) return null;

  const available = (counts.deletable || []).filter(s => counts.statuses[s]);
  const selected = available.filter(s => chosen.has(s));
  const total = selected.reduce((n, s) => n + (counts.statuses[s] || 0), 0);

  const toggle = (s) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  async function remove() {
    setWorking(true);
    try {
      const res = await api.delete('/reports/bulk', { statuses: selected, expected_count: total });
      toast(`Deleted ${res.deleted} report${res.deleted === 1 ? '' : 's'} and ${res.files_removed} PDF${res.files_removed === 1 ? '' : 's'}.`);
      setConfirming(false);
      await load();
      onDeleted?.();
    } catch (err) {
      // A 409 means the count moved — reload so the new number is on screen.
      toast(err.message, 'error');
      setConfirming(false);
      await load();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card mb-s5">
      <h3 className="h3 mb-2">Clear out undelivered reports</h3>
      <p className="text-subtle" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s4)' }}>
        Removes the rows and the PDF files they left on disk. Reports that were sent are never
        included, and cannot be.
      </p>

      <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s4)' }}>
        {available.map(s => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={chosen.has(s)} onChange={() => toggle(s)} disabled={confirming} />
            <span className="text-ink">{reportStatusLabel(s)}</span>
            <span className="chip chip-neutral">{counts.statuses[s]}</span>
          </label>
        ))}
      </div>

      {!confirming ? (
        <button
          className="btn btn-secondary"
          disabled={!total}
          {...roWrite(readOnly, { onClick: () => setConfirming(true) })}>
          Delete {total} report{total === 1 ? '' : 's'}…
        </button>
      ) : (
        <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft">
          <div className="text-negative" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s3)' }}>
            <strong>Permanently delete {total} report{total === 1 ? '' : 's'}</strong>
            {' '}({selected.map(reportStatusLabel).join(', ')}) and their PDF files? This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <button className="btn btn-primary" onClick={remove} disabled={working}>
              {working ? 'Deleting…' : `Yes, delete ${total}`}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={working}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
