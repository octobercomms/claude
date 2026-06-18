// Settings → Security. Shows the automated security audit: an overall risk
// badge, when it last ran, the full checklist grouped by area (so we can see
// every area was checked), and anything flagged for attention. Admin-only;
// the data comes from /api/security/audit, refreshed daily by cron with a
// "Run now" button here.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const RISK = {
  clean:         { label: 'Clean', color: 'var(--positive, #1a7f37)', bg: 'rgba(26,127,55,0.10)', blurb: 'All automated checks passed.' },
  hardening:     { label: 'Hardening items', color: '#9a6b00', bg: 'rgba(154,107,0,0.10)', blurb: 'No active vulnerabilities — a few defence-in-depth items to consider.' },
  action_needed: { label: 'Action needed', color: 'var(--negative, #b3261e)', bg: 'rgba(179,38,30,0.10)', blurb: 'One or more checks failed or raised a high-severity warning.' },
};

const STATUS_ICON = { pass: '✓', warn: '⚠', fail: '✕', unknown: '–' };
const STATUS_COLOR = { pass: 'var(--positive, #1a7f37)', warn: '#9a6b00', fail: 'var(--negative, #b3261e)', unknown: 'var(--text-subtle)' };
const SEV_COLOR = { critical: '#b3261e', high: '#d1581e', medium: '#9a6b00', low: 'var(--text-muted)', info: 'var(--text-subtle)' };

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; }
}

export default function SecurityPanel() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try { setData(await api.get('/security/audit')); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  async function runNow() {
    setRunning(true);
    try {
      await api.post('/security/audit/run', {});
      await load();
      toast('Security audit complete.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  if (loading) return <div className="text-subtle" style={{ padding: 20 }}>Running checks…</div>;
  if (!data?.latest) return <div className="text-subtle" style={{ padding: 20 }}>No audit yet.</div>;

  const { latest, check_count } = data;
  const findings = latest.findings || [];
  const risk = RISK[latest.risk] || RISK.hardening;
  const flagged = findings.filter(f => f.status === 'warn' || f.status === 'fail');

  // Group by area, preserving first-seen order.
  const areas = [];
  const byArea = {};
  for (const f of findings) {
    if (!byArea[f.area]) { byArea[f.area] = []; areas.push(f.area); }
    byArea[f.area].push(f);
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header card */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderLeft: `4px solid ${risk.color}` }}>
        <div>
          <div className="caption">Security posture</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: risk.color, background: risk.bg, padding: '3px 10px', borderRadius: 999 }}>{risk.label}</span>
            <span className="body-sm text-muted">{risk.blurb}</span>
          </div>
          <div className="body-xs text-subtle" style={{ marginTop: 8 }}>
            Last run {fmt(latest.created_at)} · {latest.trigger === 'cron' ? 'scheduled (daily)' : 'manual'} · {check_count} checks
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Tally n={latest.pass_count} label="pass" color={STATUS_COLOR.pass} />
            <Tally n={latest.warn_count} label="warn" color={STATUS_COLOR.warn} />
            <Tally n={latest.fail_count} label="fail" color={STATUS_COLOR.fail} />
          </div>
          <button className="btn btn-primary" onClick={runNow} disabled={running}>{running ? 'Running…' : 'Run now'}</button>
        </div>
      </div>

      {/* Flagged summary */}
      {flagged.length > 0 && (
        <div className="card" style={{ marginTop: 14, background: 'rgba(154,107,0,0.06)' }}>
          <div className="caption" style={{ marginBottom: 6 }}>{flagged.length} item{flagged.length === 1 ? '' : 's'} to review</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {flagged.map(f => (
              <li key={f.id} className="body-sm" style={{ marginBottom: 2 }}>
                <strong>{f.title}</strong> — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Full checklist by area */}
      <div style={{ marginTop: 18 }}>
        {areas.map(area => (
          <div key={area} style={{ marginBottom: 18 }}>
            <h3 className="h3" style={{ marginBottom: 8 }}>{area}</h3>
            <div className="stack stack-sm">
              {byArea[area].map(f => (
                <div key={f.id} className="card" style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ color: STATUS_COLOR[f.status], fontWeight: 700, fontSize: 15, lineHeight: '20px', width: 16, textAlign: 'center' }}>{STATUS_ICON[f.status] || '–'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="body" style={{ fontWeight: 600 }}>{f.title}</span>
                        {f.status !== 'pass' && f.severity !== 'info' && (
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: SEV_COLOR[f.severity] || 'var(--text-muted)' }}>{f.severity}</span>
                        )}
                      </div>
                      <div className="body-sm text-muted" style={{ marginTop: 2 }}>{f.detail}</div>
                      {f.recommendation && f.status !== 'pass' && (
                        <div className="body-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}><strong>Fix:</strong> {f.recommendation}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="body-xs text-subtle" style={{ marginTop: 8 }}>
        Automated checks run nightly. For a deeper review, run the full SECURITY_AUDIT.md prompt against the codebase periodically — these checks cover the reliably-automatable areas, not every vulnerability class.
      </p>
    </div>
  );
}

function Tally({ n, label, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 40 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: n ? color : 'var(--text-subtle)' }}>{n}</div>
      <div className="body-xs text-subtle">{label}</div>
    </div>
  );
}
