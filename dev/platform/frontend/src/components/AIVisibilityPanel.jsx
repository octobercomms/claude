// AI Visibility (AEO) panel — rendered inline inside the Organic suite
// (ClientSEOPage) when the AI Visibility tab is active. The parent owns
// the hero + SuiteTabs strip; this component renders only the body.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';
import Card from './ui/Card';
import Section from './ui/Section';
import Button from './ui/Button';
import Chip from './ui/Chip';
import EmptyState from './ui/EmptyState';
import Sparkline from './Sparkline';

const ENGINE_LABEL = {
  claude: 'Claude',
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  google_aio: 'Google AI Overviews',
};

export default function AIVisibilityPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [prompts, setPrompts] = useState([]);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggested, setSuggested] = useState(null);
  const [newPrompt, setNewPrompt] = useState('');

  async function loadAll() {
    const [p, s, t, r] = await Promise.all([
      api.get(`/ai-visibility/clients/${clientId}/prompts`).catch(() => []),
      api.get(`/ai-visibility/clients/${clientId}/summary`).catch(() => null),
      api.get(`/ai-visibility/clients/${clientId}/trend?weeks=12`).catch(() => []),
      api.get(`/ai-visibility/clients/${clientId}/runs?limit=30`).catch(() => []),
    ]);
    setPrompts(p || []); setSummary(s); setTrend(t || []); setRuns(r || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [clientId]);

  async function runNow() {
    if (!prompts.some(p => p.active)) { toast('Add at least one prompt first.', 'error'); return; }
    if (!confirm('Run every active prompt across every supported engine now? This will use API credit.')) return;
    setRunning(true);
    try {
      await api.post(`/ai-visibility/clients/${clientId}/run`, {});
      await loadAll();
      toast('Visibility check complete.', 'success');
    } catch (e) { toast(`Run failed: ${e.message}`, 'error'); }
    finally { setRunning(false); }
  }

  async function generatePrompts() {
    setGenerating(true);
    try {
      const r = await api.post(`/ai-visibility/clients/${clientId}/prompts/generate`, {});
      setSuggested(r.prompts || []);
    } catch (e) { toast(`Generate failed: ${e.message}`, 'error'); }
    finally { setGenerating(false); }
  }

  async function saveSuggested(selected) {
    try {
      await api.post(`/ai-visibility/clients/${clientId}/prompts/bulk`, { prompts: selected.map(prompt => ({ prompt })) });
      setSuggested(null);
      await loadAll();
      toast(`Added ${selected.length} prompt${selected.length === 1 ? '' : 's'}.`, 'success');
    } catch (e) { toast(`Save failed: ${e.message}`, 'error'); }
  }

  async function addPrompt() {
    if (!newPrompt.trim()) return;
    try {
      await api.post(`/ai-visibility/clients/${clientId}/prompts`, { prompt: newPrompt.trim() });
      setNewPrompt('');
      await loadAll();
    } catch (e) { toast(`Add failed: ${e.message}`, 'error'); }
  }

  async function togglePrompt(p) {
    try {
      await api.put(`/ai-visibility/prompts/${p.id}`, { active: !p.active });
      setPrompts(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x));
    } catch (e) { toast(`Toggle failed: ${e.message}`, 'error'); }
  }

  async function deletePrompt(p) {
    if (!confirm('Delete this prompt?')) return;
    try {
      await api.delete(`/ai-visibility/prompts/${p.id}`);
      setPrompts(prev => prev.filter(x => x.id !== p.id));
    } catch (e) { toast(`Delete failed: ${e.message}`, 'error'); }
  }

  if (loading) return null;

  const sov = summary?.brand_share_of_voice ?? 0;
  const trendSov = trend.map(t => t.sov);

  return (
    <>
      <p className="body mt-4 mb-6">
        Where this brand shows up when real users ask Claude, ChatGPT, Gemini, Perplexity, and Google AI Overviews questions in your category. The new SEO — answer engine optimisation.
      </p>

      <div className="metric-grid">
        <div className="metric-card accent">
          <div className="caption">Share of voice · 30d</div>
          <div className="metric-row">
            <div className="metric text-accent">{sov}%</div>
            {trendSov.length > 1 && <Sparkline values={trendSov} width={80} height={22} />}
          </div>
        </div>
        <div className="metric-card">
          <div className="caption">Active prompts</div>
          <div className="metric mt-2">{prompts.filter(p => p.active).length}</div>
        </div>
        <div className="metric-card">
          <div className="caption">Runs · 30d</div>
          <div className="metric mt-2">{summary?.total_runs || 0}</div>
        </div>
        <div className="metric-card">
          <div className="caption">Top competitor</div>
          <div className="h2 mt-2">{summary?.competitors?.[0]?.name || '—'}</div>
          {summary?.competitors?.[0] && (
            <div className="body-xs text-subtle mt-2">{summary.competitors[0].mentions} mentions</div>
          )}
        </div>
      </div>

      <div className="row wrap mb-6">
        <Button {...roWrite(readOnly, { onClick: runNow, disabled: running })}>
          {running ? 'Running…' : '↻ Run visibility check now'}
        </Button>
        <Button variant="secondary" {...roWrite(readOnly, { onClick: generatePrompts, disabled: generating })}>
          {generating ? 'Generating…' : '✨ Generate prompts with Claude'}
        </Button>
        {summary?.total_runs > 0 && (
          <a className="btn btn-secondary" href={`/api/ai-visibility/clients/${clientId}/report.pdf`} download
            title="Download a branded PDF of AI visibility to send to the client">⬇ Export PDF</a>
        )}
      </div>

      {/* How to actually move these numbers — the panel measures, this tells
          the AM what to do about it. Grounded in answer-engine best practice. */}
      <div className="card mb-6">
        <button type="button" onClick={() => setTipsOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="caption">Playbook</div>
            <div className="h3 mt-1">How to improve these numbers</div>
          </div>
          <span className="chip chip-neutral">{tipsOpen ? 'Hide' : 'Show'}</span>
        </button>
        {tipsOpen && (
          <div className="mt-4">
            <p className="body-sm text-muted mb-3">Answer engines cite the clearest, best-sourced answer to the exact question — not the highest-ranked page. To get mentioned more:</p>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
              <li className="body-sm"><strong>Answer the exact prompts.</strong> Take the prompts below where you're <em>not</em> mentioned and publish a page that answers each one directly — a question-shaped H2 with a self-contained ~130–170 word answer an engine can lift verbatim. (Use Build → the SXO / Find tools to turn a prompt into a brief.)</li>
              <li className="body-sm"><strong>Be the source engines trust.</strong> LLMs lean on Wikipedia, Reddit, YouTube and authoritative industry press. Earn mentions and citations there, not just on your own site.</li>
              <li className="body-sm"><strong>Structure for machines.</strong> Add FAQ / Article / Organization schema, clear headings, and tables/lists. Well-structured pages are far easier to quote.</li>
              <li className="body-sm"><strong>Be a clear entity.</strong> Consistent brand, product and author names across the web (schema <code>knowsAbout</code>, an About/Author page) help engines attribute answers to you.</li>
              <li className="body-sm"><strong>Earn trust (E‑E‑A‑T).</strong> Named authors, cited sources, visible dates. Engines prefer current, trustworthy pages — the Content Audit grades this.</li>
              <li className="body-sm"><strong>Skip the myths.</strong> An <code>llms.txt</code> file isn't a citation lever and AI-specific keyword-stuffing doesn't work — quotable, well-sourced answers are what get cited.</li>
            </ol>
          </div>
        )}
      </div>

      {!prompts.length && !suggested && (
        <EmptyState
          icon="🎯"
          title="No prompts yet"
          body="Generate a starter set with Claude — drawn from this client's brief and competitors. Trim or edit, then run the first visibility check."
          action={{ label: 'Generate prompts →', onClick: generatePrompts }}
        />
      )}

      {suggested && (
        <SuggestedPanel suggested={suggested} onSave={saveSuggested} onClose={() => setSuggested(null)} />
      )}

      {summary?.engines && Object.keys(summary.engines).length > 0 && (
        <Section caption="Where the brand shows up" title="By engine">
          <div className="grid grid-auto">
            {Object.entries(summary.engines).map(([eng, e]) => (
              <Card key={eng} variant="outline">
                <div className="caption">{ENGINE_LABEL[eng] || eng}</div>
                <div className="row mt-3" style={{ alignItems: 'baseline', gap: 8 }}>
                  <span className="metric">{e.share_of_voice}%</span>
                  <span className="body-sm">SoV</span>
                </div>
                <p className="body-xs text-subtle mt-3">
                  {e.brand_hits} of {e.runs} prompts mention us
                  {e.avg_position && ` · avg pos ${e.avg_position}`}
                </p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {summary?.competitors?.length > 0 && (
        <Section caption="Who else gets mentioned" title="Competitor leaderboard">
          <Card>
            {summary.competitors.slice(0, 10).map((c, i, arr) => (
              <div
                key={c.name}
                className="row between center"
                style={{
                  padding: '10px 12px',
                  borderBottom: i < arr.length - 1 ? '2px solid var(--oc-surface-raised)' : 'none',
                }}
              >
                <div className="row center">
                  <span className="body-xs text-subtle" style={{ width: 24 }}>#{i + 1}</span>
                  <span className="body">{c.name}</span>
                </div>
                <Chip>{c.mentions} mention{c.mentions === 1 ? '' : 's'}</Chip>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {prompts.length > 0 && (
        <Section caption="Prompts run weekly" title={`${prompts.filter(p => p.active).length} active`}>
          <Card>
            {prompts.map(p => (
              <div
                key={p.id}
                className="row center"
                style={{
                  padding: '10px 12px',
                  borderBottom: '2px solid var(--oc-surface-raised)',
                  opacity: p.active ? 1 : 0.5,
                }}
              >
                <input type="checkbox" checked={p.active} onChange={() => togglePrompt(p)} />
                <div className="body" style={{ flex: 1 }}>{p.prompt}</div>
                <Button variant="ghost" size="sm" onClick={() => deletePrompt(p)}>Delete</Button>
              </div>
            ))}
            <div className="row" style={{ padding: 10 }}>
              <input
                className="input"
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPrompt()}
                placeholder="Add a prompt — e.g. 'best edinburgh photographers for events'"
              />
              <Button onClick={addPrompt} disabled={!newPrompt.trim()}>Add</Button>
            </div>
          </Card>
        </Section>
      )}

      {runs.length > 0 && (
        <Section caption="What the engines said" title="Recent runs">
          <div className="stack stack-lg">
            {runs.slice(0, 12).map(r => (
              <Card key={r.id}>
                <div className="row between center mb-3">
                  <div className="row">
                    <Chip tone={r.brand_mentioned ? 'success' : 'neutral'}>
                      {r.brand_mentioned ? `✓ Mentioned${r.brand_position ? ` · #${r.brand_position}` : ''}` : 'Not mentioned'}
                    </Chip>
                    <Chip>{ENGINE_LABEL[r.engine] || r.engine}</Chip>
                    {r.sentiment && <Chip tone={r.sentiment === 'positive' ? 'success' : r.sentiment === 'negative' ? 'danger' : 'neutral'}>{r.sentiment}</Chip>}
                  </div>
                  <span className="body-xs text-subtle">{new Date(r.fetched_at).toLocaleString('en-GB')}</span>
                </div>
                <div className="h3">{r.prompt_text}</div>
                <p className="body-sm mt-2" style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {r.response_text?.slice(0, 800)}{r.response_text?.length > 800 ? '…' : ''}
                </p>
                {r.competitor_mentions?.length > 0 && (
                  <div className="row wrap mt-3">
                    {r.competitor_mentions.slice(0, 6).map(c => <Chip key={c}>{c}</Chip>)}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function SuggestedPanel({ suggested, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(suggested));
  function toggle(s) {
    setSelected(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });
  }
  return (
    <Card variant="accent" className="mb-6">
      <div className="row between center mb-3">
        <h2 className="h2">Claude's suggested prompts</h2>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
      </div>
      <p className="body-sm mb-4">
        Untick anything that doesn't apply, then save.
      </p>
      <div className="stack stack-sm" style={{ maxHeight: 360, overflow: 'auto' }}>
        {suggested.map((s, i) => (
          <label
            key={i}
            className="row"
            style={{
              padding: '6px 10px',
              background: 'var(--oc-surface)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} />
            <span className="body">{s}</span>
          </label>
        ))}
      </div>
      <div className="row end mt-5">
        <Button variant="secondary" onClick={onClose}>Discard</Button>
        <Button onClick={() => onSave([...selected])} disabled={!selected.size}>
          Save {selected.size} prompt{selected.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Card>
  );
}
