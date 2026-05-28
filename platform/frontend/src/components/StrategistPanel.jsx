import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Internal Strategist reports for ads — Manus-style briefing notes. Left
// rail lists past reports newest first; right pane renders the selected
// report in markdown with table support via remark-gfm.
export default function StrategistPanel({ clientId, hasMeta, hasGoogle }) {
  const toast = useToast();
  const [reports, setReports] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState(7);

  useEffect(() => {
    api.get(`/strategist/clients/${clientId}/reports`)
      .then(r => { setReports(r); if (r.length) setSelectedId(r[0].id); })
      .catch(e => toast(e.message, 'error'));
  }, [clientId, toast]);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    api.get(`/strategist/reports/${selectedId}`)
      .then(setSelected)
      .catch(e => toast(e.message, 'error'));
  }, [selectedId, toast]);

  useEffect(() => {
    if (selected && selected.status === 'completed' && !selected.read_at) {
      api.post(`/strategist/reports/${selected.id}/read`, {}).catch(() => {});
    }
  }, [selected]);

  async function generate() {
    if (!hasMeta && !hasGoogle) {
      toast('Connect Meta Ads or Google Ads first.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const fresh = await api.post(`/strategist/clients/${clientId}/reports/generate`, { period_days: period });
      const list = await api.get(`/strategist/clients/${clientId}/reports`);
      setReports(list);
      setSelectedId(fresh.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function destroy(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this Strategist report? This cannot be undone.')) return;
    try {
      await api.delete(`/strategist/reports/${id}`);
      const list = await api.get(`/strategist/clients/${clientId}/reports`);
      setReports(list);
      if (selectedId === id) setSelectedId(list[0]?.id || null);
    } catch (e2) { toast(e2.message, 'error'); }
  }

  return (
    <div>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Internal · for the AM</div>
          <h2 style={styles.h2}>Strategist briefing</h2>
          <p style={styles.lede}>
            A private, structured analyst note on this client's Meta + Google Ads. Compares the last period
            against the previous one and tells you what to action next. Auto-generated every Monday at 07:00.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={period} onChange={e => setPeriod(parseInt(e.target.value, 10))} style={styles.select}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button onClick={generate} disabled={generating} style={generating ? { ...styles.btn, opacity: 0.6 } : styles.btn}>
            {generating ? 'Generating…' : '+ Generate report'}
          </button>
        </div>
      </div>

      {!reports && <div style={{ color: '#888', padding: 20 }}>Loading…</div>}
      {reports && reports.length === 0 && !generating && (
        <div style={styles.empty}>
          No reports yet for this client. Click <strong>Generate report</strong> to produce the first one — Claude will read the last {period} days of ad performance and write a Manus-style briefing.
        </div>
      )}

      {reports && reports.length > 0 && (
        <div style={styles.grid}>
          <div style={styles.list}>
            {reports.map(r => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                style={selectedId === r.id ? styles.listItemActive : styles.listItem}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 12 }}>
                    {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </strong>
                  {!r.read_at && r.status === 'completed' && <span style={styles.unreadDot} />}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {r.status === 'generating' && '· Generating…'}
                  {r.status === 'failed' && <span style={{ color: '#c62828' }}>✗ Failed</span>}
                  {r.status === 'completed' && (
                    <>
                      {r.trigger === 'weekly' ? 'weekly · ' : 'manual · '}
                      {fmtRelative(r.generated_at)}
                    </>
                  )}
                </div>
                <button onClick={(e) => destroy(r.id, e)} style={styles.delBtn} title="Delete">×</button>
              </button>
            ))}
          </div>

          <div style={styles.body}>
            {!selected && <div style={{ color: '#888' }}>Pick a report on the left.</div>}
            {selected && selected.status === 'generating' && (
              <div style={{ color: '#888' }}>Generating… this usually takes 30–60 seconds.</div>
            )}
            {selected && selected.status === 'failed' && (
              <div style={{ padding: 12, background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 4, color: '#c62828', fontSize: 13 }}>
                Generation failed: {selected.error_message || 'unknown error'}
              </div>
            )}
            {selected && selected.status === 'completed' && (
              <div style={styles.md}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {selected.markdown || ''}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function fmtRelative(d) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Inline styles that give the markdown a tighter, document feel instead
// of the default browser margins react-markdown emits.
const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 22, fontWeight: 700, margin: '24px 0 12px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 17, fontWeight: 700, margin: '24px 0 10px', paddingBottom: 6, borderBottom: '1px solid #e8e8e8' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '18px 0 8px', color: '#1a1a1a' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 12px', lineHeight: 1.6, fontSize: 14, color: '#1a1a1a' }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 6, lineHeight: 1.6, fontSize: 14 }} {...p} />,
  strong: ({ node, ...p }) => <strong style={{ color: '#1a1a1a' }} {...p} />,
  table: ({ node, ...p }) => <table style={{ width: '100%', borderCollapse: 'collapse', margin: '8px 0 18px', fontSize: 13 }} {...p} />,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #1a1a1a', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' }} {...p} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '20px 0' }} />,
  blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', paddingLeft: 14, color: '#444', margin: '10px 0' }} {...p} />,
  code: ({ node, inline, ...p }) => inline
    ? <code style={{ background: '#f5f5f5', padding: '1px 6px', borderRadius: 3, fontSize: 12 }} {...p} />
    : <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, fontSize: 12, overflowX: 'auto' }}><code {...p} /></pre>,
};

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' },
  eyebrow: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 4 },
  h2: { margin: 0, fontSize: 22, fontWeight: 700 },
  lede: { margin: '6px 0 0', fontSize: 13, color: '#666', maxWidth: 620, lineHeight: 1.5 },
  btn: { background: '#E7CD41', color: '#1a1a1a', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  select: { padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer' },
  empty: { padding: 30, color: '#666', background: '#fafafa', border: '1px solid #eee', borderRadius: 8, fontSize: 14, lineHeight: 1.6, textAlign: 'center' },
  grid: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 18, alignItems: 'start' },
  list: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 720, overflowY: 'auto' },
  listItem: { textAlign: 'left', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 12px', cursor: 'pointer', position: 'relative' },
  listItemActive: { textAlign: 'left', background: '#fffbeb', border: '1px solid #E7CD41', borderRadius: 6, padding: '10px 12px', cursor: 'pointer', position: 'relative' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, background: '#E7CD41' },
  delBtn: { position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16, lineHeight: 1, padding: '2px 4px' },
  body: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: '20px 26px', minHeight: 320 },
  md: { color: '#1a1a1a' },
};
