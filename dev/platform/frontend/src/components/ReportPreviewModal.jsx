import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

// Live report preview — runs the same template resolver as a real
// report against fresh connector data and renders the resulting HTML in
// an iframe. Repeated previews reuse cached data + narratives so
// iterating on a template feels instant after the first load.
export default function ReportPreviewModal({ clientId, clientName, reportType, onSwitchType, onClose }) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const iframeRef = useRef(null);

  // Default the period inputs to the same window the real report would use.
  useEffect(() => {
    const now = new Date();
    if (reportType === 'monthly') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setPeriodStart(start.toISOString().slice(0, 10));
      setPeriodEnd(end.toISOString().slice(0, 10));
    } else {
      const day = now.getDay();
      const lastSunday = new Date(now); lastSunday.setDate(now.getDate() - ((day + 6) % 7) - 1);
      const lastMonday = new Date(lastSunday); lastMonday.setDate(lastSunday.getDate() - 6);
      setPeriodStart(lastMonday.toISOString().slice(0, 10));
      setPeriodEnd(lastSunday.toISOString().slice(0, 10));
    }
    setResult(null);
  }, [reportType]);

  async function run({ force = false } = {}) {
    if (!periodStart || !periodEnd) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.post('/reports/preview', {
        client_id: clientId,
        report_type: reportType,
        period_start: periodStart,
        period_end: periodEnd,
        force_refresh: force,
      });
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Pipe the HTML into the iframe document once we have it. Using
  // contentDocument.write avoids the round-trip of srcDoc parsing and
  // lets the styled report render exactly as it does in the PDF.
  useEffect(() => {
    if (!result?.html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    doc.open();
    doc.write(result.html);
    doc.close();
  }, [result]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cache = result?.narrative_cache;
  const dataAge = result?.data_collected_at
    ? Math.max(0, Math.round((Date.now() - new Date(result.data_collected_at).getTime()) / 1000))
    : null;
  const dataErrors = result?.data_errors || {};
  const errorCount = Object.keys(dataErrors).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {reportType === 'weekly' ? 'Weekly' : 'Monthly'} preview — {clientName}
            </h2>
            <div className="body-sm text-muted">
              Same data + narratives the real report would use, rendered inline.
              No PDF, no email. Cached for 10 minutes — click "Refresh data" to re-pull live.
            </div>
          </div>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="row wrap" style={{ gap: 18, alignItems: 'center', padding: '8px 20px 14px', borderBottom: '2px solid var(--accent-soft)' }}>
          <div className="row center" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => onSwitchType && onSwitchType('weekly')}
              className={`btn btn-sm ${reportType === 'weekly' ? 'btn-primary' : 'btn-secondary'}`}
            >Weekly</button>
            <button
              type="button"
              onClick={() => onSwitchType && onSwitchType('monthly')}
              className={`btn btn-sm ${reportType === 'monthly' ? 'btn-primary' : 'btn-secondary'}`}
            >Monthly</button>
          </div>
          <div className="row center" style={{ gap: 6 }}>
            <label className="field-label">Start</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="input" />
            <label className="field-label">End</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="input" />
          </div>
          <div className="row center" style={{ gap: 6 }}>
            <button type="button" onClick={() => run({ force: false })} className="btn btn-primary" disabled={loading}>
              {loading ? 'Building…' : result ? 'Re-render' : 'Build preview'}
            </button>
            <button type="button" onClick={() => run({ force: true })} className="btn btn-secondary" disabled={loading} title="Discard cache and re-pull all data + re-prompt Claude">
              Refresh data
            </button>
          </div>
        </div>

        {result && (
          <div className="row wrap body-xs text-muted" style={{ gap: 18, padding: '8px 20px', borderBottom: '2px solid var(--accent-soft)' }}>
            <span><strong>Period:</strong> {result.period}</span>
            <span><strong>Sections:</strong> {result.sections?.length || 0}</span>
            <span><strong>Narrative cache:</strong> {cache?.hits || 0} hits / {cache?.misses || 0} new</span>
            {dataAge != null && <span><strong>Data age:</strong> {dataAge < 60 ? `${dataAge}s` : `${Math.round(dataAge / 60)}m`}</span>}
            {errorCount > 0 && <span className="text-negative"><strong>{errorCount}</strong> connector error{errorCount === 1 ? '' : 's'}</span>}
          </div>
        )}

        {errorCount > 0 && (
          <div className="callout callout-danger" style={{ margin: '8px 20px', fontSize: 11 }}>
            {Object.entries(dataErrors).map(([k, v]) => (
              <div key={k}><strong>{k}:</strong> {v}</div>
            ))}
          </div>
        )}

        {error && <div className="callout callout-danger">{error}</div>}

        <div style={{ flex: 1, minHeight: 0, padding: 16, background: 'var(--surface-raised)', display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
          {!result && !loading && (
            <div className="body text-subtle" style={{ textAlign: 'center', alignSelf: 'center' }}>
              Pick a period and click <strong>Build preview</strong> to see what this report will look like.
            </div>
          )}
          {loading && !result && (
            <div className="body text-subtle" style={{ textAlign: 'center', alignSelf: 'center' }}>
              Pulling data and running narratives…<br/>
              <span className="body-xs text-subtle">First run can take 20–60 seconds.</span>
            </div>
          )}
          {result && (
            <iframe
              ref={iframeRef}
              title="Report preview"
              style={{ flex: 1, background: 'var(--surface)', border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)', width: '100%', height: '100%' }}
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}
