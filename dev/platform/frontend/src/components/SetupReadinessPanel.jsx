// Setup → Overview: a per-client readiness checklist. Shows what's configured
// vs. still needed for the platform's features to light up, each todo linking
// straight to where it's fixed. Read-only (GET /clients/:id/readiness).

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

export default function SetupReadinessPanel({ clientId }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get(`/clients/${clientId}/readiness`)
      .then(setData).catch(() => {}).finally(() => setLoaded(true));
  }, [clientId]);

  if (!loaded || !data) return null;
  const { score, checks } = data;
  const pct = score.total ? Math.round((score.done / score.total) * 100) : 0;
  const todos = checks.filter(c => c.status === 'todo');

  // link is either '?tab=…' (this Setup page) or '/social?tab=…' (another suite).
  function go(link) {
    if (!link) return;
    if (link.startsWith('?')) navigate(`/clients/${clientId}${link}`);
    else navigate(`/clients/${clientId}${link}`);
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row between center" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="caption">Setup readiness</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: pct === 100 ? 'var(--positive, #1a7f37)' : 'var(--text-muted)' }}>
          {score.done}/{score.total} complete
        </div>
      </div>
      <div style={{ height: 6, background: 'var(--surface-raised)', borderRadius: 999, overflow: 'hidden', margin: '8px 0 12px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--positive, #1a7f37)' : 'var(--accent)' }} />
      </div>

      {pct === 100 ? (
        <div className="body-sm" style={{ color: 'var(--positive, #1a7f37)' }}>✓ Everything's configured — all features are good to go.</div>
      ) : (
        <div className="stack stack-sm">
          {todos.map(c => (
            <div key={c.id} className="row between center" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--card-border)' }}>
              <div style={{ minWidth: 0 }}>
                <div className="body-sm" style={{ fontWeight: 600 }}>
                  <span style={{ color: 'var(--text-subtle)', fontWeight: 700, marginRight: 6 }}>○</span>{c.label}
                  <span className="text-subtle" style={{ fontWeight: 400 }}> · {c.area}</span>
                </div>
                <div className="body-xs text-muted" style={{ marginTop: 2 }}>{c.detail}</div>
              </div>
              {c.link && <button className="btn btn-secondary btn-sm" onClick={() => go(c.link)}>Set up →</button>}
            </div>
          ))}
        </div>
      )}

      {todos.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="body-xs text-subtle" style={{ cursor: 'pointer' }}>Show {score.done} completed</summary>
          <div className="stack stack-sm" style={{ marginTop: 8 }}>
            {checks.filter(c => c.status === 'ok').map(c => (
              <div key={c.id} className="body-sm" style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--positive, #1a7f37)', fontWeight: 700, marginRight: 6 }}>✓</span>{c.label}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
