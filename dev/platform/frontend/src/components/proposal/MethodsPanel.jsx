import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

// The offer, editable. Add a method, name it, price it in three currencies,
// paste its GoCardless link per currency, and write the objectives, KPIs,
// strategy and tactics it delivers.
//
// Those four content blocks are the reason this screen exists. They used to be
// written fresh by Claude for every prospect, which made the proposal read as
// bespoke consulting and, worse, meant the KPIs in a document that becomes a
// contract on acceptance were invented on the spot. Decided here, once, they
// read identically in every proposal, and improving them improves every future
// proposal rather than one PDF.

const BLANK = {
  name: '', family: '', blurb: '', active: true, sort_order: 0,
  evidence_policy: 'full', scarcity: '',
  prices: {}, includes: [],
  objectives: { short: '', mid: '', long: '' },
  kpis: { committed: [], reported: [], close: '' },
  strategy: [], tactics: [], stages: [],
};

const asLines = (arr) => (Array.isArray(arr) ? arr : []).join('\n');
const toLines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

export default function MethodsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [currencies, setCurrencies] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function load() {
    try {
      const d = await api.get('/proposals/methods');
      setRows(d.methods || []);
      setCurrencies(d.currencies || []);
    } catch (e) { toast(e.message, 'error'); setRows([]); }
  }

  async function remove(m) {
    if (!confirm(`Remove ${m.name}?`)) return;
    try {
      const out = await api.delete(`/proposals/methods/${m.id}`);
      toast(out?.archived
        ? `Archived. ${out.used_by} proposal${out.used_by === 1 ? '' : 's'} used it, so it is kept for the history.`
        : 'Removed.', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  }

  if (rows === null) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;

  return (
    <div>
      <div className="row between center mb-3" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div>
          <div className="h3">Methods</div>
          <div className="body-sm text-muted" style={{ maxWidth: '62ch' }}>
            What you sell. The method you pick on the draft screen sets the objectives, KPIs,
            strategy and tactics in the proposal, so only the letter, the situation, the priority
            and the covering email are written per prospect.
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <a className="btn btn-secondary btn-sm" href="/proposals/sample" target="_blank" rel="noreferrer">See a sample proposal</a>
          <button className="btn btn-primary btn-sm" onClick={() => setOpenId('new')}>Add a method</button>
        </div>
      </div>

      {openId === 'new' && (
        <MethodForm method={BLANK} currencies={currencies}
          onDone={async () => { setOpenId(null); await load(); }} onCancel={() => setOpenId(null)} />
      )}

      {!rows.length && openId !== 'new' && (
        <div className="card"><div className="text-subtle" style={{ padding: 'var(--s5)' }}>
          No methods yet. Add one, and a proposal cannot be drafted until there is at least one,
          because a proposal with no price and no tactics is not a proposal.
        </div></div>
      )}

      {rows.map(m => openId === m.id ? (
        <MethodForm key={m.id} method={m} currencies={currencies}
          onDone={async () => { setOpenId(null); await load(); }} onCancel={() => setOpenId(null)} />
      ) : (
        <div key={m.id} className="card mb-2" style={{ opacity: m.active ? 1 : 0.6 }}>
          <div className="row between center" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
            <div>
              <div className="strong">{m.name} {!m.active && <span className="caption">· archived</span>}</div>
              <div className="body-sm text-muted">
                {m.family || 'no family'} · v{m.version} ·{' '}
                {currencies.map(c => {
                  const p = m.prices?.[c.code];
                  return (
                    <span key={c.code} style={{ marginRight: 10 }}>
                      {p ? `${c.symbol}${Number(p.monthly).toLocaleString('en-GB')}` : `${c.code} —`}
                      {p && !p.gocardless_url && <span title="No GoCardless link for this currency" style={{ color: 'var(--warning)' }}> ⚠</span>}
                    </span>
                  );
                })}
              </div>
              <div className="body-xs text-subtle mt-1">
                {m.evidence_policy === 'no_outcome_claims' && 'new service, no outcome claims · '}
                {Object.keys(m.objectives || {}).length ? '' : 'no objectives · '}
                {m.kpis?.committed?.length || 0} committed, {m.kpis?.reported?.length || 0} reported ·{' '}
                {(m.strategy || []).length} strategy · {(m.tactics || []).length} tactic groups
              </div>
            </div>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(m.id)}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(m)}>Remove</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MethodForm({ method, currencies, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    ...BLANK, ...method,
    objectives: { ...BLANK.objectives, ...(method.objectives || {}) },
    kpis: { ...BLANK.kpis, ...(method.kpis || {}) },
    prices: { ...(method.prices || {}) },
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setPrice = (code, k, v) => setF(p => ({
    ...p, prices: { ...p.prices, [code]: { ...(p.prices[code] || {}), [k]: v } },
  }));

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...f,
        includes: Array.isArray(f.includes) ? f.includes : toLines(f.includes),
        kpis: {
          committed: Array.isArray(f.kpis.committed) ? f.kpis.committed : toLines(f.kpis.committed),
          reported: Array.isArray(f.kpis.reported) ? f.kpis.reported : toLines(f.kpis.reported),
          close: f.kpis.close,
        },
      };
      if (method.id) await api.put(`/proposals/methods/${method.id}`, body);
      else await api.post('/proposals/methods', body);
      toast('Saved.', 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="card mb-3" style={{ borderColor: 'var(--accent)' }}>
      <div className="caption mb-3">{method.id ? 'Edit method' : 'New method'}</div>

      <Field label="Name — what the proposal calls this level">
        <input className="input" value={f.name} onChange={e => set('name', e.target.value)}
          placeholder="Earning Visibility · Advanced" />
      </Field>
      <Field label="Family — groups the levels of one method, and names it on the cover">
        <input className="input" value={f.family || ''} onChange={e => set('family', e.target.value)}
          placeholder="Earning Visibility Method" />
      </Field>
      <Field label="Reassurance line — sits under the price. 'Most take this', not 'recommended'">
        <textarea className="textarea" rows={2} value={f.blurb || ''} onChange={e => set('blurb', e.target.value)}
          placeholder="This is the level most practices at your stage take, because…" />
      </Field>

      {/* The rule from the Serious Buyer page, made enforceable. On
          'no_outcome_claims' the proof matcher withholds the case study and the
          writing prompt is told it may not imply a result this method produced.
          Left as something to remember, the engine would eventually break it,
          because matching's job is to surface the most persuasive item and a
          case study from another service scores well on sector overlap. */}
      <Field label="Evidence">
        <select className="input" value={f.evidence_policy || 'full'}
          onChange={e => set('evidence_policy', e.target.value)}>
          <option value="full">Established — case studies and results are fair game</option>
          <option value="no_outcome_claims">New service — no outcome claims until a client has run it</option>
        </select>
      </Field>
      {f.evidence_policy === 'no_outcome_claims' && (
        <div className="body-xs text-muted mb-3" style={{ maxWidth: '62ch' }}>
          Proposals selling this level will cite October&apos;s published record and its
          testimonials, will not attach a case study, and will say in the proof block that the
          method is new. The engine cannot be talked out of this by a refine.
        </div>
      )}
      <Field label="Availability — the honest scarcity line. Leave blank if places are not capped">
        <textarea className="textarea" rows={3} value={f.scarcity || ''} onChange={e => set('scarcity', e.target.value)}
          placeholder="Places in the founding cohort are capped at two practices, so delivery on the first clients is right. The founding rate holds for the first three months and moves to the standard rate once the case studies exist." />
      </Field>

      <div className="caption mt-4 mb-2">Prices</div>
      <div className="body-sm text-muted mb-2" style={{ maxWidth: '62ch' }}>
        Fixed per market, never converted: £2,500 and $2,500 are different prices on purpose.
        The currency is picked by hand on the draft screen. A level with no price in the chosen
        currency still drafts, and the proposal says the price is to confirm rather than inventing one.
      </div>
      {currencies.map(c => (
        <div key={c.code} className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 80 }}><Field label={c.code}><div className="strong" style={{ paddingTop: 8 }}>{c.symbol}</div></Field></div>
          <div style={{ flex: '0 1 130px' }}>
            <Field label="Monthly">
              <input className="input" type="number" min="0" value={f.prices[c.code]?.monthly ?? ''}
                onChange={e => setPrice(c.code, 'monthly', e.target.value)} placeholder="—" />
            </Field>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <Field label="Setup fee">
              <input className="input" type="number" min="0" value={f.prices[c.code]?.setup ?? ''}
                onChange={e => setPrice(c.code, 'setup', e.target.value)} placeholder="0" />
            </Field>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <Field label="GoCardless link for this currency">
              <input className="input" value={f.prices[c.code]?.gocardless_url ?? ''}
                onChange={e => setPrice(c.code, 'gocardless_url', e.target.value)}
                placeholder="https://pay.gocardless.com/…" />
            </Field>
          </div>
        </div>
      ))}

      <Field label="What is included — one per line, listed under the price">
        <textarea className="textarea" rows={5} value={asLines(f.includes)}
          onChange={e => set('includes', toLines(e.target.value))}
          placeholder={'Quarterly visibility audit\nTwo initiatives running concurrently'} />
      </Field>

      <div className="caption mt-4 mb-2">Objectives</div>
      <Field label="0-3 months"><input className="input" value={f.objectives.short}
        onChange={e => set('objectives', { ...f.objectives, short: e.target.value })} /></Field>
      <Field label="3-9 months"><input className="input" value={f.objectives.mid}
        onChange={e => set('objectives', { ...f.objectives, mid: e.target.value })} /></Field>
      <Field label="9-18 months"><input className="input" value={f.objectives.long}
        onChange={e => set('objectives', { ...f.objectives, long: e.target.value })} /></Field>

      <div className="caption mt-4 mb-2">What we measure</div>
      <div className="body-sm text-muted mb-2" style={{ maxWidth: '62ch' }}>
        Two tiers, and the split is what makes them work. Commit to your own output, because that
        is a promise you can keep. Report the outcome, because nobody can make a journalist publish
        and a prospect who has bought PR before knows it. Keep every reported line to something OMI
        already measures, so the proposal can print their current number beside the target.
      </div>
      <Field label="What we commit to — one per line. Your own deliverables">
        <textarea className="textarea" rows={4} value={asLines(f.kpis.committed)}
          onChange={e => set('kpis', { ...f.kpis, committed: toLines(e.target.value) })}
          placeholder={'Three projects documented and published per quarter\nTwelve named press approaches a month'} />
      </Field>
      <Field label="What we report and act on — one per line. The outcome">
        <textarea className="textarea" rows={5} value={asLines(f.kpis.reported)}
          onChange={e => set('kpis', { ...f.kpis, reported: toLines(e.target.value) })}
          placeholder={'Share of enquiries above the target project value\nPositions in the top ten for the six project types they want'} />
      </Field>
      <Field label="The line that closes the section">
        <input className="input" value={f.kpis.close || ''}
          onChange={e => set('kpis', { ...f.kpis, close: e.target.value })}
          placeholder="If the second list is not moving by the end of the first quarter we change the tactics, not the invoice." />
      </Field>

      <div className="caption mt-4 mb-2">Strategy</div>
      <Repeater rows={f.strategy} onChange={v => set('strategy', v)} blank={{ title: '', text: '' }}
        addLabel="Add a strategic move" render={(row, up) => (<>
          <Field label="Title"><input className="input" value={row.title} onChange={e => up({ ...row, title: e.target.value })} /></Field>
          <Field label="Text"><textarea className="textarea" rows={3} value={row.text} onChange={e => up({ ...row, text: e.target.value })} /></Field>
        </>)} />

      <div className="caption mt-4 mb-2">Tactics</div>
      <Repeater rows={f.tactics} onChange={v => set('tactics', v)} blank={{ heading: '', items: [] }}
        addLabel="Add a tactic group" render={(row, up) => (<>
          <Field label="Heading"><input className="input" value={row.heading} onChange={e => up({ ...row, heading: e.target.value })} placeholder="documentation" /></Field>
          <Field label="Items, one per line"><textarea className="textarea" rows={4} value={asLines(row.items)}
            onChange={e => up({ ...row, items: toLines(e.target.value) })} /></Field>
        </>)} />

      <div className="caption mt-4 mb-2">How we work together</div>
      <div className="body-sm text-muted mb-2">The stages block, between strategy and tactics in the proposal.</div>
      <Repeater rows={f.stages} onChange={v => set('stages', v)} blank={{ stage: '', when: '', title: '', text: '' }}
        addLabel="Add a stage" render={(row, up) => (<>
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <div style={{ flex: '0 1 90px' }}><Field label="No."><input className="input" value={row.stage} onChange={e => up({ ...row, stage: e.target.value })} placeholder="01" /></Field></div>
            <div style={{ flex: '0 1 160px' }}><Field label="When"><input className="input" value={row.when} onChange={e => up({ ...row, when: e.target.value })} placeholder="month one" /></Field></div>
            <div style={{ flex: 1 }}><Field label="Title"><input className="input" value={row.title} onChange={e => up({ ...row, title: e.target.value })} placeholder="the audit" /></Field></div>
          </div>
          <Field label="Text"><textarea className="textarea" rows={3} value={row.text} onChange={e => up({ ...row, text: e.target.value })} /></Field>
        </>)} />

      <div className="row mt-4" style={{ gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>
          {busy ? 'Saving…' : 'Save method'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <label className="row center body-sm" style={{ gap: 'var(--s2)', marginLeft: 'auto' }}>
          <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} />
          Offer this on the draft screen
        </label>
      </div>
      {method.id && (
        <div className="body-xs text-subtle mt-2">
          Changing the objectives, measures, strategy, tactics or stages bumps this to v{method.version + 1}.
          Proposals already sent keep their own copy, so nothing you have signed is rewritten.
        </div>
      )}
    </div>
  );
}

function Repeater({ rows, onChange, blank, render, addLabel }) {
  const list = Array.isArray(rows) ? rows : [];
  const up = (i) => (row) => onChange(list.map((r, j) => (j === i ? row : r)));
  return (
    <>
      {list.map((row, i) => (
        <div key={i} style={{
          borderLeft: '2px solid var(--border-neutral)', paddingLeft: 'var(--s3)',
          marginBottom: 'var(--s3)',
        }}>
          {render(row, up(i))}
          <button className="btn btn-ghost btn-sm" onClick={() => onChange(list.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" onClick={() => onChange([...list, { ...blank }])}>{addLabel}</button>
    </>
  );
}

function Field({ label, children }) {
  return <div className="field"><label className="field-label">{label}</label>{children}</div>;
}
