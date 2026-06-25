// Sales & Traffic → CRO / Funnel. Connects a client's free Microsoft Clarity
// project and turns its behaviour signals (rage clicks, dead clicks, excessive
// scroll, quick-backs, scroll depth, errors) into prioritised, concrete CRO
// fixes from Claude — the "your ads are fine, your funnel leaks" diagnosis.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const PRI = {
  critical: { label: 'Critical', color: '#b3261e', bg: 'rgba(179,38,30,0.10)' },
  high:     { label: 'High',     color: '#d1581e', bg: 'rgba(209,88,30,0.10)' },
  medium:   { label: 'Medium',   color: '#9a6b00', bg: 'rgba(154,107,0,0.10)' },
};

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; }
}

export default function ClarityCroPanel({ clientId }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [c, r] = await Promise.all([
        api.get(`/clarity/clients/${clientId}/config`),
        api.get(`/clarity/clients/${clientId}/report`),
      ]);
      setConfig(c); setReport(r.report || null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function runScan() {
    setRunning(true);
    try {
      const r = await api.post(`/clarity/clients/${clientId}/report/run`, {});
      setReport(r.report);
      toast('CRO scan complete.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 900 }}>
      <p className="body mb-4">
        Microsoft Clarity is a free behaviour-analytics tool (heatmaps + session recordings). Connect it and Claude
        reads the signals that reveal where your funnel leaks — rage clicks, dead clicks, excessive scrolling,
        quick-backs — and returns prioritised, concrete fixes. Perfect for "the ads are working but it's not converting".
      </p>

      {!config?.connected ? (
        <div className="callout">
          <strong>Microsoft Clarity isn't connected yet.</strong> Connect it under{' '}
          <Link to={`/clients/${clientId}?tab=connectors`} style={{ textDecoration: 'underline', fontWeight: 700 }}>Setup → Connectors</Link>
          {' '}(Behaviour Analytics), then come back here to run the CRO scan.
        </div>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="caption">Microsoft Clarity</div>
              <div className="body-sm" style={{ marginTop: 2 }}>
                <span style={{ color: 'var(--positive, #1a7f37)', fontWeight: 600 }}>Connected</span>
                {report && <span className="text-subtle"> · last scan {fmt(report.generated_at)}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={runScan} disabled={running}>{running ? 'Scanning…' : (report ? 'Re-scan funnel' : 'Run CRO scan')}</button>
            </div>
          </div>

          {report ? (
            <div style={{ marginTop: 16 }}>
              {report.summary && <p className="body" style={{ marginBottom: 12 }}>{report.summary}</p>}
              <div className="stack stack-sm">
                {(report.findings || []).map((f, i) => {
                  const p = PRI[f.priority] || PRI.medium;
                  return (
                    <div key={i} className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${p.color}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: p.color, background: p.bg, padding: '2px 8px', borderRadius: 999 }}>{p.label}</span>
                        {f.url && <span className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{f.url}</span>}
                      </div>
                      {f.issue && <div className="body-sm" style={{ marginTop: 6 }}><strong>Issue:</strong> {f.issue}</div>}
                      {f.fix && <div className="body-sm" style={{ marginTop: 3 }}><strong>Fix:</strong> {f.fix}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="body-sm text-subtle" style={{ marginTop: 14 }}>No scan yet — run a CRO scan to pull the last 3 days of behaviour data and get prioritised fixes.</p>
          )}
        </>
      )}
    </div>
  );
}
