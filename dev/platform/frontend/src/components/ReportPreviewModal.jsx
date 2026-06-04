import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { primaryBtn, secondaryBtn } from '../styles/theme';

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
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {reportType === 'weekly' ? 'Weekly' : 'Monthly'} preview — {clientName}
            </h2>
            <div style={styles.hint}>
              Same data + narratives the real report would use, rendered inline.
              No PDF, no email. Cached for 10 minutes — click "Refresh data" to re-pull live.
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>×</button>
        </div>

        <div style={styles.controls}>
          <div style={styles.controlGroup}>
            <button
              type="button"
              onClick={() => onSwitchType && onSwitchType('weekly')}
              style={reportType === 'weekly' ? styles.toggleActive : styles.toggle}
            >Weekly</button>
            <button
              type="button"
              onClick={() => onSwitchType && onSwitchType('monthly')}
              style={reportType === 'monthly' ? styles.toggleActive : styles.toggle}
            >Monthly</button>
          </div>
          <div style={styles.controlGroup}>
            <label style={styles.label}>Start</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={styles.input} />
            <label style={styles.label}>End</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={styles.input} />
          </div>
          <div style={styles.controlGroup}>
            <button type="button" onClick={() => run({ force: false })} style={primaryBtn} disabled={loading}>
              {loading ? 'Building…' : result ? 'Re-render' : 'Build preview'}
            </button>
            <button type="button" onClick={() => run({ force: true })} style={secondaryBtn} disabled={loading} title="Discard cache and re-pull all data + re-prompt Claude">
              Refresh data
            </button>
          </div>
        </div>

        {result && (
          <div style={styles.statusBar}>
            <span><strong>Period:</strong> {result.period}</span>
            <span><strong>Sections:</strong> {result.sections?.length || 0}</span>
            <span><strong>Narrative cache:</strong> {cache?.hits || 0} hits / {cache?.misses || 0} new</span>
            {dataAge != null && <span><strong>Data age:</strong> {dataAge < 60 ? `${dataAge}s` : `${Math.round(dataAge / 60)}m`}</span>}
            {errorCount > 0 && <span style={{ color: '#c62828' }}><strong>{errorCount}</strong> connector error{errorCount === 1 ? '' : 's'}</span>}
          </div>
        )}

        {errorCount > 0 && (
          <div style={styles.errorList}>
            {Object.entries(dataErrors).map(([k, v]) => (
              <div key={k}><strong>{k}:</strong> {v}</div>
            ))}
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.frameWrap}>
          {!result && !loading && (
            <div style={styles.placeholder}>
              Pick a period and click <strong>Build preview</strong> to see what this report will look like.
            </div>
          )}
          {loading && !result && (
            <div style={styles.placeholder}>Pulling data and running narratives…<br/><span style={{ color: '#888', fontSize: 12 }}>First run can take 20–60 seconds.</span></div>
          )}
          {result && (
            <iframe
              ref={iframeRef}
              title="Report preview"
              style={styles.iframe}
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 20, zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 1200, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 20px 8px' },
  hint: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.5, maxWidth: 720 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', padding: '8px 20px 14px', borderBottom: '1px solid #eee' },
  controlGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  toggle: { padding: '6px 14px', fontSize: 12, fontWeight: 600, border: '2px solid var(--accent)', background: '#fff', color: '#555', cursor: 'pointer', borderRadius: 999 },
  toggleActive: { padding: '6px 14px', fontSize: 12, fontWeight: 700, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', borderRadius: 999 },
  label: { fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { padding: '5px 8px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit' },
  statusBar: { display: 'flex', gap: 18, padding: '8px 20px', fontSize: 11, color: '#666', borderBottom: '1px solid #eee', flexWrap: 'wrap' },
  errorList: { padding: '8px 20px', fontSize: 11, color: '#c62828', background: '#fdecea', borderBottom: '1px solid #f5d0d0' },
  error: { padding: '10px 20px', color: '#c62828', background: '#fdecea', fontSize: 12 },
  frameWrap: { flex: 1, minHeight: 0, padding: 16, background: '#f6f6f6', display: 'flex', alignItems: 'stretch', justifyContent: 'center' },
  iframe: { flex: 1, background: '#fff', border: '2px solid var(--accent)', borderRadius: 4, width: '100%', height: '100%' },
  placeholder: { color: '#888', textAlign: 'center', alignSelf: 'center', margin: '0 auto', fontSize: 14, lineHeight: 1.6 },
};
