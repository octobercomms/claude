import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { primaryBtn, secondaryBtn, COLORS } from '../styles/theme';

const intentColours = {
  Informational: { bg: '#e8f1ff', fg: '#1a4f9c' },
  Navigational:  { bg: '#f4eafd', fg: '#5e2d8c' },
  Commercial:    { bg: '#fff4d6', fg: '#8a6500' },
  Transactional: { bg: '#e4f4e8', fg: '#1d7a3a' },
};

export function IntentBadge({ intent }) {
  if (!intent) return null;
  const c = intentColours[intent] || { bg: '#eee', fg: '#666' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: 0.4, padding: '2px 6px', borderRadius: 3, background: c.bg, color: c.fg, marginLeft: 6,
    }}>{intent.slice(0, 4)}</span>
  );
}

const featureLabels = {
  featured_snippet: 'Snippet',
  images: 'Images',
  image_pack: 'Images',
  knowledge_panel: 'Knowledge',
  knowledge_graph: 'Knowledge',
  people_also_ask: 'PAA',
  video: 'Video',
  videos: 'Video',
  local_pack: 'Local',
  shopping: 'Shopping',
  ai_overview: 'AIO',
  twitter: 'Twitter',
  top_stories: 'News',
  recipes: 'Recipes',
  jobs: 'Jobs',
  related_searches: 'Related',
  sitelinks: 'Sitelinks',
};

export function SerpFeaturePills({ features }) {
  const arr = Array.isArray(features) ? features : [];
  if (!arr.length) return null;
  // Dedupe + map to label, keep order but cap at 4 visible
  const seen = new Set();
  const items = [];
  for (const f of arr) {
    const label = featureLabels[f] || f;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push(label);
    if (items.length >= 4) break;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, flexWrap: 'wrap' }}>
      {items.map(label => (
        <span key={label} style={{
          fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3,
          padding: '1px 5px', borderRadius: 3, background: '#f1f1f1', color: '#555',
        }}>{label}</span>
      ))}
      {arr.length > items.length && <span style={{ fontSize: 9, color: '#999' }}>+{arr.length - items.length}</span>}
    </span>
  );
}

// Full position history in a scrollable popover — replaces the 12-month
// chart-only view with a date-by-date list that scrolls without limit.
export function KeywordHistoryModal({ keywordId, keyword, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/rankings/keywords/${keywordId}/history`)
      .then(setRows)
      .catch(e => setErr(e.message));
  }, [keywordId]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Full position history</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>{keyword}</h2>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>×</button>
        </div>
        {err && <div style={styles.error}>{err}</div>}
        {!rows && !err && <div style={{ padding: 20, color: '#888' }}>Loading…</div>}
        {rows && rows.length === 0 && <div style={{ padding: 20, color: '#888' }}>No history yet — run a rank check to populate.</div>}
        {rows && rows.length > 0 && (
          <>
            <HistoryChart rows={rows} />
            <div style={styles.historyList}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#fafafa', borderBottom: '1px solid #ddd' }}>
                  <tr>
                    <th style={styles.thSmall}>Date</th>
                    <th style={styles.thSmall}>Position</th>
                    <th style={styles.thSmall}>Source</th>
                    <th style={styles.thSmall}>URL</th>
                    <th style={styles.thSmall}>SERP features</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={styles.tdSmall}>{new Date(r.checked_at).toLocaleDateString('en-GB')}</td>
                      <td style={styles.tdSmall}><strong>{r.position ?? '—'}</strong></td>
                      <td style={styles.tdSmall}>{r.source || 'dataforseo'}</td>
                      <td style={{ ...styles.tdSmall, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#1a1a1a' }}>{r.url.replace(/^https?:\/\//, '')}</a> : '—'}
                      </td>
                      <td style={styles.tdSmall}><SerpFeaturePills features={r.serp_features} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryChart({ rows }) {
  const series = [...rows].reverse().filter(r => r.position != null);
  if (series.length < 2) return null;
  return (
    <div style={{ height: 180, padding: '12px 12px 0' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
          <XAxis dataKey="checked_at" tick={{ fontSize: 10 }} tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
          <YAxis reversed tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip formatter={v => [`Position ${v}`, 'Rank']} labelFormatter={d => new Date(d).toLocaleDateString('en-GB')} />
          <Line type="monotone" dataKey="position" stroke="#1a1a1a" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── SEARCH CONSOLE TAB ──────────────────────────────────────────────────
export function SearchConsoleTab({ clientId }) {
  const [days, setDays] = useState(28);
  const [queries, setQueries] = useState(null);
  const [pages, setPages] = useState(null);
  const [devices, setDevices] = useState(null);
  const [sitemaps, setSitemaps] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [q, p, d, sm] = await Promise.all([
        api.get(`/seo/clients/${clientId}/gsc/queries?days=${days}`),
        api.get(`/seo/clients/${clientId}/gsc/pages?days=${days}`),
        api.get(`/seo/clients/${clientId}/gsc/devices?days=${days}`),
        api.get(`/seo/clients/${clientId}/gsc/sitemaps`).catch(() => ({ sitemaps: [] })),
      ]);
      setQueries(q); setPages(p); setDevices(d); setSitemaps(sm.sitemaps);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, [days, clientId]);

  if (err) return <div style={styles.error}>{err}</div>;
  if (loading || !queries) return <div style={{ color: '#888', padding: 20 }}>Loading Search Console data…</div>;

  return (
    <div>
      <div style={styles.rowHeader}>
        <h2 style={styles.h2}>Search Console</h2>
        <div>
          {[7, 28, 90, 180].map(n => (
            <button key={n} onClick={() => setDays(n)} style={{ ...styles.rangeBtn, ...(days === n ? styles.rangeBtnActive : {}) }}>{n}D</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <GSCSection title="Top queries" rows={queries.rows} keyCol="query" cap={25} />
        <GSCSection title="Top pages" rows={pages.rows} keyCol="page" cap={25} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
        <GSCSection title="By device" rows={devices.rows} keyCol="device" cap={5} />
        <SitemapList sitemaps={sitemaps || []} />
      </div>
    </div>
  );
}

function GSCSection({ title, rows, keyCol, cap }) {
  const data = (rows || []).slice(0, cap);
  return (
    <div>
      <h3 style={styles.h3}>{title}</h3>
      <div style={styles.tableScroll}>
        <table style={styles.smallTable}>
          <thead>
            <tr>
              <th style={styles.thSmall}>{keyCol === 'query' ? 'Query' : keyCol === 'page' ? 'Page' : 'Device'}</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Clicks</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Impr.</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>CTR</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Pos.</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ ...styles.tdSmall, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {keyCol === 'page' && r.page ? <a href={r.page} target="_blank" rel="noreferrer" style={{ color: '#1a1a1a' }}>{r.page.replace(/^https?:\/\//, '')}</a> : r[keyCol]}
                </td>
                <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{r.clicks.toLocaleString()}</td>
                <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
                <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{(r.ctr * 100).toFixed(1)}%</td>
                <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{r.position.toFixed(1)}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={5} style={{ ...styles.tdSmall, color: '#888' }}>No data.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SitemapList({ sitemaps }) {
  return (
    <div>
      <h3 style={styles.h3}>Sitemaps</h3>
      <div style={styles.tableScroll}>
        <table style={styles.smallTable}>
          <thead>
            <tr>
              <th style={styles.thSmall}>Sitemap</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Submitted</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Indexed</th>
              <th style={{ ...styles.thSmall, textAlign: 'right' }}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {sitemaps.map((sm, i) => {
              const submitted = sm.contents.reduce((s, c) => s + c.submitted, 0);
              const indexed = sm.contents.reduce((s, c) => s + c.indexed, 0);
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ ...styles.tdSmall, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={sm.path} target="_blank" rel="noreferrer" style={{ color: '#1a1a1a' }}>{sm.path.replace(/^https?:\/\//, '')}</a>
                  </td>
                  <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{submitted.toLocaleString()}</td>
                  <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{indexed.toLocaleString()}</td>
                  <td style={{ ...styles.tdSmall, textAlign: 'right', color: sm.errors > 0 ? '#c62828' : '#888' }}>{sm.errors}</td>
                </tr>
              );
            })}
            {!sitemaps.length && <tr><td colSpan={4} style={{ ...styles.tdSmall, color: '#888' }}>No sitemaps registered with Search Console.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── AI OVERVIEWS TAB ────────────────────────────────────────────────────
export function AIOverviewsTab({ clientId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [checking, setChecking] = useState(false);

  async function load() {
    try {
      const d = await api.get(`/seo/clients/${clientId}/aio`);
      setData(d);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function runCheckNow() {
    setChecking(true);
    setErr(null);
    try {
      await api.post(`/seo/clients/${clientId}/aio/check-now`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  }

  if (err) return <div style={styles.error}>{err}</div>;
  if (!data) return <div style={{ color: '#888', padding: 20 }}>Loading AI Overview data…</div>;

  const latest = data.latest || [];
  const trend = data.trend || [];
  const presentNow = latest.filter(r => r.present).length;
  const citedNow = latest.filter(r => r.brand_cited).length;

  return (
    <div>
      <div style={styles.rowHeader}>
        <div>
          <h2 style={styles.h2}>AI Overviews</h2>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
            Tracks whether Google shows an AI Overview for your keywords and whether your brand is cited inside it.
            Auto-refreshes weekly.
          </p>
        </div>
        <button onClick={runCheckNow} style={primaryBtn} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14, marginBottom: 18 }}>
        <SummaryCard label="Keywords tracked" value={latest.length} />
        <SummaryCard label="Currently triggering AIO" value={presentNow} pct={latest.length ? Math.round(presentNow / latest.length * 100) : null} />
        <SummaryCard label="Your brand cited" value={citedNow} pct={presentNow ? Math.round(citedNow / presentNow * 100) : null} />
      </div>

      {trend.length >= 2 && (
        <div style={{ height: 200, marginBottom: 24, border: '1px solid #eee', borderRadius: 4, padding: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Line dataKey="present_count" name="AIO present" stroke="#1a1a1a" strokeWidth={1.5} dot={{ r: 2 }} />
              <Line dataKey="cited_count" name="Brand cited" stroke={COLORS.yellow} strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <h3 style={styles.h3}>Per-keyword (latest)</h3>
      <div style={styles.tableScroll}>
        <table style={styles.smallTable}>
          <thead>
            <tr>
              <th style={styles.thSmall}>Keyword</th>
              <th style={styles.thSmall}>Intent</th>
              <th style={styles.thSmall}>AIO present</th>
              <th style={styles.thSmall}>Brand cited</th>
              <th style={styles.thSmall}>Snippet</th>
              <th style={styles.thSmall}>Checked</th>
            </tr>
          </thead>
          <tbody>
            {latest.map(r => (
              <tr key={r.keyword_id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={styles.tdSmall}><strong>{r.keyword}</strong></td>
                <td style={styles.tdSmall}><IntentBadge intent={r.intent} /></td>
                <td style={styles.tdSmall}>{r.present ? <span style={styles.tagYes}>Yes</span> : <span style={styles.tagNo}>No</span>}</td>
                <td style={styles.tdSmall}>{r.brand_cited ? <span style={styles.tagYes}>Yes</span> : <span style={styles.tagNo}>—</span>}</td>
                <td style={{ ...styles.tdSmall, maxWidth: 420, color: '#666', fontSize: 11 }}>{r.snippet ? r.snippet.slice(0, 160) + (r.snippet.length > 160 ? '…' : '') : '—'}</td>
                <td style={styles.tdSmall}>{new Date(r.checked_at).toLocaleDateString('en-GB')}</td>
              </tr>
            ))}
            {!latest.length && <tr><td colSpan={6} style={{ ...styles.tdSmall, color: '#888', padding: 20, textAlign: 'center' }}>No AIO data yet — click "Check now" to populate.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, pct }) {
  return (
    <div style={{ flex: 1, padding: '14px 16px', border: '1px solid #eee', borderRadius: 4, background: '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}{pct != null && <span style={{ fontSize: 13, color: '#888', fontWeight: 400, marginLeft: 6 }}>({pct}%)</span>}</div>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── CONTENT GAPS TAB ────────────────────────────────────────────────────
export function ContentGapsTab({ clientId }) {
  const [competitors, setCompetitors] = useState([]);
  const [draft, setDraft] = useState('');
  const [gaps, setGaps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/seo/clients/${clientId}/competitors`)
      .then(r => setCompetitors(r.competitors || []))
      .catch(e => setErr(e.message));
  }, [clientId]);

  async function addCompetitor() {
    const trimmed = draft.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (!trimmed) return;
    const next = Array.from(new Set([...competitors, trimmed])).slice(0, 5);
    setSaving(true);
    try {
      const r = await api.put(`/seo/clients/${clientId}/competitors`, { competitors: next });
      setCompetitors(r.competitors);
      setDraft('');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function removeCompetitor(domain) {
    const next = competitors.filter(c => c !== domain);
    setSaving(true);
    try {
      const r = await api.put(`/seo/clients/${clientId}/competitors`, { competitors: next });
      setCompetitors(r.competitors);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function runGapAnalysis() {
    if (!competitors.length) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/content-gaps`, {});
      setGaps(r.gaps);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 style={styles.h2}>Content gaps</h2>
      <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
        Keywords competitors rank for that you don't. Add up to 5 competitor domains; we'll pull the union of their keywords minus yours from DataForSEO.
      </p>

      <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 4, padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Competitor domains</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {competitors.map(c => (
            <span key={c} style={styles.competitorChip}>
              {c}
              <button onClick={() => removeCompetitor(c)} style={styles.chipClose}>×</button>
            </span>
          ))}
          {!competitors.length && <span style={{ color: '#999', fontSize: 12 }}>(none yet)</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCompetitor()}
            placeholder="competitor.com"
            style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
            disabled={competitors.length >= 5}
          />
          <button onClick={addCompetitor} style={secondaryBtn} disabled={saving || !draft.trim() || competitors.length >= 5}>Add</button>
        </div>
      </div>

      <button onClick={runGapAnalysis} style={primaryBtn} disabled={loading || !competitors.length}>
        {loading ? 'Analysing…' : 'Run gap analysis'}
      </button>

      {err && <div style={{ ...styles.error, marginTop: 14 }}>{err}</div>}

      {gaps && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{gaps.length} keywords found</div>
          <div style={styles.tableScroll}>
            <table style={styles.smallTable}>
              <thead>
                <tr>
                  <th style={styles.thSmall}>Keyword</th>
                  <th style={{ ...styles.thSmall, textAlign: 'right' }}>Search vol.</th>
                  <th style={styles.thSmall}>Competitors ranking</th>
                  <th style={styles.thSmall}>Top position</th>
                </tr>
              </thead>
              <tbody>
                {gaps.slice(0, 200).map((g, i) => {
                  const positions = Object.entries(g.competitor_positions || {});
                  const best = positions.length ? Math.min(...positions.map(([, p]) => p)) : null;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={styles.tdSmall}><strong>{g.keyword}</strong></td>
                      <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{g.search_volume?.toLocaleString() || '—'}</td>
                      <td style={styles.tdSmall}>{(g.competitors || []).join(', ')}</td>
                      <td style={styles.tdSmall}>{best != null ? `#${best}` : '—'}</td>
                    </tr>
                  );
                })}
                {!gaps.length && <tr><td colSpan={4} style={{ ...styles.tdSmall, color: '#888', padding: 20, textAlign: 'center' }}>No gaps found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PLANNING TAB ────────────────────────────────────────────────────────
export function PlanningTab({ clientId }) {
  const [keyword, setKeyword] = useState('');
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function run() {
    if (!keyword.trim()) return;
    setLoading(true);
    setErr(null);
    setBrief(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/content-brief`, { keyword: keyword.trim() });
      setBrief(r.brief);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 style={styles.h2}>Content planning</h2>
      <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
        Generate a content brief for a target keyword. Claude proposes the angle, outline, target intent, headings,
        questions to answer, and meta tags. Edit it, send it to a writer.
      </p>

      <div style={{ display: 'flex', gap: 8, maxWidth: 600 }}>
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="e.g. how to season enamel cookware"
          style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
        />
        <button onClick={run} style={primaryBtn} disabled={loading || !keyword.trim()}>
          {loading ? 'Generating…' : 'Generate brief'}
        </button>
      </div>

      {err && <div style={{ ...styles.error, marginTop: 14 }}>{err}</div>}

      {brief && (
        <div style={{ marginTop: 22, maxWidth: 760 }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Target keyword</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{keyword}</div>
          <div style={{ marginBottom: 14 }}><IntentBadge intent={brief.target_intent} /></div>

          <BriefSection label="Title">{brief.title}</BriefSection>
          <BriefSection label="Pitch">{brief.summary}</BriefSection>
          <BriefSection label="Target length">{brief.suggested_word_count} words</BriefSection>

          <div style={styles.briefBlock}>
            <div style={styles.briefLabel}>Outline</div>
            {(brief.outline || []).map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{i + 1}. {s.heading}</div>
                <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                  {(s.points || []).map((p, j) => <li key={j}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <BriefList label="Questions to answer" items={brief.questions_to_answer} />
          <BriefList label="Suggested internal links" items={brief.internal_link_targets} />
          <BriefSection label="Meta title">{brief.meta_title}</BriefSection>
          <BriefSection label="Meta description">{brief.meta_description}</BriefSection>
        </div>
      )}
    </div>
  );
}

function BriefSection({ label, children }) {
  return (
    <div style={styles.briefBlock}>
      <div style={styles.briefLabel}>{label}</div>
      <div style={{ fontSize: 13, color: '#222', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function BriefList({ label, items }) {
  if (!items?.length) return null;
  return (
    <div style={styles.briefBlock}>
      <div style={styles.briefLabel}>{label}</div>
      <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: '#222', lineHeight: 1.7 }}>
        {items.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 880, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottom: '1px solid #eee' },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  historyList: { flex: 1, overflowY: 'auto', padding: 0 },
  thSmall: { padding: '6px 8px', fontSize: 10, textAlign: 'left', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #eee', whiteSpace: 'nowrap', background: '#fafafa' },
  tdSmall: { padding: '6px 8px', fontSize: 12, verticalAlign: 'middle' },
  smallTable: { width: '100%', borderCollapse: 'collapse', background: '#fff' },
  tableScroll: { maxHeight: 480, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4 },
  rowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  h2: { fontSize: 18, fontWeight: 700, margin: '0 0 4px' },
  h3: { fontSize: 13, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.5, color: '#666' },
  rangeBtn: { padding: '4px 10px', fontSize: 11, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', marginLeft: 4, borderRadius: 4 },
  rangeBtnActive: { background: '#1a1a1a', color: '#fff', borderColor: '#1a1a1a' },
  error: { background: '#fdecea', color: '#c62828', fontSize: 12, padding: 10, borderRadius: 4 },
  tagYes: { display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#e4f4e8', color: '#1d7a3a' },
  tagNo: { display: 'inline-block', fontSize: 11, color: '#888' },
  competitorChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: 999, fontSize: 12, fontFamily: 'monospace' },
  chipClose: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', color: '#999' },
  briefBlock: { marginBottom: 14 },
  briefLabel: { fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
};
