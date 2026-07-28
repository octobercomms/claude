// Client dashboard — ICP Intelligence Pack (AI Sniper funnel, Phase 1).
// The AM pastes raw customer research (call transcripts, win-loss notes, a
// service description); "Build with Claude" compresses it into an awareness map,
// a market-sophistication level, Voice-of-Customer (pains/desires/worldview) and
// a competitor angle. Data-first and honest: if the inputs are thin the pack
// says what's missing rather than inventing a customer. Backed by /api/funnel.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STAGE_LABEL = {
  'unaware': 'Unaware',
  'problem-aware': 'Problem-aware',
  'solution-aware': 'Solution-aware',
  'product-aware': 'Product-aware',
  'most-aware': 'Most-aware',
};
const STAGES = ['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware'];
const SOPH_LABEL = {
  1: '1 · First to market — lead with the claim',
  2: '2 · Competition — bigger/bolder claim',
  3: '3 · Skeptical — introduce a mechanism',
  4: '4 · Mechanism war — a better mechanism',
  5: '5 · Saturated — identity & experience',
};

function VocList({ title, items, tint }) {
  if (!items?.length) return null;
  return (
    <div className="card" style={{ padding: 'var(--s4)', background: tint }}>
      <div className="caption" style={{ marginBottom: 8 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => <li key={i} className="body-sm" style={{ marginBottom: 4, lineHeight: 1.45 }}>{it}</li>)}
      </ul>
    </div>
  );
}

export default function ICPIntelligencePanel({ clientId }) {
  const toast = useToast();
  const [pack, setPack] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [transcripts, setTranscripts] = useState('');
  const [notes, setNotes] = useState('');
  const [service, setService] = useState('');
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/funnel/clients/${clientId}/icp`).then(({ icp }) => {
      if (!live) return;
      setPack(icp);
      const inp = icp?.inputs || {};
      setTranscripts(inp.transcripts || '');
      setNotes(inp.notes || '');
      setService(inp.service_description || '');
    }).catch(() => {}).finally(() => live && setLoaded(true));
    return () => { live = false; };
  }, [clientId]);

  async function saveInputs() {
    setSaving(true);
    try {
      const { icp } = await api.put(`/funnel/clients/${clientId}/icp`, { transcripts, notes, service_description: service });
      setPack(p => ({ ...(p || {}), inputs: icp.inputs, status: icp.status }));
      setDirty(false);
      toast('Inputs saved.', 'success');
    } catch (e) { toast(`Couldn’t save: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  }

  async function build() {
    if (dirty) await saveInputs();
    setBuilding(true);
    try {
      const { icp } = await api.post(`/funnel/clients/${clientId}/icp/tailor`, {});
      setPack(icp);
      toast(icp.status === 'insufficient' ? 'Built — but the inputs are thin (see below).' : 'ICP Intelligence Pack built.', icp.status === 'insufficient' ? 'info' : 'success');
    } catch (e) { toast(`Build failed: ${e.message}`, 'error'); }
    finally { setBuilding(false); }
  }

  if (!loaded) return <div className="card" style={{ padding: 20, color: 'var(--text-subtle)' }}>Loading…</div>;

  const aware = pack?.awareness_map || null;
  const voc = pack?.voc || null;
  const suff = pack?.sufficiency || null;
  const built = !!pack?.generated_at;

  const onInput = (setter) => (e) => { setter(e.target.value); setDirty(true); };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>ICP Intelligence Pack</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 640, margin: 0, lineHeight: 1.5 }}>
          The customer-research layer that seeds resonant creative. Paste real call transcripts and win-loss notes —
          Claude extracts the awareness stage, market sophistication and Voice-of-Customer in the prospect’s own words.
          It only uses what you give it: thin inputs get an honest “insufficient” rather than an invented customer.
        </p>
      </div>

      {/* Inputs */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="caption" style={{ display: 'block', marginBottom: 4 }}>Service description</label>
          <textarea value={service} onChange={onInput(setService)} rows={2} className="input" style={{ width: '100%', resize: 'vertical' }}
            placeholder="What the client sells, to whom, and the core promise." />
        </div>
        <div>
          <label className="caption" style={{ display: 'block', marginBottom: 4 }}>Call transcripts / customer quotes</label>
          <textarea value={transcripts} onChange={onInput(setTranscripts)} rows={7} className="input" style={{ width: '100%', resize: 'vertical' }}
            placeholder="Paste sales/discovery call transcripts or verbatim customer quotes. This is the single biggest driver of a good pack — the more real language, the sharper the VoC." />
        </div>
        <div>
          <label className="caption" style={{ display: 'block', marginBottom: 4 }}>Win-loss notes / other research</label>
          <textarea value={notes} onChange={onInput(setNotes)} rows={3} className="input" style={{ width: '100%', resize: 'vertical' }}
            placeholder="Why deals were won or lost, objections, review-mining notes, survey answers…" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={build} disabled={building || saving}>
            {building ? 'Building…' : built ? 'Rebuild with Claude' : 'Build with Claude'}
          </button>
          <button className="btn btn-secondary" onClick={saveInputs} disabled={!dirty || saving || building}>
            {saving ? 'Saving…' : dirty ? 'Save inputs' : 'Saved'}
          </button>
          {pack?.generated_at && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Last built {new Date(pack.generated_at).toLocaleString('en-GB')}</span>}
        </div>
      </div>

      {/* Sufficiency guardrail */}
      {built && suff && !suff.sufficient && (
        <div className="callout callout-warning" style={{ fontSize: 13 }}>
          <strong>Inputs are thin.</strong> For a reliable pack, add: {suff.missing?.length ? suff.missing.join(', ') : 'more real customer language (transcripts, quotes)'}. What’s below is a best-effort read on limited material — treat it as provisional.
        </div>
      )}

      {/* The pack */}
      {built && (
        <div className="stack" style={{ gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {/* Awareness */}
            <div className="card" style={{ padding: 'var(--s4)' }}>
              <div className="caption" style={{ marginBottom: 8 }}>Awareness stage</div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {STAGES.map(s => (
                  <div key={s} title={STAGE_LABEL[s]} style={{ flex: 1, height: 6, borderRadius: 3, background: aware?.stage === s ? 'var(--accent)' : 'var(--card-border)' }} />
                ))}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{aware?.stage ? STAGE_LABEL[aware.stage] : '—'}</div>
              {aware?.rationale && <div className="body-sm" style={{ marginTop: 6, lineHeight: 1.45, color: 'var(--text-muted)' }}>{aware.rationale}</div>}
              {aware?.directness && <div className="body-xs" style={{ marginTop: 8 }}><strong>Ad directness:</strong> {aware.directness}</div>}
            </div>

            {/* Sophistication */}
            <div className="card" style={{ padding: 'var(--s4)' }}>
              <div className="caption" style={{ marginBottom: 8 }}>Market sophistication</div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} style={{ flex: 1, height: 6, borderRadius: 3, background: (pack.sophistication_level || 0) >= n ? 'var(--accent)' : 'var(--card-border)' }} />
                ))}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{pack.sophistication_level ? SOPH_LABEL[pack.sophistication_level] : '—'}</div>
              {pack.sophistication_note && <div className="body-sm" style={{ marginTop: 6, lineHeight: 1.45, color: 'var(--text-muted)' }}>{pack.sophistication_note}</div>}
            </div>
          </div>

          {/* VoC */}
          {voc && (voc.pains?.length || voc.desires?.length || voc.worldview?.length) ? (
            <div>
              <div className="caption" style={{ marginBottom: 8 }}>Voice of the customer — in their words</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <VocList title="Pains" items={voc.pains} tint="rgba(192,85,107,0.07)" />
                <VocList title="Desires" items={voc.desires} tint="rgba(46,125,87,0.07)" />
                <VocList title="Worldview" items={voc.worldview} tint="rgba(47,111,176,0.07)" />
              </div>
            </div>
          ) : null}

          {/* Competitor angle */}
          {pack.competitor_angle && (
            <div className="card" style={{ padding: 'var(--s4)', background: 'rgba(210,130,61,0.07)' }}>
              <div className="caption" style={{ marginBottom: 6 }}>Positioning angle vs competitors</div>
              <div className="body-sm" style={{ lineHeight: 1.5 }}>{pack.competitor_angle}</div>
            </div>
          )}
        </div>
      )}

      {!built && (
        <div className="card" style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13, lineHeight: 1.5 }}>
          No pack yet. Add whatever real customer material you have above and hit <strong>Build with Claude</strong>.
          Even a couple of call transcripts produces a sharper brief; the pack later seeds ad creative in Paid.
        </div>
      )}
    </div>
  );
}
