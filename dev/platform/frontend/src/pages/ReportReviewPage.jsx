import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { reportStatusLabel, reportStatusTone } from '../utils/reportStatus';

// Read a generated report, add what it is missing, and send it.
//
// A page rather than a modal, for three reasons that each came up. The review
// email has to link to it, and a modal state over a list is not an address.
// It survives a refresh. And the modal this replaces closes on Escape with no
// check for unsaved work, which is the wrong reflex for a surface you type
// paragraphs into.
//
// The document column is 680px. A4 is 210mm and the report's text measure is
// about 170mm, which is roughly 642px at 96dpi — so line breaks and paragraph
// rhythm here are within a few per cent of what the client reads. That is the
// fidelity that matters for prose. For charts, tables and the ranking spread
// this page draws the real data but promises nothing about the layout, and
// "As the client sees it" is one click away: it renders through the same
// builder that makes the PDF, so the preview cannot drift from the real thing.

const DOC_WIDTH = 680;

// Margin affordances, not a toolbar: no border, no fill, out in the gutter.
const gutterButton = {
  border: 'none', background: 'none', cursor: 'pointer',
  width: 22, height: 22, lineHeight: '22px', padding: 0,
  color: 'var(--text-subtle)', fontSize: 14,
};
const CELLS_PER_ROW = 4;   // both renderers chunk at four; the wrap is real

// ── small pieces ────────────────────────────────────────────────────────────

// Text that looks like the document until the caret is in it. No edit mode to
// enter and no Done to remember: Daniel's ask was clicking and typing.
function Field({
  value, onChange, placeholder, multiline = false,
  style = {}, edited = false, onRevert, ariaLabel,
}) {
  const ref = useRef(null);

  // Grow to the content. A scrollbar inside a paragraph of a client report is
  // the clearest possible signal that this is a form and not a document.
  useEffect(() => {
    if (!multiline || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value, multiline]);

  const common = {
    ref,
    value: value || '',
    placeholder,
    'aria-label': ariaLabel,
    onChange: e => onChange(e.target.value),
    // Paste arrives as plain text whatever was copied: everything downstream
    // escapes, so styled markup from Word would reach the client as literal
    // angle brackets.
    onPaste: e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const el = e.target;
      const next = (value || '').slice(0, el.selectionStart) + text + (value || '').slice(el.selectionEnd);
      onChange(next);
    },
    style: {
      width: '100%', border: 'none', outline: 'none', resize: 'none',
      background: 'transparent', font: 'inherit', color: 'inherit',
      lineHeight: 'inherit', padding: '2px 4px', margin: '0 -4px',
      borderRadius: 'var(--r-xs)', overflow: 'hidden',
      ...style,
    },
    onFocus: e => { e.target.style.background = 'var(--surface-raised)'; e.target.style.boxShadow = '0 0 0 2px var(--card-border)'; },
    onBlur: e => { e.target.style.background = 'transparent'; e.target.style.boxShadow = 'none'; },
  };

  return (
    <div style={{ position: 'relative' }}>
      {edited && (
        <span
          title="Changed from the generated report"
          style={{
            position: 'absolute', left: -16, top: 9, width: 6, height: 6,
            background: 'var(--accent)', borderRadius: '50%',
          }}
        />
      )}
      {multiline ? <textarea rows={1} {...common} /> : <input type="text" {...common} />}
      {edited && onRevert && (
        <button
          type="button"
          onClick={onRevert}
          title="Put the generated wording back"
          style={{
            position: 'absolute', right: 0, top: 2, border: 'none', background: 'var(--surface)',
            cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 12, lineHeight: 1, padding: '2px 3px',
            borderRadius: 'var(--r-xs)',
          }}
        >↺</button>
      )}
    </div>
  );
}

// Read-only data. Drawn honestly, with no pretence that it is the print
// layout, because it cannot be edited here and the toggle shows the real one.
function ReadOnlyData({ section }) {
  const frame = {
    border: 'var(--border-w) solid var(--border-neutral)',
    borderRadius: 'var(--r-sm)', padding: 'var(--s3)', margin: 'var(--s2) 0',
    background: 'var(--surface-sunken)', fontSize: 'var(--fs-caption)',
  };

  if (section.type === 'tables') {
    return (
      <div style={{ margin: 'var(--s2) 0', overflowX: 'auto' }}>
        {(section.tables || []).map((t, ti) => (
          <table key={ti} style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-caption)', marginBottom: 'var(--s2)', width: '100%' }}>
            {t.headers && (
              <thead>
                <tr>{t.headers.map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--text)', fontWeight: 700 }}>{h}</th>
                ))}</tr>
              </thead>
            )}
            <tbody>
              {(t.rows || []).map((r, ri) => (
                <tr key={ri}>{(r || []).map((c, ci) => (
                  <td key={ci} style={{ padding: '4px 8px', borderBottom: '1px solid var(--accent-soft)' }}>{c}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    );
  }

  if (section.type === 'bar_chart') {
    const bars = (section.chart && section.chart.bars) || [];
    const max = Math.max(1, ...bars.map(b => Number(b.value) || 0));
    return (
      <div style={{ margin: 'var(--s2) 0' }}>
        {bars.map((b, i) => (
          <div key={i} className="row center" style={{ gap: 'var(--s2)', marginBottom: 4 }}>
            <span className="body-xs text-muted" style={{ width: 120, flex: 'none' }}>{b.label}</span>
            <span style={{ height: 10, background: 'var(--accent)', width: `${((Number(b.value) || 0) / max) * 100}%`, minWidth: 2 }} />
            <span className="body-xs">{b.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'position_distribution') {
    const ranked = (section.rankings || []).filter(k => k.current_position);
    return <div style={frame}>Ranking spread for {ranked.length} keyword{ranked.length === 1 ? '' : 's'}. Shown in full in the client's copy.</div>;
  }

  return null;
}

// ── the page ────────────────────────────────────────────────────────────────

export default function ReportReviewPage() {
  const { id: clientId, reportId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { readOnly } = useAuth();

  const [doc, setDoc] = useState(null);          // what the server last gave us
  const [sections, setSections] = useState([]);  // what the editor is holding
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);        // 'saving' | 'sending' | 'reverting'
  const [clientView, setClientView] = useState(null);  // rendered HTML, or null
  const [confirming, setConfirming] = useState(null);  // 'send' | 'revert'
  // Which comment boxes are open. Held here rather than by seeding the field
  // with a space: a space is a saved edit, and it would mark the section as
  // changed and render an empty panel in the client's copy.
  const [openNotes, setOpenNotes] = useState(() => new Set());
  // Which section the pointer is over, so the gutter controls can sit quietly
  // in the margin and come forward on the block being worked on. Two bordered
  // boxes beside every section read as chrome around the document.
  const [hovered, setHovered] = useState(null);
  const iframeRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/reports/${reportId}/sections`);
      setDoc(d);
      setSections(d.sections || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  const generated = useMemo(() => {
    const map = new Map();
    for (const s of (doc && doc.generated) || []) map.set(s.id, s);
    return map;
  }, [doc]);

  // Dirty is "differs from what the server holds", which is what Save acts on.
  // Edited is "differs from what the machine wrote", which is what the marks
  // show. They are not the same question and conflating them would mean a
  // saved edit stopped being marked.
  const dirty = useMemo(
    () => JSON.stringify(sections) !== JSON.stringify((doc && doc.sections) || []),
    [sections, doc]
  );

  const changeCount = useMemo(() => {
    let n = 0;
    for (const s of sections) {
      const g = generated.get(s.id);
      if (!g) { n += 1; continue; }
      if (s.hidden && !g.hidden) { n += 1; continue; }
      for (const f of ['title', 'text', 'note', 'insight']) {
        if ((s[f] || '') !== (g[f] || '')) n += 1;
      }
      (s.cells || []).forEach((c, i) => {
        const gc = (g.cells || [])[i] || {};
        if (c.label !== gc.label || c.value !== gc.value) n += 1;
      });
    }
    return n;
  }, [sections, generated]);

  // Leaving with unsaved paragraphs in the box is a real loss: nothing else
  // holds them.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!clientView || !iframeRef.current) return;
    const d = iframeRef.current.contentDocument;
    d.open(); d.write(clientView); d.close();
  }, [clientView]);

  function patch(index, changes) {
    setSections(prev => prev.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  }

  function patchCell(index, cellIndex, changes) {
    setSections(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const cells = (s.cells || []).map((c, ci) => (ci === cellIndex ? { ...c, ...changes } : c));
      return { ...s, cells };
    }));
  }

  function revertField(index, field) {
    const s = sections[index];
    const g = generated.get(s.id);
    if (!g) return;
    patch(index, { [field]: g[field] });
  }

  function addNoteAbove(index) {
    const note = {
      id: `note-${Date.now().toString(36)}`,
      type: 'note', title: '', text: '', hidden: false, added: true,
    };
    setSections(prev => [...prev.slice(0, index), note, ...prev.slice(index)]);
  }

  function dropAddedNote(index) {
    setSections(prev => prev.filter((_, i) => i !== index));
  }

  // The server refuses an empty added note, because it would render as a blank
  // panel in the client's copy. Catch it here so the message arrives before
  // the round trip and names which one.
  function emptyAddedNotes() {
    return sections
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !generated.has(s.id) && !(s.title || '').trim() && !(s.text || '').trim())
      .map(({ i }) => i + 1);
  }

  async function save() {
    const empty = emptyAddedNotes();
    if (empty.length) {
      toast(`Note ${empty.join(' and ')} has nothing in it — write something or remove it`, 'error');
      return null;
    }
    setBusy('saving');
    try {
      const d = await api.put(`/reports/${reportId}/sections`, { sections });
      toast('Saved, and the PDF rebuilt to match', 'success');
      setClientView(null);
      await load();
      return d;
    } catch (e) {
      // The save is all or nothing: the PDF is rendered before the row is
      // written, so a failure here has stored nothing and the edits are still
      // in the box.
      toast(`Not saved: ${e.message}`, 'error');
      throw e;
    } finally {
      setBusy(null);
    }
  }

  async function showClientView() {
    try {
      const { html } = await api.post(`/reports/${reportId}/render`, { sections });
      setClientView(html);
    } catch (e) {
      toast(`Could not render: ${e.message}`, 'error');
    }
  }

  async function revertAll() {
    setBusy('reverting');
    try {
      await api.post(`/reports/${reportId}/revert-edits`, {});
      toast('Edits discarded, generated report restored', 'success');
      setConfirming(null);
      setClientView(null);
      await load();
    } catch (e) {
      toast(`Could not revert: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('sending');
    try {
      if (dirty) {
        const saved = await save();
        // A refused save returns null rather than throwing, and sending an
        // unsaved report would deliver the generated one while the screen
        // still showed the edits.
        if (!saved) { setBusy(null); return; }
      }
      await api.post(`/reports/${reportId}/resend`, {});
      toast('Sending to the client', 'success');
      setConfirming(null);
      await load();
    } catch (e) {
      toast(`Not sent: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  // ── states before the document ────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ maxWidth: DOC_WIDTH, margin: '0 auto', padding: 'var(--s6) 0' }}>
        {[90, 70, 100, 100, 60].map((w, i) => (
          <div key={i} style={{ height: 14, width: `${w}%`, background: 'var(--surface-sunken)', borderRadius: 2, marginBottom: 'var(--s3)' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: DOC_WIDTH, margin: '0 auto', padding: 'var(--s6) 0' }}>
        <div className="callout callout-danger">{error}</div>
        <Link to={`/clients/${clientId}/dashboard/reports`} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s4)' }}>Back to reports</Link>
      </div>
    );
  }

  const editable = ['generated', 'sent', 'skipped_no_recipients'].includes(doc.status);
  const frozen = doc.status === 'sent';

  // A report generated before section storage has nothing to edit. Saying so
  // beats an empty document, which reads as a bug or as a report with nothing
  // in it.
  if (!(doc.generated || []).length) {
    return (
      <div style={{ maxWidth: DOC_WIDTH, margin: '0 auto', padding: 'var(--s6) 0' }}>
        <h1 className="h2" style={{ marginTop: 0 }}>{doc.client_name} · {doc.report_type === 'monthly' ? 'Monthly' : 'Weekly'}</h1>
        <div className="callout">
          This report was generated before reports stored their sections, so there is nothing to edit.
          Generating it again will produce an editable one.
        </div>
        <Link to={`/clients/${clientId}/dashboard/reports`} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s4)' }}>Back to reports</Link>
      </div>
    );
  }

  if (!editable) {
    return (
      <div style={{ maxWidth: DOC_WIDTH, margin: '0 auto', padding: 'var(--s6) 0' }}>
        <h1 className="h2" style={{ marginTop: 0 }}>{doc.client_name}</h1>
        <div className="callout">
          This report is <strong>{reportStatusLabel(doc.status).toLowerCase()}</strong>, so there is nothing to review yet.
          {doc.status === 'failed' && ' It needs generating again before it can be read or sent.'}
        </div>
        <Link to={`/clients/${clientId}/dashboard/reports`} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s4)' }}>Back to reports</Link>
      </div>
    );
  }

  const periodLabel = doc.period && doc.period.start
    ? new Date(doc.period.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  // ── the document ──────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sticky bar. Everything that acts on the whole report lives here, so
          the document column holds nothing but the document. */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)',
          borderBottom: 'var(--border-w) solid var(--accent-soft)',
          padding: 'var(--s3) var(--s4)', display: 'flex', alignItems: 'center',
          gap: 'var(--s4)', flexWrap: 'wrap',
        }}
      >
        <button type="button" onClick={() => navigate(`/clients/${clientId}/dashboard/reports`)} className="btn btn-secondary btn-sm">← Reports</button>
        <div style={{ minWidth: 0 }}>
          <div className="body-sm" style={{ fontWeight: 700 }}>
            {doc.client_name} · {doc.report_type === 'monthly' ? 'Monthly' : 'Weekly'} · {periodLabel}
          </div>
          <div className="body-xs text-muted">
            {dirty
              ? `${changeCount} change${changeCount === 1 ? '' : 's'}, unsaved`
              : doc.edited
                ? `Edited${doc.edited_by ? ` by ${doc.edited_by}` : ''}${doc.edited_at ? `, ${new Date(doc.edited_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`
                : 'As generated'}
          </div>
        </div>
        <span className={`chip chip-${reportStatusTone(doc.status)}`}>{reportStatusLabel(doc.status)}</span>
        <div className="row center" style={{ gap: 'var(--s2)', marginLeft: 'auto' }}>
          <button type="button" onClick={() => (clientView ? setClientView(null) : showClientView())} className="btn btn-secondary btn-sm">
            {clientView ? 'Back to editing' : 'As the client sees it'}
          </button>
          {(doc.edited || dirty) && !frozen && (
            <button type="button" onClick={() => setConfirming('revert')} className="btn btn-secondary btn-sm" disabled={!!busy || readOnly}>
              Revert all
            </button>
          )}
          {!frozen && (
            <button type="button" onClick={save} className={`btn btn-sm ${dirty ? 'btn-primary' : 'btn-secondary'}`} disabled={!dirty || !!busy || readOnly}>
              {busy === 'saving' ? 'Saving and rebuilding the PDF…' : 'Save'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirming('send')}
            className={`btn btn-sm ${dirty ? 'btn-secondary' : 'btn-primary'}`}
            disabled={!!busy || readOnly}
          >
            {busy === 'sending' ? 'Sending…' : frozen ? 'Send again' : 'Send to client'}
          </button>
        </div>
      </div>

      {frozen && (
        <div className="callout" style={{ margin: 'var(--s4) auto 0', maxWidth: DOC_WIDTH }}>
          Sent{doc.edited ? ', with the edits below' : ''}. The client has this copy, so what is here is the record of what went out.
        </div>
      )}

      {confirming === 'send' && (
        <div className="callout callout-warning" style={{ margin: 'var(--s4) auto 0', maxWidth: DOC_WIDTH }}>
          <div className="body-sm" style={{ marginBottom: 'var(--s2)' }}>
            {(doc.recipients || []).length
              ? <>Send the {periodLabel} report to {doc.recipients.length} recipient{doc.recipients.length === 1 ? '' : 's'}: <strong>{doc.recipients.join(', ')}</strong></>
              : <>This client has <strong>no report recipients configured</strong>, so sending will record the report as not sent and nothing will reach anybody.</>}
            {dirty && <div style={{ marginTop: 'var(--s2)' }}>Your {changeCount} unsaved change{changeCount === 1 ? '' : 's'} will be saved first.</div>}
          </div>
          <div className="row center" style={{ gap: 'var(--s2)' }}>
            <button type="button" onClick={send} className="btn btn-primary btn-sm" disabled={!!busy}>Send</button>
            <button type="button" onClick={() => setConfirming(null)} className="btn btn-secondary btn-sm">Cancel</button>
          </div>
        </div>
      )}

      {confirming === 'revert' && (
        <div className="callout callout-danger" style={{ margin: 'var(--s4) auto 0', maxWidth: DOC_WIDTH }}>
          <div className="body-sm" style={{ marginBottom: 'var(--s2)' }}>
            Discard {changeCount || 'all'} change{changeCount === 1 ? '' : 's'} and put the generated report back? The wording typed here is not kept.
          </div>
          <div className="row center" style={{ gap: 'var(--s2)' }}>
            <button type="button" onClick={revertAll} className="btn btn-primary btn-sm" disabled={!!busy}>Discard the edits</button>
            <button type="button" onClick={() => setConfirming(null)} className="btn btn-secondary btn-sm">Keep them</button>
          </div>
        </div>
      )}

      {clientView ? (
        <div style={{ padding: 'var(--s4)', background: 'var(--surface-raised)', minHeight: '70vh', display: 'flex' }}>
          <iframe
            ref={iframeRef}
            title="As the client sees it"
            sandbox="allow-same-origin"
            style={{ flex: 1, minHeight: '70vh', background: 'var(--surface)', border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)' }}
          />
        </div>
      ) : (
        <div style={{ maxWidth: DOC_WIDTH + 120, margin: '0 auto', padding: 'var(--s5) 0 var(--s8)' }}>
          <div style={{ maxWidth: DOC_WIDTH, margin: '0 auto' }}>
            {sections.map((section, index) => {
              const g = generated.get(section.id);
              const isAdded = !g;
              const changed = f => !!g && (section[f] || '') !== (g[f] || '');

              return (
                <div
                  key={section.id}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(h => (h === index ? null : h))}
                  onFocus={() => setHovered(index)}
                  style={{
                    position: 'relative', marginBottom: 'var(--s6)',
                    opacity: section.hidden ? 0.4 : 1,
                  }}
                >
                  {/* Gutter controls. A toolbar would sit between the reader
                      and the report; these appear beside the block being
                      worked on and leave the document alone. */}
                  <div
                    style={{
                      position: 'absolute', left: -38, top: 2, display: 'flex', flexDirection: 'column', gap: 2,
                      opacity: hovered === index || section.hidden ? 1 : 0.25,
                      transition: 'opacity 120ms ease',
                    }}
                  >
                    <button
                      type="button" onClick={() => addNoteAbove(index)} title="Add a note above this section"
                      style={gutterButton}
                    >+</button>
                    {isAdded ? (
                      <button
                        type="button" onClick={() => dropAddedNote(index)} title="Remove this note"
                        style={gutterButton}
                      >×</button>
                    ) : (
                      <button
                        type="button" onClick={() => patch(index, { hidden: !section.hidden })}
                        title={section.hidden ? 'Put this section back in the report' : 'Leave this section out of the report'}
                        style={gutterButton}
                      >{section.hidden ? '↩' : '⊘'}</button>
                    )}
                  </div>

                  {section.hidden && (
                    <div className="body-xs text-muted" style={{ marginBottom: 'var(--s2)', fontStyle: 'italic' }}>
                      Left out of the report. The client will not see this.
                    </div>
                  )}

                  <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 700, lineHeight: 1.3, marginBottom: 'var(--s2)' }}>
                    <Field
                      value={section.title}
                      onChange={v => patch(index, { title: v })}
                      placeholder={isAdded ? 'A heading, or leave it blank' : 'Section heading'}
                      ariaLabel="Section heading"
                      edited={changed('title')}
                      onRevert={() => revertField(index, 'title')}
                    />
                  </div>

                  {/* The model's one-line claim about the numbers. Editable,
                      because it goes to the client and the only other remedy
                      for a wrong one is removing the whole section. */}
                  {(section.insight || changed('insight')) && section.type !== 'note' && (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5, borderLeft: '2px solid var(--accent)', paddingLeft: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                      <Field
                        value={section.insight}
                        onChange={v => patch(index, { insight: v })}
                        placeholder="One line about these numbers"
                        ariaLabel="Insight"
                        multiline
                        edited={changed('insight')}
                        onRevert={() => revertField(index, 'insight')}
                      />
                    </div>
                  )}

                  {(section.type === 'narrative' || section.type === 'note') && (
                    <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.7 }}>
                      <Field
                        value={section.text}
                        onChange={v => patch(index, { text: v })}
                        placeholder={section.type === 'note' ? 'What the client should know' : 'Section text'}
                        ariaLabel="Section text"
                        multiline
                        edited={changed('text')}
                        onRevert={() => revertField(index, 'text')}
                      />
                    </div>
                  )}

                  {section.type === 'metrics_grid' && <MetricsGrid section={section} generatedSection={g} index={index} patchCell={patchCell} />}

                  {['tables', 'bar_chart', 'position_distribution'].includes(section.type) && <ReadOnlyData section={section} />}

                  {/* The comment. Four words that have to stay: a reviewer
                      must never wonder whether this is an internal note. */}
                  {section.type !== 'note' && (
                    (section.note || changed('note'))
                      ? (
                        <div style={{ borderLeft: '2px solid var(--accent)', paddingLeft: 'var(--s3)', marginTop: 'var(--s3)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
                          <Field
                            value={section.note}
                            onChange={v => patch(index, { note: v })}
                            placeholder="A comment for the client"
                            ariaLabel="Comment for the client"
                            multiline
                            edited={changed('note')}
                            onRevert={() => revertField(index, 'note')}
                          />
                        </div>
                      )
                      : openNotes.has(section.id)
                      ? (
                        <div style={{ borderLeft: '2px solid var(--accent)', paddingLeft: 'var(--s3)', marginTop: 'var(--s3)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
                          <Field
                            value={section.note}
                            onChange={v => patch(index, { note: v })}
                            placeholder="A comment for the client"
                            ariaLabel="Comment for the client"
                            multiline
                          />
                        </div>
                      )
                      : (
                        <button
                          type="button"
                          onClick={() => setOpenNotes(prev => new Set(prev).add(section.id))}
                          className="body-sm"
                          style={{ border: 'none', background: 'none', padding: 0, marginTop: 'var(--s2)', color: 'var(--text-subtle)', cursor: 'pointer' }}
                        >+ Add a comment for the client</button>
                      )
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => addNoteAbove(sections.length)}
              className="btn btn-secondary btn-sm"
            >+ Add a note at the end</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Chunked at four per row, matching both renderers. An AM editing a grid whose
// wrap they cannot see is editing a layout they will not recognise: a
// five-cell grid leaves the fifth cell full width in the PDF and pads the row
// with empty boxes in the email.
function MetricsGrid({ section, generatedSection, index, patchCell }) {
  const cells = section.cells || [];
  const rows = [];
  for (let i = 0; i < cells.length; i += CELLS_PER_ROW) rows.push(cells.slice(i, i + CELLS_PER_ROW));

  let offset = 0;
  return (
    <div style={{ margin: 'var(--s2) 0' }}>
      {rows.map((row, ri) => {
        const base = offset;
        offset += row.length;
        return (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: `repeat(${CELLS_PER_ROW}, 1fr)`, gap: 0 }}>
            {row.map((cell, ci) => {
              const cellIndex = base + ci;
              const gCell = ((generatedSection && generatedSection.cells) || [])[cellIndex] || {};
              const valueChanged = cell.value !== gCell.value;
              return (
                // data-cell is for the browser harness: a metric's label and
                // value are input values, not text nodes, so there is nothing
                // to select a cell by otherwise.
                <div key={ci} data-cell={cellIndex} style={{ border: 'var(--border-w) solid var(--text)', padding: 'var(--s2) var(--s3)' }}>
                  <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 700, lineHeight: 1.2 }}>
                    <Field
                      value={cell.value}
                      onChange={v => patchCell(index, cellIndex, { value: v })}
                      ariaLabel={`${cell.label || 'Metric'} value`}
                      edited={valueChanged}
                    />
                  </div>
                  <div style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4 }}>
                    <Field
                      value={cell.label}
                      onChange={v => patchCell(index, cellIndex, { label: v })}
                      ariaLabel="Metric label"
                      edited={cell.label !== gCell.label}
                    />
                  </div>
                  {/* The comparison is computed against the generated figure.
                      Changing the figure removes it, because nothing
                      recomputes it and "9,000 / up 8.2% / vs 11,534" is
                      arithmetic the client can catch. */}
                  {!valueChanged && cell.delta && (
                    <div className="body-xs text-muted" style={{ marginTop: 4 }}>
                      {cell.deltaDirection === 'up' ? '↑' : cell.deltaDirection === 'down' ? '↓' : ''} {cell.delta}
                      {cell.previous ? ` · vs ${cell.previous}` : ''}
                    </div>
                  )}
                  {valueChanged && (
                    <button
                      type="button"
                      onClick={() => patchCell(index, cellIndex, { value: gCell.value })}
                      title={gCell.delta
                        ? `Was ${gCell.value}. The comparison with last period has been removed, because it no longer matches this figure. Click to put the generated figure back.`
                        : `Was ${gCell.value}. Click to put the generated figure back.`}
                      className="body-xs"
                      style={{ marginTop: 4, color: 'var(--text-subtle)', fontStyle: 'italic', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    >
                      Was {gCell.value}{gCell.delta ? ' · comparison removed' : ''}
                    </button>
                  )}
                </div>
              );
            })}
            {row.length < CELLS_PER_ROW && Array.from({ length: CELLS_PER_ROW - row.length }).map((_, i) => (
              <div key={`pad-${i}`} style={{ border: 'var(--border-w) solid var(--border-neutral)', background: 'var(--surface-sunken)' }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
