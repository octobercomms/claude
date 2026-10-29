// The open queue, inside the analyst panel.
//
// The Strategist's queue is the account's open work, and it was only readable
// by going to the Strategy tab and scrolling. This puts it wherever you are,
// scoped the same way the conversation beside it is: standing on Paid you see
// Paid's items, plus the account-wide ones, because an account-wide item is
// relevant to every section by definition.
//
// Ticking an item here writes through to the same row the Strategy tab shows,
// so the two never disagree.

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const PILLAR_LABEL = { paid: 'Paid', earned: 'Earned', shared: 'Shared', owned: 'Owned', cross: 'Account' };

// Mirrors ageInDays in services/strategist/attention.js. A bad timestamp reads
// as unknown rather than as a wrong number of days.
function ageInDays(since) {
  if (!since) return null;
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  return ms < 0 ? 0 : Math.floor(ms / 86400000);
}

export default function AnalystQueue({ clientId, persona }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api.get(`/strategist/clients/${clientId}/queue`)
      .then(d => { setData(d); setErr(''); })
      .catch(e => setErr(e.message));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(item) {
    setBusy(item.id);
    try {
      // The same endpoint the Strategy tab uses, so the two never disagree.
      await api.patch(`/strategist/briefing-actions/${item.id}`, { done: !item.done });
      setData(d => ({ ...d, items: d.items.filter(i => i.id !== item.id) }));
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(null); }
  }

  if (err) return <div className="body-sm" style={{ color: 'var(--negative)' }}>{err}</div>;
  if (!data) return <div className="body-sm text-subtle">Loading…</div>;

  const all = data.items || [];
  // `analyst` is the general persona, which has no pillar of its own, so it
  // shows everything. A pillar persona shows its own items plus `cross`:
  // an account-wide item is relevant to every section by definition.
  const scoped = persona === 'analyst'
    ? all
    : all.filter(i => i.pillar === persona || i.pillar === 'cross');
  const items = showAll ? all : scoped;
  const hidden = all.length - scoped.length;

  if (!all.length) {
    return (
      <div className="body-sm text-subtle" style={{ padding: 'var(--s5) 0' }}>
        {data.briefing_id
          ? 'Nothing open. Every item from the last briefing is ticked off.'
          : 'No briefing yet for this client — generate one from the Strategy tab.'}
      </div>
    );
  }

  return (
    <div className="analyst-queue">
      {items.map(item => {
        const days = ageInDays(item.first_raised_at);
        // Past a week, say how long. The badge exists to make a stale item
        // uncomfortable, and nothing is uncomfortable on its first morning.
        const stale = days != null && days >= 7;
        return (
          <div key={item.id} className="analyst-queue-item">
            <input
              type="checkbox"
              checked={!!item.done}
              disabled={busy === item.id}
              onChange={() => toggle(item)}
              aria-label={`Mark done: ${item.text}`}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="analyst-queue-head">
                {item.priority === 'crucial' && <span className="chip chip-warning">Crucial</span>}
                <span className="analyst-queue-pillar">{PILLAR_LABEL[item.pillar] || item.pillar}</span>
                {stale && <span className="queue-age">{days} days open</span>}
              </div>
              <div className="analyst-queue-text">{item.text}</div>
              {item.rationale && <div className="analyst-queue-why">{item.rationale}</div>}
            </div>
          </div>
        );
      })}

      {/* The count of what the scoping hid, so a short list on Paid never reads
          as "the account is quiet" when it is only this pillar that is. */}
      {hidden > 0 && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)' }}
          onClick={() => setShowAll(a => !a)}>
          {showAll ? `Show ${PILLAR_LABEL[persona] || 'this section'} only` : `Show ${hidden} item${hidden === 1 ? '' : 's'} from other sections`}
        </button>
      )}
      {!items.length && (
        <div className="body-sm text-subtle" style={{ padding: 'var(--s4) 0' }}>
          Nothing open for {PILLAR_LABEL[persona] || 'this section'}.
        </div>
      )}
    </div>
  );
}
