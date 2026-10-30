import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

// Setup → Worked examples. One real piece of output per pillar, drawn from
// this client's own profile and badged so it is never mistaken for approved
// work.
//
// It lives on Setup because that is where a client is brought into being, and
// because the examples are only as good as the profile above them: run this
// before the briefing and brand assets are filled in and you get four thin
// examples. The panel says so rather than letting you find out.
//
// It never runs on its own. Generating is a real Claude spend on a real
// client, so it waits for the button, says what it will make before it makes
// it, and reports each pillar separately afterwards.
export default function WorkedExamplesPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    // Cleared on a client change before the fetch, so this panel can never
    // show one client's state under another's name.
    setStatus(null); setResults(null); setBusy(false);
    api.get(`/clients/${clientId}/worked-examples`)
      .then(setStatus)
      .catch(() => setStatus({ results: [], missing: 0, error: true }));
  }, [clientId]);

  async function generate() {
    setBusy(true); setResults(null);
    try {
      const out = await api.post(`/clients/${clientId}/worked-examples`, {});
      setResults(out);
      const made = out.created;
      if (out.failed) {
        toast(`${made} example${made === 1 ? '' : 's'} made, ${out.failed} failed.`, 'error');
      } else if (made) {
        toast(`${made} worked example${made === 1 ? '' : 's'} ready.`, 'success');
      } else {
        toast('Every pillar already had an example.', 'success');
      }
      setStatus(await api.get(`/clients/${clientId}/worked-examples`));
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  if (!status) return null;

  const rows = status.results || [];
  const missing = rows.filter(r => !r.present);
  const allPresent = rows.length > 0 && missing.length === 0;

  return (
    <div className="card" style={{ marginBottom: 'var(--s5)' }}>
      <div className="row between center" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <div className="caption">Worked examples</div>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: allPresent ? 'var(--positive)' : 'var(--text-muted)' }}>
          {rows.filter(r => r.present).length}/{rows.length} pillars
        </div>
      </div>

      <p className="body-sm text-muted" style={{ lineHeight: 1.6, margin: 'var(--s3) 0', maxWidth: 680 }}>
        One real piece of output per pillar, built from this client&apos;s profile
        and badged <strong>Example</strong> everywhere it appears. It gives a new
        client something to walk through, and something to show, instead of four
        empty pages. Run <strong>Quick Start</strong> and upload the brand assets
        first: the examples are only as good as the profile they are drawn
        from, and a blank profile makes four thin ones.
      </p>

      <ul style={{ listStyle: 'none', margin: '0 0 var(--s4)', padding: 0, display: 'grid', gap: 'var(--s2)' }}>
        {rows.map(r => {
          const outcome = results?.results?.find(x => x.pillar === r.pillar);
          return (
            <li key={r.pillar} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-body)' }}>
              <span style={{ width: 18, textAlign: 'center', color: r.present ? 'var(--positive)' : 'var(--text-subtle)' }}>
                {r.present ? '✓' : '·'}
              </span>
              <span style={{ fontWeight: 700, minWidth: 72 }}>{r.label}</span>
              <span className="body-sm text-muted">{r.what}</span>
              {outcome?.status === 'failed' && (
                <span className="chip chip-danger" title={outcome.error}>failed</span>
              )}
              {outcome?.status === 'created' && <span className="chip chip-success">new</span>}
              {outcome?.status === 'existed' && <span className="chip chip-neutral">already there</span>}
            </li>
          );
        })}
      </ul>

      {results?.failed > 0 && (
        <div className="callout callout-danger" style={{ fontSize: 'var(--fs-caption)', marginBottom: 'var(--s3)' }}>
          {results.results.filter(r => r.status === 'failed').map(r => (
            <div key={r.pillar}>{r.label}: {r.error}</div>
          ))}
        </div>
      )}

      <button className="btn btn-primary"
        {...roWrite(readOnly, { onClick: generate, disabled: busy || allPresent })}>
        {busy ? 'Generating…'
          : allPresent ? 'All four are built'
          : `Generate ${missing.length} missing example${missing.length === 1 ? '' : 's'}`}
      </button>
      {!allPresent && (
        <span className="body-xs text-subtle" style={{ marginLeft: 'var(--s3)' }}>
          One Claude call per pillar. Pressing it twice makes nothing twice.
        </span>
      )}
    </div>
  );
}
