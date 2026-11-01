import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { analyse, MOVES, stripHtml, flatten, locateSegment } from '@shared/humanity.mjs';
import { highlightLayers, unmark } from '../utils/releaseHighlight';
import SideDrawer from './ui/SideDrawer';

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
 * 2. The dial reads the visible tells and the specificity. It is a heuristic
 *    and the panel says so at length. Two of its three layers move when you
 *    edit: cutting a tell phrase is ordinary editing, and so is cutting a
 *    sentence that says nothing. The third, specificity, only moves when you
 *    go and get a fact, which is why it carries the most weight.
 *
 * 3. STRUCTURAL markers — sentence rhythm, parallelism — are reported without
 *    highlights and do not feed the number. They say where the prose came from.
 *    Underlining a coordinate list would be an instruction to go and break it,
 *    and deliberately roughened prose is a category detectors are trained on.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

/**
 * The three things worth marking, and the only three.
 *
 * Each one earns its place by having a different fix. A layer you cannot act
 * on is decoration, and a document where everything is highlighted says the
 * same as a document where nothing is.
 *
 *   phrasing — a phrase. Cut it. Ordinary editing, costs nothing.
 *   thin     — a whole sentence carrying no checkable fact. Give it a fact or
 *              cut it. You cannot clear this one by rewording.
 *   fact     — what is already earning the score. Nothing to do. Off by
 *              default, because the useful default is "show me the problems".
 *
 * The treatments differ by more than hue: a solid underline, a dotted one, a
 * tint. Colour alone never carries the meaning.
 */
const DOC_STYLE = {
  border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s5)', background: 'var(--surface)',
  lineHeight: 1.65, fontSize: 'var(--fs-body)', minHeight: '18em',
};

const LAYERS = [
  // In paint order, which is not negotiable: longest needles first. Once a
  // short needle has split a text node, the longer passage around it no longer
  // matches as one string, so a layer painted late paints nothing at all.
  //
  // The detector's segments run to whole paragraphs and so go down first. It is
  // also the only layer here that is not ours: it is Pangram's own segment list
  // from the last paid check, painted back onto the passages it came from. It
  // does NOT move as you type, and the panel says so where you can see it.
  { key: 'machine', cls: 'oc-machine', label: 'Pangram: reads as machine-written',
    swatch: 'var(--negative)', fix: 'the detector’s own call · only moves on a recheck', on: true },
  // Then the sentence layer, before the phrase layers inside it, for the same
  // reason.
  { key: 'thin', cls: 'oc-bare', label: 'No checkable fact', swatch: 'var(--warning)',
    fix: 'give it a fact, or cut it', on: true },
  { key: 'phrasing', cls: 'oc-tell', label: 'AI phrasing', swatch: 'var(--negative)',
    fix: 'cut the phrase', on: true },
  // The count is of DISTINCT facts, which is what the score uses, while the
  // page marks every occurrence — so the label says so rather than leaving a
  // reader to wonder why 21 facts produced 29 highlights.
  { key: 'fact', cls: 'oc-fact', label: 'Checkable facts', swatch: 'var(--positive)',
    fix: 'what is earning the score · marked wherever they repeat', on: false },
];

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

/** Where the caret sits, counted in characters from the start of the element. */
function caretOffset(root) {
  const sel = typeof window !== 'undefined' && window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Put it back there after the marks have been repainted underneath it. */
function restoreCaret(root, offset) {
  if (offset == null) return;
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let seen = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (seen + len >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - seen));
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    seen += len;
  }
}

/**
 * The document, written in directly.
 *
 * The hard part is that the marks live in the same DOM you are typing into, so
 * repainting them on every keystroke destroys the caret. The split that makes
 * it work: the DIAL updates on every keystroke, because it reads the text and
 * touches nothing; the MARKS are repainted only once you stop, after which the
 * caret is put back by character offset.
 *
 * React never owns this subtree. It is set imperatively, or every repaint would
 * fight the browser for the cursor.
 */
function DocumentSurface({ html, onChange, readOnly, paintKey }) {
  const ref = useRef(null);
  const typing = useRef(false);
  const timer = useRef(null);
  // The freshly painted markup, readable from inside the settle timeout, which
  // closes over the render that scheduled it and would otherwise repaint stale
  // marks over newer text.
  const painted = useRef(html);
  useEffect(() => { painted.current = html; }, [html]);

  // Repaint when the marks change underneath us — a new release, a layer
  // toggled — but never while the operator is mid-word.
  useEffect(() => {
    const el = ref.current;
    if (!el || typing.current) return;
    if (el.innerHTML === html) return;
    const at = document.activeElement === el ? caretOffset(el) : null;
    el.innerHTML = html;
    if (at != null) restoreCaret(el, at);
  }, [html, paintKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  if (readOnly) {
    return (
      <div ref={ref} data-oc-doc style={DOC_STYLE} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }

  return (
    <div
      ref={ref}
      data-oc-doc
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label="The release"
      style={{ ...DOC_STYLE, outline: 'none' }}
      onInput={() => {
        typing.current = true;
        clearTimeout(timer.current);
        const el = ref.current;
        // Store the operator's own HTML, never ours.
        onChange(unmark(el.innerHTML));
        // Settle: repaint the marks once the typing stops, and put the caret
        // back where it was.
        timer.current = setTimeout(() => {
          typing.current = false;
          const at = document.activeElement === el ? caretOffset(el) : null;
          el.innerHTML = painted.current || el.innerHTML;
          if (at != null) restoreCaret(el, at);
        }, 700);
      }}
      onBlur={() => {
        clearTimeout(timer.current);
        typing.current = false;
      }}
      // Paste as plain text. A paste out of Word carries a tag soup that the
      // HTML view then has to be opened to clean up.
      onPaste={(e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}

/**
 * Pangram's reading, in the detail its own dashboard gives.
 *
 * A percentage on its own is a verdict you cannot act on. The useful part of
 * their response is the segmentation: which passages it believes a person wrote,
 * which it believes a model wrote, and how sure it is about each. That is what
 * tells a writer where to go back in.
 *
 * Read in the opposite direction to October's dial. Here LOW is good, because
 * the number is the share of the text that reads as machine-written. The two
 * are deliberately not styled alike: they measure different things, and a
 * release has already scored 92 here and 86.56% AI there.
 */
const SEG_STYLE = {
  'Human Written': { hue: 'var(--positive)', soft: 'var(--positive-soft)', short: 'Human' },
  'AI-Assisted': { hue: 'var(--warning)', soft: 'var(--warning-soft)', short: 'Assisted' },
  'AI-Generated': { hue: 'var(--negative)', soft: 'var(--negative-soft)', short: 'AI' },
};
const segStyle = (label) => SEG_STYLE[label]
  || { hue: 'var(--text-subtle)', soft: 'var(--surface-raised)', short: label || '—' };

function PangramDial({ pct }) {
  const R = 46, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, pct));
  // Inverted against October's: the number is how much reads as machine-written.
  const band = v >= 60 ? { hue: 'var(--negative)', word: 'Reads as machine-written' }
    : v >= 25 ? { hue: 'var(--warning)', word: 'Mixed authorship' }
      : { hue: 'var(--positive)', word: 'Reads as human' };
  return (
    <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
      <svg width="112" height="112" viewBox="0 0 112 112" role="img"
        aria-label={`Pangram: ${v}% of this text reads as machine-written. ${band.word}.`}>
        <circle cx="56" cy="56" r={R} fill="none" stroke="var(--card-border)" strokeWidth="11" />
        <circle cx="56" cy="56" r={R} fill="none" stroke={band.hue} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`}
          transform="rotate(-90 56 56)" style={{ transition: 'stroke-dasharray 260ms ease' }} />
        <text x="56" y="53" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 23, fontWeight: 700, fill: 'var(--text)' }}>{Math.round(v)}%</text>
        <text x="56" y="73" textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 9, fill: 'var(--text-subtle)' }}>machine</text>
      </svg>
      {/* The state is in the words as well as the hue, so the chart is readable
          without colour vision. */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, lineHeight: 1.2 }}>{band.word}</div>
      </div>
    </div>
  );
}

/** The authorship split, word-weighted, labelled rather than colour-coded. */
function AuthorshipBar({ ai, assisted, human }) {
  const parts = [
    ['AI-Generated', ai], ['AI-Assisted', assisted], ['Human Written', human],
  ].filter(([, v]) => Number(v) > 0);
  if (!parts.length) return null;
  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      {/* 2px gaps between fills, so adjacent segments stay separable. */}
      <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
        {parts.map(([label, v]) => (
          <div key={label} style={{ width: `${v}%`, background: segStyle(label).hue }} title={`${label}: ${v}%`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
        {parts.map(([label, v]) => (
          <span key={label} style={{ ...CAP, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: segStyle(label).hue, display: 'inline-block' }} />
            {segStyle(label).short} {v}%
          </span>
        ))}
      </div>
    </div>
  );
}

function PangramPanel({ raw, segments, rewritten, onGoTo }) {
  const windows = Array.isArray(raw?.windows) ? raw.windows : [];
  const total = windows.reduce((n, w) => n + (w.word_count || 0), 0) || 1;
  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <PangramDial pct={Number(raw.pct ?? raw.fraction_ai * 100) || 0} />

      {raw.headline && (
        <div style={{ marginTop: 'var(--s2)' }}>
          <span className="chip" style={{
            background: segStyle(raw.headline === 'Human Written' ? 'Human Written' : 'AI-Generated').soft,
            fontWeight: 700,
          }}>{raw.headline}</span>
          {raw.version ? <span style={{ ...CAP, marginLeft: 'var(--s2)' }}>Pangram {raw.version}</span> : null}
        </div>
      )}

      {raw.prediction && (
        <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>{raw.prediction}</div>
      )}

      <AuthorshipBar
        ai={raw.pct ?? null} assisted={raw.pct_assisted ?? null} human={raw.pct_human ?? null} />

      {windows.length > 0 && (
        <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
          <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>
            {windows.length} segment{windows.length === 1 ? '' : 's'}, in order. Each one is marked in
            the release; click it to go there.
          </div>
          {rewritten > 0 && (
            <div style={{
              ...CAP, marginBottom: 'var(--s2)', padding: 'var(--s2)', borderRadius: 'var(--r-sm)',
              background: 'var(--warning-soft)', lineHeight: 1.5,
            }}>
              <strong>{rewritten}</strong> flagged passage{rewritten === 1 ? ' has' : 's have'} been
              rewritten since this check, so the figure above no longer covers
              {rewritten === 1 ? ' it' : ' them'}. Only a fresh check moves the number.
            </div>
          )}
          {windows.map((w, i) => {
            const st = segStyle(w.label);
            const share = Math.round(((w.word_count || 0) / total) * 100);
            const here = segments?.[i]?.found;
            return (
              <div key={i} role={here ? 'button' : undefined} tabIndex={here ? 0 : undefined}
                onClick={here ? () => onGoTo(i) : undefined}
                onKeyDown={here ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGoTo(i); } } : undefined}
                style={{
                  borderLeft: `3px solid ${here ? st.hue : 'var(--card-border)'}`,
                  paddingLeft: 'var(--s2)', marginBottom: 'var(--s2)',
                  cursor: here ? 'pointer' : 'default',
                  opacity: here ? 1 : 0.6,
                }}>
                <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: st.hue }}>{w.label}</span>
                  <span style={CAP}>{w.confidence} confidence</span>
                  <span style={CAP}>{w.word_count} words · {share}%</span>
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', lineHeight: 1.45, marginTop: 2, fontStyle: 'italic' }}>
                  &ldquo;{String(w.text || '').trim().slice(0, 110)}
                  {String(w.text || '').trim().length > 110 ? '…' : ''}&rdquo;
                </div>
                {/* Their humanizer head: whether the passage looks like AI text
                    that has been run through a tool to disguise it. Worth
                    surfacing, because that is a different problem from AI prose
                    and a worse one to be caught doing. */}
                {w.is_humanized && (
                  <div style={{ ...CAP, color: 'var(--negative)', fontWeight: 700 }}>
                    flagged as humanised
                  </div>
                )}
                {/* Located from the text, not from the response: this passage
                    is no longer in the release the way it was checked. */}
                {segments && !here && (
                  <div style={{ ...CAP, fontWeight: 700 }}>rewritten since this check</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {raw.dashboard_link && (
        <div style={{ marginTop: 'var(--s2)' }}>
          <a className="btn btn-secondary btn-sm" href={raw.dashboard_link} target="_blank" rel="noreferrer">
            Open on pangram.com →
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * The legend, and the layer switches, in one control.
 *
 * Every row carries its live count, because a layer with nothing to mark and a
 * layer switched off look identical on the page, and a count of zero is the
 * most useful thing the panel ever says.
 */
function Legend({ layerOn, setLayerOn, marks, reading, flagged }) {
  const counts = {
    thin: reading.spans.filter((sp) => sp.bare && sp.words >= 6).length,
    phrasing: reading.tells.length,
    fact: reading.checkable,
    // Passages the detector flagged that are still in the text. One it can no
    // longer find has been rewritten, so there is nothing left to mark.
    machine: flagged.filter((g) => g.found).length,
  };
  const sample = {
    thin: { borderBottom: '1px dotted var(--warning)', background: 'var(--warning-soft)' },
    phrasing: { borderBottom: '2px solid var(--negative)', background: 'var(--negative-soft)' },
    fact: { background: 'var(--positive-soft)', borderRadius: 2 },
    machine: { textDecoration: 'underline wavy var(--negative)', textUnderlineOffset: 3 },
  };
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', alignItems: 'flex-start',
      padding: 'var(--s2) var(--s3)', marginBottom: 'var(--s2)',
      border: LINE, borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)',
    }}>
      {LAYERS.map((l) => (
        <label key={l.key} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!layerOn[l.key]} style={{ marginTop: 3 }}
            onChange={(e) => setLayerOn((m) => ({ ...m, [l.key]: e.target.checked }))} />
          <span>
            <span style={{ fontSize: 'var(--fs-body)' }}>
              {/* The swatch is the mark itself, at the same weight it appears in
                  the text, so the legend cannot drift from the page. */}
              <span style={{ ...sample[l.key], padding: '0 4px', marginRight: 6 }}>Aa</span>
              {l.label}
              <strong style={{ marginLeft: 6 }}>{counts[l.key]}</strong>
            </span>
            <span style={{ ...CAP, display: 'block' }}>{l.fix}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * The dial. One ratio on a same-ramp track, and the state is carried by the
 * word as well as the hue — colour alone never says anything here.
 */
function Dial({ score }) {
  const R = 58, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, score));
  // The words name what was measured, not what a reader would conclude.
  //
  // "Reads as human" was an overclaim and a real release proved it: this scored
  // it 94 while Pangram scored the same text 82% AI. The two are not measuring
  // the same thing, and a dial that says "human" where a trained classifier
  // says "machine" gives false confidence at the exact moment it matters.
  const band = v >= 75 ? { hue: 'var(--positive)', word: 'Well reported, no tells' }
    : v >= 45 ? { hue: 'var(--warning)', word: 'Thin in places' }
      : { hue: 'var(--negative)', word: 'Reads as generated' };
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexDirection: 'column', textAlign: 'center' }}>
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
      <div>
        <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1.2 }}>{band.word}</div>
        <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
          Live, as you type. It rises when you remove a tell or add a checkable fact.
          {v >= 75 ? ' A clean score here is not a detector verdict — see below.' : ''}
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
  const [detector, setDetector] = useState(null);   // { configured, words, cost_usd }
  const [detecting, setDetecting] = useState(false);
  const [unparsed, setUnparsed] = useState(null);  // their response, when we could not read the number out of it
  const [detail, setDetail] = useState(null);     // their response in full, whether or not we read it
  const [showRaw, setShowRaw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [standardOpen, setStandardOpen] = useState(false);
  const [layerOn, setLayerOn] = useState(
    () => Object.fromEntries(LAYERS.map((l) => [l.key, l.on])),
  );

  const brief = useMemo(() => merge(EMPTY_BRIEF, pr.brief_json), [pr.brief_json]);
  const setBrief = (next) => setPr((p) => ({ ...p, brief_json: next }));
  const setMove = (k, v) => setBrief({ ...brief, moves: { ...brief.moves, [k]: v } });
  const setFact = (k, v) => setBrief({ ...brief, facts: { ...brief.facts, [k]: v } });
  const setAsset = (k, v) => setBrief({ ...brief, assets: { ...brief.assets, [k]: v } });
  const setQuote = (i, k, v) => setBrief({
    ...brief, quotes: brief.quotes.map((q, j) => (j === i ? { ...q, [k]: v } : q)),
  });

  // The live reading. Deterministic and local: no request, no cost, no delay.
  const reading = useMemo(
    () => analyse(pr.body_html || '', brief, { names: [pr.brand] }),
    [pr.body_html, brief, pr.brand],
  );

  /**
   * The detector's segments, placed back in the text they came from.
   *
   * The segment list is the useful half of a Pangram response and it was only
   * ever shown as cards in the rail, which left you reading 32 quotations and
   * hunting for each one in the release. Each segment is located in the
   * document and marked where it sits.
   *
   * `found` is the other half of the answer. A flagged passage that is no
   * longer in the text has been rewritten since the check, so the 74% on the
   * dial no longer describes it. That is computed from the text, costs
   * nothing, and is the only honest thing this panel can say about an edit
   * before the next paid check.
   */
  const plain = useMemo(() => stripHtml(pr.body_html || ''), [pr.body_html]);

  const segments = useMemo(() => {
    const windows = Array.isArray(detail?.raw?.windows) ? detail.raw.windows : [];
    const hay = flatten(plain);
    return windows.map((w) => {
      const lines = locateSegment(hay, plain, w.text);
      return {
        machine: !!w.label && !/human/i.test(w.label),
        found: !!lines,
        lines: lines || [],
      };
    });
  }, [detail, plain]);

  // How many of the passages the detector called machine-written are still in
  // the release as it was checked.
  const flagged = segments.filter((g) => g.machine);
  const rewritten = flagged.filter((g) => !g.found).length;

  // What each layer marks, and how many of them there are. The legend shows the
  // count because a layer with nothing in it has to say so: an empty highlight
  // layer and a switched-off one look identical on the page.
  const marks = useMemo(() => ({
    // Long enough to locate unambiguously. A six-word connective sentence is
    // not the problem and marking it only adds noise.
    thin: [...new Set(reading.spans.filter((sp) => sp.bare && sp.words >= 6).map((sp) => sp.text))]
      .filter((t) => t.length > 12),
    phrasing: [...new Set(reading.tells.map((t) => t.text).filter((t) => t && t.length > 2))]
      .sort((a, b) => b.length - a.length),
    fact: [...new Set(reading.items.map((i) => i.text).filter((t) => t && t.length > 1))]
      .sort((a, b) => b.length - a.length),
    machine: [...new Set(segments.filter((g) => g.machine).flatMap((g) => g.lines))]
      .sort((a, b) => b.length - a.length),
  }), [reading, segments]);

  /**
   * Take me to that passage. The rail lists them in order; the release does not
   * read in the order of a list, and scrolling a long release looking for a
   * quoted fragment is the work this is meant to remove.
   *
   * The layer is switched on first if it was off, so the jump lands on a mark
   * rather than in the middle of unmarked prose, and the paint has to happen
   * before the element exists to scroll to.
   */
  function goToSegment(i) {
    const first = segments[i]?.lines?.[0];
    if (!first) return;
    setLayerOn((m) => (m.machine ? m : { ...m, machine: true }));
    const key = first.slice(0, 40);
    const find = (tries) => {
      const hit = [...document.querySelectorAll('[data-oc-doc] mark.oc-machine')]
        .find((el) => el.textContent.includes(key));
      if (!hit) { if (tries > 0) setTimeout(() => find(tries - 1), 120); return; }
      hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hit.classList.add('oc-flash');
      setTimeout(() => hit.classList.remove('oc-flash'), 1800);
    };
    find(5);
  }

  const html = useMemo(() => highlightLayers(
    pr.body_html || '',
    LAYERS.filter((l) => layerOn[l.key]).map((l) => ({ cls: l.cls, needles: marks[l.key] || [] })),
  ), [pr.body_html, marks, layerOn]);

  // Where the density stood when this release was opened, so the panel can show
  // movement rather than an absolute number with no reference point.
  const baseline = useRef(null);
  useEffect(() => { baseline.current = null; }, [pr.id]);
  useEffect(() => { if (baseline.current == null && reading) baseline.current = reading.density; }, [reading]);
  const moved = baseline.current != null && reading && reading.density !== baseline.current;

  useEffect(() => {
    api.get('/pr/press-release-budget').then(setBudget).catch(() => {});
  }, []);

  // The price is fetched, not guessed in the browser, and it is refreshed as the
  // release grows so the button never quotes a figure for an older draft.
  useEffect(() => {
    if (!pr.id) return;
    const t = setTimeout(() => {
      api.get(`/pr/press-releases/${pr.id}/detect-quote`).then(setDetector).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [pr.id, pr.body_html]);

  // Their response in full, loaded alongside the release so it is there without
  // spending anything. On the one release checked against their own web tool,
  // the figure this panel read (0.15%) and the figure the web tool gave (87%)
  // disagreed completely, which means the field being read is the wrong one.
  // Until that is settled the raw body is the honest thing to show.
  useEffect(() => {
    if (!pr.id) return;
    api.get(`/pr/press-releases/${pr.id}/detector-detail`).then(setDetail).catch(() => {});
  }, [pr.id, pr.pangram_checked_at]);

  /**
   * Put what is on screen into the database before asking the server about it.
   *
   * The detector, the brief and the claim check all read body_html from the
   * row, so an unsaved edit is invisible to them. For the detector that was
   * worse than invisible: the text it read was unchanged, so its fingerprint
   * matched the last check and it answered from cache with "Unchanged since
   * the last check". Edit a paragraph, press Check again, and it told you
   * nothing had changed.
   */
  async function flush() {
    const row = await onSave({ quiet: true });
    if (!row) toast('Could not save, so nothing was sent to check.', 'error');
    return !!row;
  }

  async function runDetector() {
    if (!pr.id) { toast('Save the release first.', 'info'); return; }
    if (!(await flush())) return;
    setDetecting(true);
    try {
      const r = await api.post(`/pr/press-releases/${pr.id}/detect`, {});
      if (r.error) { toast(r.error, 'error'); return; }
      setPr((p) => ({ ...p, pangram_pct: r.pangram_pct, pangram_checked_at: r.pangram_checked_at || new Date().toISOString() }));
      setUnparsed(r.unparsed || null);
      toast(r.unparsed
        ? 'The call worked, but the percentage is not where it was expected. The response is below.'
        : r.cached
          ? 'Unchanged since the last check, so nothing was spent.'
          : `Detector says ${r.pangram_pct}% of this reads as machine-written.`,
      r.unparsed ? 'info' : 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setDetecting(false); }
  }

  async function buildBrief() {
    if (!pr.id) { toast('Save the release first.', 'info'); return; }
    if (!(await flush())) return;
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
    if (!(await flush())) return;
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
        mark.oc-bare, mark.oc-tell, mark.oc-fact {
          color: inherit; background: transparent; padding: 0; border-radius: 0;
          box-decoration-break: clone; -webkit-box-decoration-break: clone;
        }
        /* A whole sentence, so the quietest mark in the set: a dotted rule
           under the line. A block fill at this length turns half the page
           yellow and buries the phrase-level marks inside it. */
        mark.oc-bare {
          border-bottom: 1px dotted var(--warning);
          background: var(--warning-soft);
        }
        /* A phrase, and the one thing you act on first, so it is the loudest. */
        mark.oc-tell {
          border-bottom: 2px solid var(--negative);
          background: var(--negative-soft);
        }
        mark.oc-fact {
          background: var(--positive-soft);
          border-radius: 2px;
        }
        /* Not ours and not live, so it reads differently from the three that
           are: a wavy rule rather than a straight one, and no fill, so it can
           sit under a tell without either becoming unreadable. */
        mark.oc-machine {
          text-decoration: underline wavy var(--negative);
          text-underline-offset: 3px;
          text-decoration-thickness: 1px;
        }
        mark.oc-machine.oc-flash {
          background: var(--negative-soft);
          transition: background 240ms ease;
        }
        .oc-release-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s4); }
        @media (min-width: 1100px) {
          .oc-release-grid { grid-template-columns: minmax(0, 1fr) 320px; }
          /* The reading follows the sentence being edited down a long release
             rather than sitting at the top of it. */
          .oc-release-rail { position: sticky; top: var(--s4); align-self: start; }
        }
      `}</style>
      {/* "All releases" is not here any more. It is the way out of this
          screen, so it is drawn by the page, above the card this editor
          fills, rather than inside the record you are editing. Two copies
          would be worse than the wrong one. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s4)', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {/* .h3 is 14px — the same size as the body text under it — so the
            title of the thing you are editing was the quietest line on the
            screen. .h1 is the 24px step, which is what every other page uses
            for the record it is showing.

            An h2 wearing the .h1 class, not an h1: the Earned page already
            has one, for the section, at 40px. Two h1s on a page is a broken
            outline, and the release does sit under the section. */}
        <h2 className="h1" style={{ margin: 0 }}>{pr.title || 'New press release'}</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStandardOpen(true)}>
          The writing standard
        </button>
      </div>

      {/* The standard was a PDF download and nothing else, which teaches
          nobody anything: you do not read a 13-section document to remember
          why the page refuses to draft your prose. The rule and the division
          of labour are here, on screen, and the PDF is at the bottom for the
          whole thing. */}
      <SideDrawer open={standardOpen} onClose={() => setStandardOpen(false)}
        kicker="Earned" title="The October Human Writing Standard" width={620}>
        <div style={{ display: 'grid', gap: 'var(--s4)' }}>
          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>The rule</div>
            <p className="body-sm text-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Claude does everything except the prose. Research, angles, interview questions,
              fact chasing, structure, headline options, pitch variants, media lists and
              follow-ups are automated. The sentences of the release are written by a person,
              from a completed fact sheet.
            </p>
            <p className="body-sm text-muted" style={{ marginTop: 'var(--s2)', lineHeight: 1.6 }}>
              This is not a rule about detectors. The reason AI-written releases fail is the
              same reason they get flagged: nobody gathered the facts.
            </p>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>Who does what</div>
            <table className="table">
              <thead><tr><th>Stage</th><th>Claude</th><th>You</th></tr></thead>
              <tbody>
                {[
                  ['Angle options', 'proposes', 'decides'],
                  ['Interview questions', 'writes', 'asks'],
                  ['Fact sheet', 'structures, flags gaps', 'fills'],
                  ['Prose', 'does not write', 'writes or dictates'],
                  ['Gap analysis', 'scores and highlights', 'acts on'],
                  ['Headlines', 'proposes 10', 'picks and rewrites'],
                  ['Pitch emails', 'drafts variants', 'personalises'],
                  ['Media list', 'builds and dedupes', 'approves'],
                ].map(([stage, claude, you]) => (
                  <tr key={stage}>
                    <td style={{ fontWeight: stage === 'Prose' ? 700 : 400 }}>{stage}</td>
                    <td className="text-muted">{claude}</td>
                    <td className="text-muted">{you}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>The six moves a release makes</div>
            <p className="body-sm text-muted" style={{ margin: '0 0 var(--s2)', lineHeight: 1.6 }}>
              Reverse-engineered from the Hollaway F51 release. Five of the six are facts,
              which is why no model can fill them.
            </p>
            <ol className="body-sm text-muted" style={{ margin: 0, paddingLeft: 'var(--s5)', lineHeight: 1.7 }}>
              <li>A hook phrase, lifted from a person</li>
              <li>Scope, with a superlative or a hard number</li>
              <li>Material, method and siting</li>
              <li>The impact on the place or the user</li>
              <li>The wider programme it belongs to</li>
              <li>Third-party proof</li>
            </ol>
          </div>

          <div>
            <div className="h3" style={{ marginBottom: 'var(--s2)' }}>Writing it</div>
            <p className="body-sm text-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Dictate it. Talk through the completed fact sheet into a voice note, then tidy
              the transcript. Speech produces uneven sentence length, abandoned clauses and
              afterthoughts with no effort, and it is faster than typing.
            </p>
          </div>

          <a className="btn btn-secondary" href="/api/pr/editorial-standard.pdf" target="_blank" rel="noreferrer">
            ↓ The full standard (PDF)
          </a>
        </div>
      </SideDrawer>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
        <Field label="Headline / working title" value={pr.title} ro={readOnly}
          onChange={(v) => setPr((p) => ({ ...p, title: v }))} placeholder="e.g. Northgate Studio unveils House of Wood Shingle" />
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
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            try { await navigator.clipboard.writeText(pr.body_html || ''); toast('HTML copied.', 'success'); }
            catch { toast('Copy failed — select it in the source view.', 'error'); }
          }}>Copy HTML</button>
        </div>

        {/* Document left, reading right. The dial sits beside the sentence you
            are editing rather than a scroll away, so the number and the change
            that moved it are in the same glance. */}
        <div className="oc-release-grid">
          <div style={{ minWidth: 0 }}>
            {tab === 'document' ? (
              <>
                <Legend layerOn={layerOn} setLayerOn={setLayerOn} marks={marks}
                  reading={reading} flagged={flagged} />
                <DocumentSurface
                  html={pr.body_html ? html
                    : '<p style="color:var(--text-subtle)">Nothing written yet. Fill the fact sheet, then write it here.</p>'}
                  onChange={(v) => setPr((p) => ({ ...p, body_html: v }))}
                  readOnly={readOnly}
                  paintKey={`${pr.id || 'new'}:${LAYERS.map((l) => (layerOn[l.key] ? 1 : 0)).join('')}:${marks.machine.length}`}
                />
                {!readOnly && (
                  <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
                    Type straight into it. The dial moves as you type; the marks settle a moment after
                    you stop, so they are not repainted under the cursor.
                  </div>
                )}
              </>
            ) : (
              <textarea className="input" rows={24} disabled={readOnly}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace', fontSize: 'var(--fs-caption)' }}
                value={pr.body_html || ''} onChange={(e) => setPr((p) => ({ ...p, body_html: e.target.value }))} />
            )}
          </div>

          <aside className="oc-release-rail">
            <div style={{ padding: 'var(--s3)', border: LINE, borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
              <Dial score={reading.human_score} />

              {reading.human_parts.length > 0 && (
                <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
                  <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>What is costing points</div>
                  {reading.human_parts.map((part) => (
                    <div key={part.label} style={{ padding: '3px 0' }}>
                      <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 700, fontSize: 'var(--fs-body)' }}>−{part.cost}</span>
                        <span style={{ fontSize: 'var(--fs-body)' }}>{part.label}</span>
                      </div>
                      <div style={CAP}>{part.detail}</div>
                    </div>
                  ))}
                </div>
              )}

              {reading.weakest && reading.paragraphs.length > 1
                && reading.weakest.score < reading.human_score - 8 && (
                /* The headline number averages, and averaging hides what to act
                   on. Measured on a release later confirmed AI-written
                   throughout: the document scored 88 while this paragraph
                   scored 56. Naming the weakest passage is the difference
                   between a score and an instruction. */
                <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
                  <div style={{ ...CAP, marginBottom: 'var(--s1)' }}>
                    Weakest paragraph · scores <strong>{reading.weakest.score}</strong> against
                    {' '}{reading.human_score} for the whole release
                  </div>
                  <div style={{ fontSize: 'var(--fs-caption)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    &ldquo;{reading.weakest.text.slice(0, 160)}
                    {reading.weakest.text.length > 160 ? '…' : ''}&rdquo;
                  </div>
                  <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
                    {reading.weakest.density} checkable facts per 100 words here, against
                    {' '}{reading.density} across the release.
                  </div>
                </div>
              )}

              {/* The second reading, read in the opposite direction: here a LOW
                  number is the good one, because it is the share of the text
                  that reads as machine-written. The two dials are deliberately
                  not styled alike, because they measure different things and a
                  release has already scored 92 here and 86.56% there. */}
              <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: LINE }}>
                <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>Pangram</span>
                  {pr.pangram_checked_at && (
                    <span style={CAP}>{new Date(pr.pangram_checked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  )}
                </div>
                {detail?.raw?.windows || detail?.raw?.headline
                  ? <PangramPanel raw={detail.raw} segments={segments}
                      rewritten={rewritten} onGoTo={goToSegment} />
                  : (
                    <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
                      A trained classifier, and the one a journalist is most likely to paste this into.
                      It reports which passages read as written by a person and which by a model.
                    </div>
                  )}
                {!readOnly && (
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <button className="btn btn-secondary btn-sm"
                      {...roWrite(readOnly, {
                        onClick: runDetector,
                        disabled: detecting || !pr.id || !detector?.configured,
                        title: detector?.configured
                          ? 'One billable call. Unchanged text is served from the stored answer.'
                          : 'No Pangram key configured',
                      })}>
                      {detecting ? 'Checking…' : pr.pangram_checked_at ? 'Check again' : 'Run the detector'}
                    </button>
                    <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
                      {detector?.configured
                        ? <>About <strong>${detector.cost_usd?.toFixed(2)}</strong> for {detector.words} words.
                          Re-checking text that has not changed costs nothing.</>
                        : <>No key yet. Add one under{' '}
                          <a href="/settings/outreach">Settings → Keys → Outreach finders</a>.</>}
                    </div>
                    {/* Free: GET /models proves the base URL, the key and the
                        account before a billable word is sent. It exists
                        because the first integration went to a guessed host
                        that answered confidently and wrongly for several
                        rounds, and this would have caught it in one. */}
                    <div style={{ marginTop: 'var(--s2)' }}>
                      <button className="btn btn-secondary btn-sm" disabled={testing}
                        onClick={async () => {
                          setTesting(true);
                          try {
                            const r = await api.get('/pr/detector-connection');
                            toast(r.ok
                              ? `Connected to ${r.base}${r.models?.length ? ` · ${r.models.length} model(s): ${r.models.join(', ')}` : ''}`
                              : r.error, r.ok ? 'success' : 'error');
                          } catch (e) { toast(e.message, 'error'); } finally { setTesting(false); }
                        }}>
                        {testing ? 'Testing…' : 'Test the connection'}
                      </button>
                      <span style={{ ...CAP, marginLeft: 'var(--s2)' }}>Free. Proves the endpoint and key.</span>
                    </div>
                    {detail?.raw && (
                      <div style={{ marginTop: 'var(--s2)' }}>
                        <button type="button" onClick={() => setShowRaw((v) => !v)}
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', ...CAP, textDecoration: 'underline' }}>
                          {showRaw ? 'Hide' : 'Show'} the raw response
                          {detail.has_segments ? ` · ${detail.segment_count} segments` : ''}
                        </button>
                        {showRaw && (
                          <>
                            <pre style={{ margin: 'var(--s2) 0 0', maxHeight: 260, overflow: 'auto',
                              fontSize: 'var(--fs-caption)', fontFamily: 'ui-monospace, monospace',
                              whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: LINE,
                              borderRadius: 'var(--r-sm)', padding: 'var(--s2)' }}>
                              {JSON.stringify(detail.raw, null, 2)}
                            </pre>
                            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s2)' }}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(JSON.stringify(detail.raw, null, 2));
                                  toast('Copied.', 'success');
                                } catch { toast('Select it and copy manually.', 'error'); }
                              }}>Copy the response</button>
                          </>
                        )}
                      </div>
                    )}
                    {unparsed && (
                      <div style={{ marginTop: 'var(--s2)', padding: 'var(--s2)', border: LINE, borderRadius: 'var(--r-sm)' }}>
                        <div style={{ ...CAP, marginBottom: 'var(--s1)' }}>
                          The call succeeded and was billed, and the whole response is stored on the release.
                          The percentage is not under any of the field names this was built to expect, which
                          were taken from published documentation rather than from a live response. Send this
                          along and it is a one-line fix.
                        </div>
                        <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', fontSize: 'var(--fs-caption)',
                          fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(unparsed, null, 2)}
                        </pre>
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s2)' }}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(JSON.stringify(unparsed, null, 2));
                              toast('Copied.', 'success');
                            } catch { toast('Select it and copy manually.', 'error'); }
                          }}>Copy the response</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {reading.tells.length > 0 && (
                <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
                  <div style={{ ...CAP, marginBottom: 'var(--s2)' }}>
                    The phrases, underlined in red on the left. Cutting them is ordinary editing.
                  </div>
                  {Object.values(reading.tells.reduce((acc, t) => {
                    const k = `${t.kind}:${t.label}`;
                    acc[k] = acc[k] || { ...t, n: 0 };
                    acc[k].n += 1;
                    return acc;
                  }, {})).sort((a, b) => b.weight * b.n - a.weight * a.n).slice(0, 14).map((t) => (
                    <div key={`${t.kind}:${t.label}`} style={{ padding: '3px 0' }}>
                      <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{t.label}</span>
                      {t.n > 1 && <span style={{ ...CAP, marginLeft: 6 }}>×{t.n}</span>}
                      <div style={CAP}>{t.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </Section>

      {/* ── The check ──────────────────────────────────────────────────── */}
      <Section title="The check" hint="Live, free, and local. It counts facts, not style.">
        <div style={{ padding: 'var(--s4)', border: LINE, borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)', marginBottom: 'var(--s3)' }}>
          <div style={{ ...CAP, paddingTop: 0, borderTop: 0 }}>
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
            {' '}<strong>Measured, with ground truth.</strong> A release written entirely by a model
            scored <strong>96</strong> here, with no tells and no factless sentences. Pangram&rsquo;s web
            tool caught it at 87% AI; this panel did not, and neither did Pangram&rsquo;s own API. So a
            high score here means the obvious tells are gone and the reporting is in. It does not mean a
            person wrote it, and on the one case tested against the truth it did not even hint at it.
            Earlier on the same release: 94 here against 82% AI at Pangram, human-written-and-polished at
            GPTZero, 29% at ZeroGPT and 0% at QuillBot.
            {' '}Put the finished text through Pangram when the answer matters.
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
                  background: g.severity === 'high' ? 'var(--negative)' : 'var(--text-subtle)',
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
        {/* Called with no argument on purpose: onSave takes options now, and
            passing it straight to onClick hands it the click event. */}
        <button className="btn btn-primary" disabled={saving} onClick={() => onSave()}>{saving ? 'Saving…' : 'Save'}</button>
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
