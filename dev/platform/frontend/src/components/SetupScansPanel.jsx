import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';
import FeatureCost from './FeatureCost';

// Setup → Scans. Nine research runs, each with what it produces and what it
// has actually cost, and you run the ones you tick.
//
// Nine items in the 31 October review asked for a scan at setup. That is one
// decision, not nine, and it is a cost decision: each is a paid API call or a
// Claude run, so running all nine on every new client spends real money on
// the first click, most of it on scans nobody asked for. Showing the prices
// and running the ticked ones is how the Paid Brief step already works.
//
// Nothing is ticked when the panel opens. A default selection is a default
// spend, and the whole point of the picker is that the spend is chosen.
export default function SetupScansPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [data, setData] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [service, setService] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    // Cleared before the fetch, so this panel can never show one client's
    // state under another's name.
    setData(null); setResults(null); setTicked(new Set()); setService(''); setCity('');
    api.get(`/clients/${clientId}/setup-scans`)
      .then(setData)
      .catch(e => { setData({ scans: [], error: e.message }); });
  }, [clientId]);

  if (!data) return null;

  const scans = data.scans || [];
  const toRun = scans.filter(s => ticked.has(s.key));
  const needsServiceCity = toRun.some(s => s.wants_service_city);
  const haveServiceCity = service.trim() && city.trim();
  // A tick that cannot run is the one thing worth blocking on, because
  // pressing the button would spend on the others and silently skip this one.
  const blocked = needsServiceCity && !haveServiceCity;

  function toggle(key) {
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function runScans() {
    setBusy(true); setResults(null);
    try {
      const out = await api.post(`/clients/${clientId}/setup-scans`, {
        scans: [...ticked], service: service.trim(), city: city.trim(),
      });
      setResults(out);
      const bits = [];
      if (out.created) bits.push(`${out.created} run`);
      if (out.existed) bits.push(`${out.existed} already there`);
      if (out.skipped) bits.push(`${out.skipped} skipped`);
      if (out.failed) bits.push(`${out.failed} failed`);
      toast(bits.join(', ') || 'Nothing to run.', out.failed ? 'error' : 'success');
      setData(await api.get(`/clients/${clientId}/setup-scans`));
      setTicked(new Set());
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--s5)' }}>
      <div className="row between center wrap" style={{ gap: 'var(--s2)' }}>
        <div className="caption">Research scans</div>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-muted)' }}>
          {scans.filter(s => s.present).length}/{scans.length} run
        </div>
      </div>

      <p className="body-sm text-muted" style={{ lineHeight: 1.6, margin: 'var(--s3) 0', maxWidth: 680 }}>
        Nine pieces of research this client could start with. Each one is a paid
        API call or a Claude run, so none of them is ticked and none runs on its
        own. Tick what you want and press the button. The price beside each is
        the median of what that feature has actually cost over the last 30 days,
        not a quote, and a feature with no history yet shows none.
      </p>

      <ul style={{ listStyle: 'none', margin: '0 0 var(--s4)', padding: 0, display: 'grid', gap: 'var(--s2)' }}>
        {scans.map(s => {
          const outcome = results?.results?.find(x => x.key === s.key);
          const unavailable = s.missing.length > 0 && !s.missing.includes('service_city');
          return (
            <li key={s.key}>
              <label className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-start', margin: 0, cursor: unavailable ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={ticked.has(s.key)} disabled={readOnly || unavailable || busy}
                  onChange={() => toggle(s.key)} style={{ marginTop: 4 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="row wrap center" style={{ gap: 'var(--s2)' }}>
                    <strong style={{ fontSize: 'var(--fs-body)' }}>{s.label}</strong>
                    <FeatureCost feature={s.feature} />
                    {s.present && <span className="chip chip-neutral">already run</span>}
                    {outcome?.status === 'created' && <span className="chip chip-success">new</span>}
                    {outcome?.status === 'skipped' && <span className="chip chip-warning" title={outcome.reason}>skipped</span>}
                    {outcome?.status === 'failed' && <span className="chip chip-danger" title={outcome.error}>failed</span>}
                  </span>
                  <span className="body-sm text-muted" style={{ display: 'block', marginTop: 'var(--s1)' }}>{s.what}</span>
                  {/* What it is waiting on, said here rather than discovered
                      by pressing the button and reading a skip. */}
                  {s.missing_labels.length > 0 && (
                    <span className="body-xs text-subtle" style={{ display: 'block', marginTop: 'var(--s1)' }}>
                      Needs {s.missing_labels.join(' and ')}.
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Only asked for when something ticked needs it. There is no column on
          the client record for either, and asking every client for a service
          and a city they may not have is a form nobody fills in. */}
      {needsServiceCity && (
        <div className="row wrap" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, flex: '1 1 180px' }}>
            <label className="field-label">Service</label>
            <input className="input" value={service} onChange={e => setService(e.target.value)}
              placeholder="garden design" disabled={readOnly || busy} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label className="field-label">City</label>
            <input className="input" value={city} onChange={e => setCity(e.target.value)}
              placeholder="Guildford" disabled={readOnly || busy} />
          </div>
          <span className="body-xs text-subtle" style={{ flex: '1 1 240px' }}>
            The local scans need both. They are not on the client record, so they are asked for here.
          </span>
        </div>
      )}

      {results?.failed > 0 && (
        <div className="callout callout-danger" style={{ fontSize: 'var(--fs-caption)', marginBottom: 'var(--s3)' }}>
          {results.results.filter(r => r.status === 'failed').map(r => (
            <div key={r.key}>{r.label}: {r.error}</div>
          ))}
        </div>
      )}

      <div className="row wrap center" style={{ gap: 'var(--s3)' }}>
        <button className="btn btn-primary"
          {...roWrite(readOnly, { onClick: runScans, disabled: busy || !toRun.length || blocked })}>
          {busy ? 'Running…'
            : !toRun.length ? 'Tick the scans to run'
            : `Run ${toRun.length} scan${toRun.length === 1 ? '' : 's'}`}
        </button>
        <span className="body-xs text-subtle">
          {blocked
            ? 'A local scan is ticked — fill in the service and city above.'
            : 'A scan that has already run costs nothing to tick: it returns what it made the first time.'}
        </span>
      </div>
    </div>
  );
}
