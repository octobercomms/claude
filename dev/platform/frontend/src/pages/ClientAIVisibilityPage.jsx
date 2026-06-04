// AI Visibility (AEO) page for the Organic suite. Tracks where the
// client's brand appears when real users ask LLM-backed answer
// engines (Claude, ChatGPT, Gemini, Perplexity, Google AI Overviews)
// questions in their category — the new SEO discipline.
//
// Sections:
//   1. Hero — Organic-suite olive accent, share-of-voice headline + trend
//   2. Per-engine breakdown — SoV per engine, avg position when mentioned
//   3. Competitor leaderboard — who else gets mentioned and how often
//   4. Prompts manager — list + add + Claude-generate starter set
//   5. Recent runs — every query + response with brand-hit chip

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import Card from '../components/ui/Card';
import Section from '../components/ui/Section';
import Button from '../components/ui/Button';
import Chip from '../components/ui/Chip';
import EmptyState from '../components/ui/EmptyState';
import Sparkline from '../components/Sparkline';
import { palette, space, type, radius } from '../styles/tokens';

const ACCENT = palette.suite.organic;
const SOFT = palette.suiteSoft.organic;

const ENGINE_LABEL = {
  claude: 'Claude',
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  google_aio: 'Google AI Overviews',
};

export default function ClientAIVisibilityPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggested, setSuggested] = useState(null);   // [strings] | null
  const [newPrompt, setNewPrompt] = useState('');

  async function loadAll() {
    const [c, p, s, t, r] = await Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/ai-visibility/clients/${id}/prompts`).catch(() => []),
      api.get(`/ai-visibility/clients/${id}/summary`).catch(() => null),
      api.get(`/ai-visibility/clients/${id}/trend?weeks=12`).catch(() => []),
      api.get(`/ai-visibility/clients/${id}/runs?limit=30`).catch(() => []),
    ]);
    setClient(c); setPrompts(p || []); setSummary(s); setTrend(t || []); setRuns(r || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [id]);

  async function runNow() {
    if (!prompts.some(p => p.active)) { toast('Add at least one prompt first.', 'error'); return; }
    if (!confirm('Run every active prompt across every supported engine now? This will use API credit.')) return;
    setRunning(true);
    try {
      await api.post(`/ai-visibility/clients/${id}/run`, {});
      await loadAll();
      toast('Visibility check complete.', 'success');
    } catch (e) {
      toast(`Run failed: ${e.message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  async function generatePrompts() {
    setGenerating(true);
    try {
      const r = await api.post(`/ai-visibility/clients/${id}/prompts/generate`, {});
      setSuggested(r.prompts || []);
    } catch (e) {
      toast(`Generate failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function saveSuggested(selected) {
    try {
      await api.post(`/ai-visibility/clients/${id}/prompts/bulk`, { prompts: selected.map(prompt => ({ prompt })) });
      setSuggested(null);
      await loadAll();
      toast(`Added ${selected.length} prompt${selected.length === 1 ? '' : 's'}.`, 'success');
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    }
  }

  async function addPrompt() {
    if (!newPrompt.trim()) return;
    try {
      await api.post(`/ai-visibility/clients/${id}/prompts`, { prompt: newPrompt.trim() });
      setNewPrompt('');
      await loadAll();
    } catch (e) {
      toast(`Add failed: ${e.message}`, 'error');
    }
  }

  async function togglePrompt(p) {
    try {
      await api.put(`/ai-visibility/prompts/${p.id}`, { active: !p.active });
      setPrompts(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x));
    } catch (e) {
      toast(`Toggle failed: ${e.message}`, 'error');
    }
  }

  async function deletePrompt(p) {
    if (!confirm('Delete this prompt?')) return;
    try {
      await api.delete(`/ai-visibility/prompts/${p.id}`);
      setPrompts(prev => prev.filter(x => x.id !== p.id));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  if (loading) return null;

  const sov = summary?.brand_share_of_voice ?? 0;
  const trendSov = trend.map(t => t.sov);
  const noPrompts = !prompts.length;

  return (
    <div>
      {/* HERO */}
      <div style={{ marginBottom: space[6] }}>
        <div style={{ ...type.caption, color: ACCENT }}>AI Visibility · Organic Suite</div>
        <div style={{ ...type.display, color: palette.text, marginTop: space[2] }}>{client?.name}</div>
        <div style={{ ...type.body, color: palette.textMuted, marginTop: space[2], maxWidth: 620 }}>
          Track where this brand shows up when real users ask Claude, ChatGPT, Gemini, Perplexity, and Google AI Overviews questions in your category. This is the new SEO — answer engine optimisation.
        </div>
      </div>

      {/* HERO METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space[3], marginBottom: space[5] }}>
        <Card padding={space[4]}>
          <div style={{ ...type.caption, color: palette.textSubtle }}>Share of voice · 30d</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space[2] }}>
            <div style={{ ...type.metric, color: ACCENT }}>{sov}%</div>
            {trendSov.length > 1 && <Sparkline values={trendSov} width={80} height={22} stroke={ACCENT} />}
          </div>
        </Card>
        <Card padding={space[4]}>
          <div style={{ ...type.caption, color: palette.textSubtle }}>Active prompts</div>
          <div style={{ ...type.metric, color: palette.text, marginTop: space[2] }}>{prompts.filter(p => p.active).length}</div>
        </Card>
        <Card padding={space[4]}>
          <div style={{ ...type.caption, color: palette.textSubtle }}>Runs · 30d</div>
          <div style={{ ...type.metric, color: palette.text, marginTop: space[2] }}>{summary?.total_runs || 0}</div>
        </Card>
        <Card padding={space[4]}>
          <div style={{ ...type.caption, color: palette.textSubtle }}>Top competitor</div>
          <div style={{ ...type.h2, color: palette.text, marginTop: space[2] }}>
            {summary?.competitors?.[0]?.name || '—'}
          </div>
          {summary?.competitors?.[0] && (
            <div style={{ ...type.bodyXs, color: palette.textMuted, marginTop: 4 }}>
              {summary.competitors[0].mentions} mentions
            </div>
          )}
        </Card>
      </div>

      {/* TOOLBAR */}
      <div style={{ display: 'flex', gap: 8, marginBottom: space[6], flexWrap: 'wrap' }}>
        <Button variant="primary" accent={ACCENT} onClick={runNow} disabled={running}>
          {running ? 'Running…' : '↻ Run visibility check now'}
        </Button>
        <Button variant="secondary" onClick={generatePrompts} disabled={generating}>
          {generating ? 'Generating…' : '✨ Generate prompts with Claude'}
        </Button>
      </div>

      {/* EMPTY STATE */}
      {noPrompts && !suggested && (
        <EmptyState
          icon="🎯"
          title="No prompts yet"
          body="Generate a starter set with Claude — they're drawn from this client's brief and competitors. Trim or edit, then run the first visibility check."
          action={{ label: 'Generate prompts →', onClick: generatePrompts }}
          accent={ACCENT}
        />
      )}

      {/* SUGGESTED PROMPTS */}
      {suggested && (
        <SuggestedPanel
          suggested={suggested}
          onSave={saveSuggested}
          onClose={() => setSuggested(null)}
        />
      )}

      {/* ENGINE BREAKDOWN */}
      {summary?.engines && Object.keys(summary.engines).length > 0 && (
        <Section caption="Where the brand shows up" title="By engine">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: space[3] }}>
            {Object.entries(summary.engines).map(([eng, e]) => (
              <Card key={eng} padding={space[4]} accent={ACCENT}>
                <div style={{ ...type.caption, color: palette.textSubtle }}>{ENGINE_LABEL[eng] || eng}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: space[2] }}>
                  <div style={{ ...type.metric, color: palette.text }}>{e.share_of_voice}%</div>
                  <div style={{ ...type.bodySm, color: palette.textMuted }}>SoV</div>
                </div>
                <div style={{ ...type.bodyXs, color: palette.textSubtle, marginTop: space[2] }}>
                  {e.brand_hits} of {e.runs} prompts mention us
                  {e.avg_position && ` · avg pos ${e.avg_position}`}
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* COMPETITOR LEADERBOARD */}
      {summary?.competitors?.length > 0 && (
        <Section caption="Who else gets mentioned" title="Competitor leaderboard">
          <Card padding={space[3]}>
            {summary.competitors.slice(0, 10).map((c, i) => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px',
                borderBottom: i < Math.min(summary.competitors.length, 10) - 1 ? `1px solid ${palette.border}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ ...type.bodyXs, color: palette.textSubtle, width: 20 }}>#{i + 1}</span>
                  <span style={{ ...type.body, color: palette.text }}>{c.name}</span>
                </div>
                <Chip tone="neutral">{c.mentions} mention{c.mentions === 1 ? '' : 's'}</Chip>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {/* PROMPTS LIST */}
      {prompts.length > 0 && (
        <Section caption="Prompts run weekly" title={`${prompts.filter(p => p.active).length} active`}>
          <Card padding={space[3]}>
            {prompts.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderBottom: `1px solid ${palette.border}`,
                opacity: p.active ? 1 : 0.5,
              }}>
                <input type="checkbox" checked={p.active} onChange={() => togglePrompt(p)} />
                <div style={{ ...type.body, color: palette.text, flex: 1 }}>{p.prompt}</div>
                <Button variant="ghost" size="sm" onClick={() => deletePrompt(p)} style={{ color: palette.danger }}>Delete</Button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, padding: '10px' }}>
              <input
                type="text" value={newPrompt} onChange={e => setNewPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPrompt()}
                placeholder="Add a prompt — e.g. 'best edinburgh photographers for events'"
                style={{ flex: 1, padding: '8px 12px', background: palette.surfaceRaised, color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 6, fontSize: 13 }}
              />
              <Button variant="primary" accent={ACCENT} onClick={addPrompt} disabled={!newPrompt.trim()}>Add</Button>
            </div>
          </Card>
        </Section>
      )}

      {/* RECENT RUNS */}
      {runs.length > 0 && (
        <Section caption="What the engines said" title="Recent runs">
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
            {runs.slice(0, 12).map(r => (
              <Card key={r.id} padding={space[4]}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: space[2] }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Chip tone={r.brand_mentioned ? 'success' : 'neutral'}>
                      {r.brand_mentioned ? `✓ Mentioned${r.brand_position ? ` · #${r.brand_position}` : ''}` : 'Not mentioned'}
                    </Chip>
                    <Chip tone="neutral">{ENGINE_LABEL[r.engine] || r.engine}</Chip>
                    {r.sentiment && <Chip tone={r.sentiment === 'positive' ? 'success' : r.sentiment === 'negative' ? 'danger' : 'neutral'}>{r.sentiment}</Chip>}
                  </div>
                  <div style={{ ...type.bodyXs, color: palette.textSubtle }}>{new Date(r.fetched_at).toLocaleString('en-GB')}</div>
                </div>
                <div style={{ ...type.body, color: palette.text, fontWeight: 600 }}>{r.prompt_text}</div>
                <div style={{ ...type.bodySm, color: palette.textMuted, marginTop: 6, lineHeight: 1.5, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {r.response_text?.slice(0, 800)}{r.response_text?.length > 800 ? '…' : ''}
                </div>
                {r.competitor_mentions?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.competitor_mentions.slice(0, 6).map(c => (
                      <Chip key={c} tone="neutral" style={{ fontSize: 10 }}>{c}</Chip>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SuggestedPanel({ suggested, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(suggested));
  function toggle(s) {
    setSelected(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  }
  return (
    <Card padding={space[5]} style={{ background: SOFT, border: `1px solid ${ACCENT}55`, marginBottom: space[6] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[3] }}>
        <div style={{ ...type.h2, color: palette.text }}>Claude's suggested prompts</div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: palette.textMuted, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ ...type.bodySm, color: palette.textMuted, marginBottom: space[4] }}>
        Untick anything that doesn't apply, then save. You can edit them after.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflow: 'auto' }}>
        {suggested.map((s, i) => (
          <label key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', background: palette.surface, borderRadius: radius.sm, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} />
            <span style={{ ...type.body, color: palette.text }}>{s}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: space[4] }}>
        <Button variant="secondary" onClick={onClose}>Discard</Button>
        <Button variant="primary" accent={ACCENT} onClick={() => onSave([...selected])} disabled={!selected.size}>
          Save {selected.size} prompt{selected.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Card>
  );
}
