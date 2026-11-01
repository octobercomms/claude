// Edit one ad concept.
//
// Until now the only way to change a headline was to brief Claude and have it
// rewrite the whole concept: "Refine with Claude" lifted the card into a
// two-column page view with a chat beside it and no input you could type in.
// That meant fixing a typo cost an API call, took ten seconds, and risked the
// other five fields coming back changed. Daniel: "allow me to edit the text
// myself, not just brief claude on changes."
//
// So the fields are the modal and the chat sits beside them. Claude is one of
// two ways to change the copy here, not the only one, and both write to the
// same place: the draft held in this component until you save.
//
// Nothing is written until Save, so an abandoned refine leaves the concept
// alone. The chat applying a revision fills the fields rather than saving
// over your work, which also means you can take Claude's headline and keep
// your own body.

import React, { useState } from 'react';
import RefineChat from '../RefineChat';

const FIELDS = [
  { key: 'headline', label: 'Headline', rows: 2,
    hint: 'The line that stops the scroll. Meta truncates around 40 characters on mobile.' },
  { key: 'body', label: 'Body', rows: 5,
    hint: 'Primary text. Meta shows roughly the first 125 characters before "See more".' },
  { key: 'cta', label: 'CTA', rows: 1,
    hint: 'The button words. Short and a verb.' },
  { key: 'visual_concept', label: 'Visual concept', rows: 4,
    hint: 'What the image should show. This is the prompt Render builds from, so it is worth being specific here.' },
  { key: 'notes', label: 'Notes', rows: 2,
    hint: 'Yours. Never sent to the client and never used in a render.' },
];

// The same labels the artifact uses, so a revision Claude writes maps back
// onto the fields without a second vocabulary to keep in step.
function conceptToArtifact(c) {
  return [
    `FRAMEWORK: ${c.framework || ''}`,
    `ANGLE: ${c.angle || ''}`,
    `HEADLINE: ${c.headline || ''}`,
    `BODY: ${c.body || ''}`,
    `CTA: ${c.cta || ''}`,
    `VISUAL CONCEPT: ${c.visual_concept || ''}`,
    c.notes ? `NOTES: ${c.notes}` : '',
  ].filter(Boolean).join('\n\n');
}

// Pull the fields back out of Claude's revision. Tolerant of stray markdown
// bold and case variation, because the system prompt asks for these labels
// but a model is not a parser.
export function parseConceptFields(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\*\*/g, '').trim();
  const labels = ['headline', 'body', 'cta', 'visual concept', 'visual', 'notes', 'angle'];
  const out = {};
  for (const label of labels) {
    // `[ \t]*` after the colon rather than `\s*`, which is the difference
    // between "this field is empty" and "this field ate the next one". With
    // `\s*`, a reply carrying `BODY:` followed by a blank line and `CTA: Buy`
    // consumed both newlines before the capture started, so the lookahead for
    // the next label could not match and `body` came back as "CTA: Buy" —
    // an empty field silently stealing the value of the one after it. Not
    // crossing a newline here also lets a model put the value on its own
    // line under the label, which trim() then tidies.
    const re = new RegExp(`(?:^|\\n)[ \\t]*${label}[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*(?:${labels.join('|')})[ \\t]*:|$)`, 'i');
    const m = cleaned.match(re);
    if (!m) continue;
    const value = m[1].trim();
    if (!value) continue;
    const key = label === 'visual' || label === 'visual concept' ? 'visual_concept' : label;
    if (!out[key]) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export default function ConceptEditModal({ creative, clientId, onSave, onClose }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const f of FIELDS) d[f.key] = creative[f.key] || '';
    return d;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [showChat, setShowChat] = useState(false);

  const set = (key, value) => setDraft(p => ({ ...p, [key]: value }));

  // Only the fields you changed. The endpoint COALESCEs, so sending every
  // field would also work, but a diff keeps the request honest about what
  // this edit did and leaves anything added to the concept elsewhere alone.
  const changed = FIELDS.filter(f => draft[f.key] !== (creative[f.key] || ''));

  async function save() {
    if (!changed.length) { onClose(); return; }
    setSaving(true); setErr(null);
    try {
      const partial = {};
      for (const f of changed) partial[f.key] = draft[f.key];
      await onSave(partial);
      onClose();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* 80% of the viewport, with or without the chat. This was 560px, and
          1120px once the chat opened, so editing a concept happened in a
          strip in the middle of the screen while the page behind it sat
          empty. The fields are the work; give them the room. */}
      <div className="modal modal-80" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="h2" style={{ margin: 0 }}>Edit concept</h2>
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
              {creative.framework}{creative.angle ? ` · ${creative.angle}` : ''}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: showChat ? 'minmax(0, 1fr) 380px' : '1fr', gap: 'var(--s5)' }}>
          <div>
            {FIELDS.map(f => (
              <div className="field" key={f.key} style={{ marginBottom: 'var(--s4)' }}>
                <label className="field-label" htmlFor={`cf-${f.key}`} title={f.hint}>{f.label}</label>
                <textarea
                  id={`cf-${f.key}`}
                  className="textarea"
                  rows={f.rows}
                  value={draft[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
                <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>{f.hint}</div>
              </div>
            ))}
          </div>

          {showChat && (
            // Applying a revision fills the fields; it does not save. So you
            // keep what Claude wrote for the headline and your own body if
            // that is the combination you want, and closing without saving
            // throws the whole thing away.
            <RefineChat
              clientId={clientId}
              kind="ad_concepts"
              artifact={conceptToArtifact({ ...creative, ...draft })}
              artifactMeta={`framework: ${creative.framework}, angle: ${creative.angle}`}
              onApplyRevision={(content) => {
                const partial = parseConceptFields(content);
                if (!partial) {
                  setErr('Could not read a revised concept out of that reply. Ask Claude to keep the HEADLINE / BODY / CTA labels.');
                  return;
                }
                setErr(null);
                setDraft(p => ({ ...p, ...partial }));
              }}
              onClose={() => setShowChat(false)}
              compact
            />
          )}
        </div>

        {err && <div className="callout callout-danger body-sm" style={{ marginTop: 'var(--s3)' }}>{err}</div>}

        <div className="row end mt-5" style={{ gap: 'var(--s2)' }}>
          {!showChat && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }}
              onClick={() => setShowChat(true)}>✦ Ask Claude to rewrite it</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
