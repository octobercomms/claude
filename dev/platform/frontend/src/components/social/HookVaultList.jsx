import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { FRAMEWORKS } from './hookExamples';

// Short-form numbers for the reach figures. A local copy rather than an import
// from the page: four lines against an import cycle is the right trade.
function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

// The Hook Vault's search + list, with no chrome, so the Learn tab, the modal
// and the Hook vault page all mount the same component.
//
// `onEmpty` lets the page show worked examples where the modal shows a line of
// text: a vault with nothing in it is the moment somebody most needs to be
// told what a hook is, and it was the moment the old copy said least.
export function HookVaultList({ clientId, onUse, onEmpty }) {
  const [hooks, setHooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [framework, setFramework] = useState('');
  const [search, setSearch] = useState('');
  // Debounce typing so we don't fire 8 requests for "carousel"
  const [searchDebounced, setSearchDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (framework) params.set('framework', framework);
    if (searchDebounced) params.set('q', searchDebounced);
    api.get(`/social/clients/${clientId}/hooks?${params.toString()}`)
      .then(r => setHooks(r || []))
      .catch(() => setHooks([]))
      .finally(() => setLoading(false));
  }, [clientId, framework, searchDebounced]);

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search hooks…"
          className="input" style={{ flex: 1 }} />
        <select value={framework} onChange={e => setFramework(e.target.value)} className="select">
          <option value="">All frameworks</option>
          {/* From hookExamples' FRAMEWORKS, so the filter and the worked
              examples cannot disagree about which frameworks exist. */}
          {FRAMEWORKS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-caption)' }}>Loading…</div>
      ) : !hooks.length ? (
        onEmpty ? onEmpty({ filtered: !!(framework || searchDebounced) }) : (
          <div style={{ color: 'var(--text-subtle)', padding: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-caption)' }}>
            No hooks yet. Generate a brainstorm batch — every hook you save lands here.
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)' }}>
          {hooks.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s2) var(--s3)', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ flex: 1, marginRight: 'var(--s3)' }}>
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text)', fontWeight: 600, lineHeight: 1.4 }}>{h.hook}</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)', display: 'flex', gap: 'var(--s2)' }}>
                  {h.framework && <span>{h.framework}</span>}
                  <span>·</span>
                  <span>{h.platform} / {h.kind}</span>
                  {h.best_reach > 0 && (<><span>·</span><span>best {formatNum(h.best_reach)} reach</span></>)}
                  {h.use_count > 1 && (<><span>·</span><span>used {h.use_count}×</span></>)}
                </div>
              </div>
              <button type="button" onClick={() => onUse(h.hook)}
                className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                Use this</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
