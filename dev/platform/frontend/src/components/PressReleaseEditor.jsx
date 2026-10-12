import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { analyse, MOVES } from '@shared/humanity.mjs';

/**
 * The release writing surface.
 *
 * Three things it is not, each deliberate:
 *
 * 1. It does not generate the release. "Build the fact sheet" returns slots and
 *    the questions that fill them. The sentences are written by a person. A
 *    Claude draft was flagged 100% AI, and flagged again after hand editing —
 *    the signal is structural, so the only lever is where the prose starts.
 *
 * 2. The live number is a FACT COUNT, not a humanity score. It rises when you
 *    add a checkable item and does not move when you reword a sentence, which
 *    is the truth: rewording does not shift a detector. A panel that appeared
 *    to reward rewriting would be lying and would train the exact habit the
 *    editorial standard bans.
 *
 * 3. Style markers are reported without highlights and without fix buttons, and
 *    they do not feed the headline number. They say where the prose came from.
 *    Underlining a coordinate list would be an instruction to go and break it,
 *    and deliberately roughened prose is a category detectors are trained on.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

const EMPTY_BRIEF = {
  news_hook: '',
  moves: { hook: '', scope: '', material: '', impact: '', context: '', proof: '' },
  quotes: [
    { name: '', title: '', organisation: '', quote: '' },
    { name: '', title: '', organisation: '', quote: '' },
    { name: '', title: '', organisation: '', quote: '' },
  ],
  facts: { dates: '', dimensions: '', materials: '', cost: '', location: '', credits: '', photographer: '' },
  assets: { images: '', press_contact: '' },
  questions: [],
};

const FACT_FIELDS = [
  ['dates', 'Dates', 'start, completion, opening'],
  ['dimensions', 'Dimensions', 'area, height, span, count'],
  ['materials', 'Materials', 'named, and why those'],
  ['cost', 'Cost', 'if disclosable'],
  ['location', 'Exact location', 'street, town, postcode'],
  ['credits', 'Full credits', 'architect, contractor, structural, lighting'],
  ['photographer', 'Photographer', 'name + required credit line'],
];

function merge(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return base;
  return {
    ...base, ...incoming,
    moves: { ...base.moves, ...(incoming.moves || {}) },
    facts: { ...base.facts, ...(incoming.facts || {}) },
    assets: { ...base.assets, ...(incoming.assets || {}) },
    quotes: Array.isArray(incoming.quotes) && incoming.quotes.length
      ? base.quotes.map((q, i) => ({ ...q, ...(incoming.quotes[i] || {}) }))
      : base.quotes,
    questions: Array.isArray(incoming.questions) ? incoming.questions : [],
  };
}

function Section({ title, hint, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: LINE, paddingTop: 'var(--s3)', marginTop: 'var(--s3)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{open ? '▾' : '▸'} {title}</span>
        {hint ? <div style={{ ...CAP, marginTop: 'var(--s1)' }}>{hint}</div> : null}
      </button>
      {open ? <div style={{ marginTop: 'var(--s3)' }}>{children}</div> : null}
    </div>
  );
}

function Field({ label, hint, value, onChange, rows, placeholder, ro }) {
  const Tag = rows ? 'textarea' : 'input';
  return (
    <label className="field" style={{ marginBottom: 'var(--s3)' }}>
      <span className="field-label">{label}{hint ? <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}> — {hint}</span> : null}</span>
      <Tag className="input" rows={rows} value={value || ''} placeholder={placeholder}
        disabled={ro} onChange={(e) => onChange(e.target.value)}
        style={rows ? { width: '100%', boxSizing: 'border-box' } : undefined} />
    </label>
  );
}

/**
 * Wrap every sentence that carries no checkable fact.
 *
 * Located by text match rather than character offset: a sentence is long and
 * distinctive enough to find, and a miss degrades to "not highlighted" instead
 * of to a wrongly placed highlight.
 */
function markPass(doc, root, needles, cls) {
  if (!needles.length) return;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    if (node.parentNode && node.parentNode.nodeName === 'MARK'
        && node.parentNode.getAttribute('class') === cls) continue;
    const text = node.nodeValue;
    const hits = [];
    for (const needle of needles) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(needle, from);
        if (i < 0) break;
        // Whole words only, so "realm" does not fire inside "realms of".
        const before = i === 0 ? '' : text[i - 1];
        const after = text[i + needle.length] || '';
        if (!/[\w'’]/.test(before) && !/[\w'’]/.test(after)) hits.push([i, i + needle.length]);
        from = i + needle.length;
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const frag = doc.createDocumentFragment();
    let cur = 0;
    for (const [from, to] of hits) {
      if (from < cur) continue;
      if (from > cur) frag.appendChild(doc.createTextNode(text.slice(cur, from)));
      const mark = doc.createElement('mark');
      mark.setAttribute('class', cls);
      mark.textContent = text.slice(from, to);
      frag.appendChild(mark);
      cur = to;
    }
    if (cur < text.length) frag.appendChild(doc.createTextNode(text.slice(cur)));
    node.parentNode.replaceChild(frag, node);
  }
}

/**
 * Mark the factless sentences, then the AI tells inside them.
 *
 * Two passes, in that order, because almost every tell sits inside a sentence
 * that carries no fact: one pass with an outermost-wins rule swallowed every
 * underline. The sentence pass runs first and the tell pass then walks the
 * text again, including the text now inside those marks, so the two nest.
 *
 * Located by text match rather than character offset, so a miss degrades to
 * "not marked" instead of to a mark in the wrong place.
 *
 * Only these two are marked. The structural markers — sentence rhythm,
 * parallelism — are never highlighted, because the only way to act on a
 * highlight there is to rough the prose up on purpose, which is the category
 * detectors are trained to catch. A tell is a phrase: deleting it is editing.
 */
function highlightBare(html, spans, tells = []) {
  if (!html || typeof DOMParser === 'undefined') return html;
  const bare = [...new Set(spans.filter((sp) => sp.bare).map((sp) => sp.text))].filter((t) => t.length > 12);
  const tellText = [...new Set(tells.map((t) => t.text).filter((t) => t && t.length > 2))]
    .sort((a, b) => b.length - a.length);
  if (!bare.length && !tellText.length) return html;
  try {
    const doc = new DOMParser().parseFromString(`<div id="oc-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('oc-root');
    markPass(doc, root, bare, 'oc-bare');
    markPass(doc, root, tellText, 'oc-tell');
    return root.innerHTML;
  } catch { return html; }
}

/**
 * The dial. One ratio on a same-ramp track, and the state is carried by the
 * word as well as the hue — colour alone never says anything here.
 */
function Dial({ score }) {
  const R = 58, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, score));
  const band = v >= 75 ? { hue: 'var(--success, #1a9d5a)', word: 'Reads as human' }
    : v >= 45 ? { hue: 'var(--warn, #b8860b)', word: 'Mixed signals' }
      : { hue: 'var(--danger, #c0392b)', word: 'Reads as generated' };
  return (
    <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="148" height="148" viewBox="0 0 148 148" role="img"
        aria-label={`${v} out of 100. ${band.word}.`}>
        <circle cx="74" cy="74" r={R} fill="none" stroke="var(--card-border)" strokeWidth="13" />
        <circle cx="74" cy="74" r={R} fill="none" stroke={band.hue} strokeWidth="13"
          strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`}
          transform="rotate(-90 74 74)" style={{ transition: 'stroke-dasharray 260ms ease, stroke 260ms ease' }} />
        <text x="74" y="70" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 36, fontWeight: 700, fill: 'var(--text)' }}>{v}</text>
        <text x="74" y="96" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 11, fill: 'var(--text-subtle)' }}>out of 100</text>
      </svg>
      <div style={{ minWidth: 220, flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1.2 }}>{band.word}</div>
        <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
          Live, as you type. It rises when you remove a tell or add a checkable fact.
        </div>
      </div>
    </div>
  );
}

export default function PressReleaseEditor({
  pr, setPr, clientId, readOnly, saving, onSave, onCancel, onCreateCampaign,
}) {
  const toast = useToast();
  const [tab, setTab] = useState('document');     // document | source
  const [building, setBuilding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [claims, setClaims] = useState(null);
  const [budget, setBudget] = useState(null);
  const [showStyle, setShowStyle] = useState(false);
  const [highlight, setHighlight] = useState(true);

  const brief = useMemo(() => merge(EMPTY_BRIEF, pr.brief_json), [pr.brief_json]);
  const setBrief = (next) => setPr((p) => ({ ...p, brief_json: next }));
  const setMove = (k, v) => setBrief({ ...brief, moves: { ...brief.moves, [k]: v } });
  const setFact = (k, v) => setBrief({ ...brief, facts: { ...brief.facts, [k]: v } });
  const setAsset = (k, v) => setBrief({ ...brief, assets: { ...brief.assets, [k]: v } });
  const setQuote = (i, k, v) => setBrief({
    ...brief, quotes: brief.quotes.map((q, j) => (j === i ? { ...q, [k]: v } : q)),
  });

  // The live reading. Deterministic and local: no request, no cost, no delay.
  const reading = useMemo(() => analyse(pr.body_html || '', brief), [pr.body_html, brief]);

  // Where the density stood when this release was opened, so the panel can show
  // movement rather than an absolute number with no reference point.
  const baseline = useRef(null);
  useEffect(() => { baseline.current = null; }, [pr.id]);
  useEffect(() => { if (baseline.current == null && reading) baseline.current = reading.density; }, [reading]);
  const moved = baseline.current != null && reading && reading.density !== baseline.current;

  useEffect(() => {
    api.get('/pr/press-release-budget').then(setBudget).catch(() => {});
  }, []);

  async function buildBrief() {
    if (!pr.id) { toast('Save the release first.', 'info'); return; }
    setBuilding(true);
    try {
      const r = await api.post(`/pr/press-releases/${pr.id}/brief`, {});
      if (r.error) { toast(r.error, 'error'); return; }
      setBrief(merge(EMPTY_BRIEF, r));
      toast('Fact sheet built. Every empty slot is a question for the client.', 'success');
      api.get('/pr/press-release-budget').then(setBudget).catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
    finally { setBuilding(false); }
  }

  async function checkClaims() {
    if (!pr.id) return;
    setChecking(true);
    try {
      const r = await api.post(`/pr/press-releases/${pr.id}/check-claims`, {});
      if (r.error) { toast(r.error, 'error'); return; }
      setClaims(r);
      api.get('/pr/press-release-budget').then(setBudget).catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
    finally { setChecking(false); }
  }

  const verdictCopy = {
    ready: 'Enough reporting to issue',
    marginal: 'Go back for more facts',
    not_ready: 'The reporting has not been done',
  };

  return (
    <div>
      <style>{`
        mark.oc-bare {
          background: color-mix(in srgb, var(--accent) 20%, transparent);
          color: inherit; border-radius: 2px; padding: 0 1px;
          box-decoration-break: clone; -webkit-box-decoration-break: clone;
        }
        mark.oc-tell {
          background: transparent; color: inherit;
          border-bottom: 2px solid var(--danger, #c0392b);
          border-radius: 0; padding: 0;
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s3)', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <h3 className="h3" style={{ margin: 0 }}>{pr.title || 'New press release'}</h3>
        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
          <a className="btn btn-secondary btn-sm" href="/api/pr/editorial-standard.pdf" target="_blank" rel="noreferrer">
            ↓ The writing standard
          </a>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>All releases</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
        <Field label="Headline / working title" value={pr.title} ro={readOnly}
          onChange={(v) => setPr((p) => ({ ...p, title: v }))} placeholder="e.g. Forgeworks unveils House of Wood Shingle" />
        <Field label="Brand" value={pr.brand} ro={readOnly} onChange={(v) => setPr((p) => ({ ...p, brand: v }))} />
      </div>
      <Field label="Angle" hint="why a journalist would care" rows={2} value={pr.angle} ro={readOnly}
        onChange={(v) => setPr((p) => ({ ...p, angle: v }))} />
      <Field label="What you already know" hint="raw notes, in any shape" rows={4} value={pr.key_facts} ro={readOnly}
        onChange={(v) => setPr((p) => ({ ...p, key_facts: v }))} />

      {/* ── The fact sheet ─────────────────────────────────────────────── */}
      <Section title="Fact sheet" hint="Slots, never sentences. An empty slot is a question for the client, not a gap to write around.">
        <div className="row" style={{ gap: 'var(--s3)', marginBottom: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: buildBrief, disabled: building })}>
            {building ? 'Building…' : '✎ Build the fact sheet'}
          </button>
          <span style={CAP}>
            One Claude call. It fills only what your notes already contain and writes the questions for the rest.
            {budget?.configured && budget.cap_usd != null
              ? ` ${budget.enabled ? `$${budget.remaining_usd?.toFixed(2)} of $${budget.cap_usd.toFixed(2)} left this month.` : 'Paused in Settings → AI models.'}`
              : ''}
          </span>
        </div>

        <Field label="News hook" hint="what changed, and when" value={brief.news_hook} ro={readOnly}
          onChange={(v) => setBrief({ ...brief, news_hook: v })} />

        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s3) 0 var(--s2)' }}>The six moves</div>
        {MOVES.map((m) => (
          <Field key={m.key} label={m.label} hint={m.hint} value={brief.moves[m.key]} ro={readOnly}
            onChange={(v) => setMove(m.key, v)} />
        ))}

        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s4) 0 var(--s2)' }}>
          Quotes <span style={{ fontWeight: 400, ...CAP }}>verbatim, named, with titles. Never tidy a real quote into fluency.</span>
        </div>
        {brief.quotes.map((q, i) => (
          <div key={i} style={{ border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s3)', marginBottom: 'var(--s2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s2)' }}>
              <Field label="Name" value={q.name} ro={readOnly} onChange={(v) => setQuote(i, 'name', v)} />
              <Field label="Job title" value={q.title} ro={readOnly} onChange={(v) => setQuote(i, 'title', v)} />
              <Field label="Organisation" value={q.organisation} ro={readOnly} onChange={(v) => setQuote(i, 'organisation', v)} />
            </div>
            <Field label="What they said" hint="their words, including the awkward ones" rows={2} value={q.quote}
              ro={readOnly} onChange={(v) => setQuote(i, 'quote', v)} />
          </div>
        ))}

        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s4) 0 var(--s2)' }}>The facts</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)' }}>
          {FACT_FIELDS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint} value={brief.facts[k]} ro={readOnly} onChange={(v) => setFact(k, v)} />
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s4) 0 var(--s2)' }}>Assets</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)' }}>
          <Field label="Images" hint="count, resolution, captions" value={brief.assets.images} ro={readOnly}
            onChange={(v) => setAsset('images', v)} />
          <Field label="Press contact" hint="a named human with a direct line" value={brief.assets.press_contact}
            ro={readOnly} onChange={(v) => setAsset('press_contact', v)} />
        </div>

        {brief.questions?.length > 0 && (
          <div style={{ marginTop: 'var(--s4)', padding: 'var(--s3)', border: LINE, borderRadius: 'var(--r-sm)' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>Ask the client</div>
            <div style={{ ...CAP, margin: 'var(--s1) 0 var(--s2)' }}>
              Record the call. It is where the quotes come from, and usually the hook phrase.
            </div>
            <ol style={{ margin: 0, paddingLeft: '1.2em', fontSize: 'var(--fs-body)', lineHeight: 1.7 }}>
              {brief.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </div>
        )}
      </Section>

      {/* ── The release ────────────────────────────────────────────────── */}
      <Section title="The release" hint="You write the sentences. Dictating into a voice note and tidying the transcript is faster than typing and produces uneven sentence length for free.">
        <div className="row" style={{ gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'document' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('document')}>Document</button>
          <button className={`btn btn-sm ${tab === 'source' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('source')}>HTML source</button>
          {tab === 'document' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s1)', cursor: 'pointer', ...CAP }}>
              <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
              Mark the sentences carrying no fact
            </label>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            try { await navigator.clipboard.writeText(pr.body_html || ''); toast('HTML copied.', 'success'); }
            catch { toast('Copy failed — select it in the source view.', 'error'); }
          }}>Copy HTML</button>
        </div>

        {tab === 'document' ? (
          <div
            style={{
              border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s5)', background: 'var(--surface)',
              maxWidth: '46em', lineHeight: 1.65, fontSize: 'var(--fs-body)',
            }}
            // The operator's own release, rendered for reading, with the
            // factless sentences marked. Same content the source view edits.
            dangerouslySetInnerHTML={{ __html: pr.body_html
              ? (highlight ? highlightBare(pr.body_html, reading.spans, reading.tells) : pr.body_html)
              : '<p style="color:var(--text-subtle)">Nothing written yet. Fill the fact sheet, then write it here.</p>' }}
          />
        ) : (
          <textarea className="input" rows={20} disabled={readOnly}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace', fontSize: 'var(--fs-caption)' }}
            value={pr.body_html || ''} onChange={(e) => setPr((p) => ({ ...p, body_html: e.target.value }))} />
        )}
        {tab === 'document' && !readOnly && (
          <div style={{ ...CAP, marginTop: 'var(--s2)' }}>Switch to HTML source to edit.</div>
        )}
      </Section>

      {/* ── The check ──────────────────────────────────────────────────── */}
      <Section title="The check" hint="Live, free, and local. It counts facts, not style.">
        <div style={{ padding: 'var(--s4)', border: LINE, borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)', marginBottom: 'var(--s3)' }}>
          <Dial score={reading.human_score} />

          {reading.human_parts.length > 0 && (
            <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
              <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>What is costing points</div>
              {reading.human_parts.map((part) => (
                <div key={part.label} className="row" style={{ gap: 'var(--s2)', padding: '3px 0', alignItems: 'baseline' }}>
                  <span style={{ width: 44, fontWeight: 700, fontSize: 'var(--fs-body)' }}>−{part.cost}</span>
                  <span style={{ fontSize: 'var(--fs-body)' }}>{part.label}</span>
                  <span style={CAP}>{part.detail}</span>
                </div>
              ))}
            </div>
          )}

          {reading.tells.length > 0 && (
            <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
              <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>
                Underlined in the document above. Deleting these is ordinary editing — they are
                phrases, not rhythm, so cutting them costs nothing.
              </div>
              {Object.values(reading.tells.reduce((acc, t) => {
                const k = `${t.kind}:${t.label}`;
                acc[k] = acc[k] || { ...t, n: 0 };
                acc[k].n += 1;
                return acc;
              }, {})).sort((a, b) => b.weight * b.n - a.weight * a.n).slice(0, 14).map((t) => (
                <div key={`${t.kind}:${t.label}`} className="row" style={{ gap: 'var(--s2)', padding: '3px 0', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{t.label}</span>
                  {t.n > 1 && <span style={CAP}>×{t.n}</span>}
                  <span style={CAP}>{t.note}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)', borderTop: LINE }}>
            <strong>What this is.</strong> A heuristic, not a detector, and worth knowing the difference.
            Pangram maps text into a style space learned from paired human and AI writing, and weighs
            “hundreds of thousands” of signals, of which the visible tells are only one. This checks the
            visible tells: the phrasing Anthropic names as a favourite of its own models, the excess
            vocabulary documented across 15 million papers by Kobak et al. in Science Advances, and
            October&rsquo;s own eight markers. One thin slice of what a trained classifier does.
            {' '}Claude now watermarks its text, but reading that needs Anthropic&rsquo;s key and the
            detection API is limited to regulators, media and fact-checkers.
            {' '}Two things follow. A high score means “none of the usual tells are present”, which is
            weaker than “a human wrote this”. And a word list is, in Pangram&rsquo;s own words about the
            detectors it replaced, bypassed by swapping words for rarer synonyms — so swapping
            “delve” for something unusual lifts this score and improves nothing. The part that cannot be
            gamed that way is the specificity, which is why it carries the most weight.
            {' '}Use it to make a good start. Put the finished text through Pangram when the answer matters.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap', alignItems: 'baseline', padding: 'var(--s3)', border: LINE, borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>{reading.checkable}</div>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>checkable facts</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>
              {reading.density}
              {moved && <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--text-muted)' }}> from {baseline.current}</span>}
            </div>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>per 100 words · target {reading.thresholds.target}</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>{reading.named_quotes}</div>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>named quotes</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>{reading.moves_filled}/6</div>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>moves filled</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span className="chip" style={{
              background: reading.verdict === 'ready' ? 'var(--accent-soft)' : undefined,
              fontWeight: 700,
            }}>{verdictCopy[reading.verdict]}</span>
          </div>
        </div>

        {reading.gaps.length > 0 ? (
          <div style={{ marginTop: 'var(--s3)' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              What is missing
            </div>
            {reading.gaps.map((g) => (
              <div key={g.key} className="row" style={{ gap: 'var(--s2)', padding: 'var(--s2) 0', borderTop: LINE, alignItems: 'flex-start' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18,
                  borderRadius: 'var(--r-md)', flexShrink: 0, marginTop: 2, fontSize: 11, fontWeight: 700, color: '#fff',
                  background: g.severity === 'high' ? 'var(--danger, #c0392b)' : 'var(--text-subtle)',
                }}>{g.severity === 'high' ? '!' : '·'}</span>
                <div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{g.label}</div>
                  <div style={CAP}>{g.detail}</div>
                </div>
              </div>
            ))}
            <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
              Every one of these is fixed by reporting, not by rewriting. Rewording a sentence will not move this
              number, and it will not move a detector either.
            </div>
          </div>
        ) : (
          <div style={{ ...CAP, marginTop: 'var(--s3)' }}>Nothing missing. The reporting is done.</div>
        )}

        <div className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: checkClaims, disabled: checking || !pr.id })}>
            {checking ? 'Checking…' : '✓ Check the claims'}
          </button>
          <span style={CAP}>One Claude call. Finds claims with no named source, number or date behind them.</span>
        </div>

        {claims && (
          <div style={{ marginTop: 'var(--s3)', padding: 'var(--s3)', border: LINE, borderRadius: 'var(--r-sm)' }}>
            {claims.unsupported?.length ? (
              <>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                  Claims with nothing behind them
                </div>
                {claims.unsupported.map((u, i) => (
                  <div key={i} style={{ padding: 'var(--s2) 0', borderTop: i ? LINE : 'none' }}>
                    <div style={{ fontSize: 'var(--fs-body)' }}>“{u.claim}”</div>
                    <div style={CAP}>{u.why}</div>
                  </div>
                ))}
              </>
            ) : <div style={CAP}>Every claim carries a source, a number or a date.</div>}
          </div>
        )}

        {/* Diagnostic only. No highlights, no fix buttons, and it does not feed
            the number above — see the file header. */}
        <div style={{ marginTop: 'var(--s4)', borderTop: LINE, paddingTop: 'var(--s3)' }}>
          <button type="button" onClick={() => setShowStyle((v) => !v)}
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', ...CAP, textDecoration: 'underline' }}>
            {showStyle ? 'Hide' : 'Show'} where the prose came from
          </button>
          {showStyle && (
            <div style={{ marginTop: 'var(--s2)' }}>
              <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>
                Read this, do not act on it. These are the structural tells of generated prose. Breaking them on
                purpose produces deliberately roughened copy, which is a category detectors are trained to catch,
                so the fix is never to edit around them. They tell you whether this text started with a person.
              </div>
              {Object.entries(reading.style).map(([k, v]) => (
                <div key={k} className="row" style={{ gap: 'var(--s2)', padding: 'var(--s1) 0', fontSize: 'var(--fs-caption)' }}>
                  <span style={{ width: 170, color: 'var(--text-subtle)' }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ fontWeight: v.flagged ? 700 : 400 }}>
                    {v.value != null ? v.value : v.per_100 != null ? `${v.per_100} per 100` : v.count != null ? v.count : (v.flagged ? 'yes' : 'no')}
                    {v.flagged ? ' · present' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        {/* The pitch gate used to be "a client approved it". It is now "the
            reporting is done", which is the thing that decides whether a
            journalist runs it. */}
        <button className="btn btn-primary"
          {...roWrite(readOnly, {
            onClick: onCreateCampaign,
            disabled: reading.verdict === 'not_ready',
            title: reading.verdict === 'not_ready'
              ? 'The reporting has not been done yet — see what is missing above.'
              : 'Pitch this release to journalists',
          })}>
          {pr.campaign_id ? 'Open pitch campaign →' : '📣 Create pitch campaign →'}
        </button>
      </div>
    </div>
  );
}
