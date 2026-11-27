// Settings → Appearance → Text size.
//
// Daniel: "list all the font sizes and weights with fields to change it. i want
// to test a few changes. and then as Caro uses it, allows them to adjust this
// also... have a default for company and then users can adjust?"
//
// Two audiences, so two zones. A Caro staffer wants bigger text and gets four
// named steps, one click, no save. An admin wants to tune the scale and gets
// the fifteen fields, with the page reflowing underneath as they type.
//
// The page behind this card is the preview. Settings carries a hero, a display
// heading, captions, field labels, body text, buttons and a table, which is a
// fair sample of OMI, and it is the only preview that cannot lie about what a
// change does. The card itself is pinned (see `.type-editor` in index.css), so
// the control that undoes a broken scale stays readable however broken the
// scale is.

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { applyScale, clearScale, cacheScale } from '../utils/typeScale';

const px = (token, v) => (token.startsWith('--fs-') ? `${v}px` : String(v));

// The draft values as a style object, for the specimen inside the pinned card.
function asStyle(values) {
  const out = {};
  for (const [t, v] of Object.entries(values || {})) out[t] = px(t, v);
  return out;
}

function sameValues(a, b, tokens) {
  return tokens.every(t => Number(a?.[t]) === Number(b?.[t]));
}

export default function TypeScalePanel() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});       // the house fields, while editing
  const [saving, setSaving] = useState(false);

  const sizeTokens = useMemo(() => (data?.sizes || []).map(s => s.token), [data]);
  const allTokens = useMemo(
    () => [...(data?.sizes || []), ...(data?.weights || [])].map(t => t.token), [data]);

  async function load() {
    try {
      const d = await api.get('/ui/type-scale');
      setData(d);
      setDraft(d.effective);
      return d;
    } catch (e) { toast(e.message, 'error'); return null; }
  }

  useEffect(() => {
    load().then(d => {
      // The escape hatch, for the case where the scale is too small to read the
      // screen that fixes it. Typed into the browser, not clicked in OMI:
      // /settings/text-size?reset
      if (d && new URLSearchParams(window.location.search).has('reset')) {
        saveOwn({}).then(() => toast('Your own text size is cleared.', 'success'));
      }
    });
    // Leave the saved scale applied on the way out: unmounting this panel is
    // navigating away, not discarding a save.
    // eslint-disable-next-line
  }, []);

  // ── the two writes ─────────────────────────────────────────────────────────

  async function saveOwn(values) {
    setSaving(true);
    try {
      const r = await api.put('/ui/type-scale/me', { values });
      clearScale(); applyScale(r.effective); cacheScale(r.effective);
      setData(d => ({ ...d, user: r.user, effective: r.effective }));
      setDraft(r.effective);
      return r;
    } catch (e) { toast(e.message, 'error'); return null; }
    finally { setSaving(false); }
  }

  async function saveHouse() {
    setSaving(true);
    try {
      // Only the tokens that differ from the built-in values are stored, so a
      // later change to index.css still reaches anyone who has not overridden
      // that token.
      const values = {};
      for (const t of allTokens) {
        if (Number(draft[t]) !== Number(data.defaults[t])) values[t] = Number(draft[t]);
      }
      const r = await api.put('/ui/type-scale/company', { values });
      clearScale(); applyScale(r.effective); cacheScale(r.effective);
      setData(d => ({ ...d, company: r.company, effective: r.effective }));
      setDraft(r.effective);
      toast('House default saved. Anyone without their own size sees it on their next page load.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  // Typing previews; only Save writes. F5 is the undo.
  function setField(token, raw) {
    const next = { ...draft, [token]: raw === '' ? '' : Number(raw) };
    setDraft(next);
    const clean = {};
    for (const [t, v] of Object.entries(next)) if (v !== '' && Number.isFinite(Number(v))) clean[t] = Number(v);
    applyScale(clean);
  }

  function revert() {
    setDraft(data.effective);
    clearScale(); applyScale(data.effective);
  }

  if (!data) return <div className="card"><p className="body">Loading…</p></div>;

  const ownPreset = data.presets.find(p => sameValues(data.user, p.values, sizeTokens))?.key || null;
  const hasOwn = Object.keys(data.user || {}).length > 0;
  const housePreset = data.presets.find(p => sameValues({ ...data.defaults, ...data.company }, p.values, sizeTokens));
  const dirty = allTokens.some(t => Number(draft[t]) !== Number(data.effective[t]));

  // Ordering, not absolutes, is the real failure: at body 18 with title left
  // alone, a card heading and the text under it are the same size and the page
  // stops having a shape. Said on the row rather than blocking the field.
  const inversions = [];
  for (let i = 1; i < sizeTokens.length; i += 1) {
    const [prev, cur] = [sizeTokens[i - 1], sizeTokens[i]];
    if (Number(draft[cur]) <= Number(draft[prev])) inversions.push(cur);
  }

  return (
    <div className="type-editor" style={{ display: 'grid', gap: 16 }}>

      {/* ── Zone 1: everyone ─────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="h3" style={{ marginBottom: 4 }}>Your text size</h3>
        <p className="body-sm" style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
          Saved to your login only. Nobody else sees it.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.presets.map(p => {
            const chosen = ownPreset === p.key || (!hasOwn && housePreset?.key === p.key);
            return (
              <button
                key={p.key}
                type="button"
                disabled={saving}
                onClick={() => saveOwn(p.key === housePreset?.key ? {} : p.values)}
                style={{
                  flex: '1 1 150px', textAlign: 'left', cursor: 'pointer',
                  padding: '12px 14px', borderRadius: 'var(--r-sm)',
                  border: `1.5px solid ${chosen ? 'var(--text)' : 'var(--card-border)'}`,
                  background: chosen ? 'var(--surface-sunken)' : 'var(--surface)',
                }}
              >
                <span style={{ display: 'block', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text)' }}>
                  {p.label}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {p.values['--fs-body']}px body
                  {housePreset?.key === p.key ? ' · house default' : ''}
                </span>
              </button>
            );
          })}
        </div>

        <p className="body-xs" style={{ marginTop: 12 }}>
          {hasOwn ? (
            <>
              Your own setting. The house default is <strong>{housePreset?.label || 'a custom scale'}</strong>.{' '}
              {/* Clearing the key rather than writing the house values into it:
                  storing the numbers would silently stop this user tracking a
                  later change to the house scale, and nobody would connect the
                  two six months on. */}
              <button type="button" className="btn-link" disabled={saving} onClick={() => saveOwn({})}>
                Use the house default
              </button>
            </>
          ) : (
            <>Following the house default{housePreset ? <> (<strong>{housePreset.label}</strong>, {housePreset.values['--fs-body']}px body)</> : null}. Set by an administrator.</>
          )}
        </p>
      </div>

      {/* ── Zone 2: admin ────────────────────────────────────────────────────
          Omitted rather than disabled for a viewer or a client. Fifteen dead
          controls for a right they cannot acquire on this screen is fifteen
          things to read and nothing to do. */}
      {isAdmin && (
        <div className="card">
          <h3 className="h3" style={{ marginBottom: 4 }}>House default</h3>
          <p className="body-sm" style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
            What everyone sees unless they have set their own size above. The page behind this card
            changes as you type; nothing is stored until you save.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) 1fr', gap: 24, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 14 }}>

              <div>
                <p className="caption" style={{ marginBottom: 8 }}>Sizes</p>
                {data.sizes.map(s => (
                  <Row
                    key={s.token}
                    label={s.label} hint={s.affects}
                    value={draft[s.token]} onChange={v => setField(s.token, v)}
                    min={s.min} max={s.max} step={1} suffix="px"
                    deflt={data.defaults[s.token]}
                    warn={inversions.includes(s.token)
                      ? `Not smaller than the role above it, so headings and body text read the same size.`
                      : null}
                  />
                ))}
              </div>

              <div>
                <p className="caption" style={{ marginBottom: 8 }}>Weights</p>
                {/* 400/500/600/700 and nothing else: those are the four
                    Brockmann files. 800 renders as 700 and 300 as 400, so a
                    field offering them would visibly do nothing. */}
                {data.weights.map(w => (
                  <Row
                    key={w.token}
                    label={w.label} hint={w.affects}
                    value={draft[w.token]} onChange={v => setField(w.token, v)}
                    min={w.min} max={w.max} step={100}
                    deflt={data.defaults[w.token]}
                    options={[400, 500, 600, 700]}
                  />
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={saveHouse}>
                  {saving ? 'Saving…' : 'Save house default'}
                </button>
                <button className="btn btn-secondary" disabled={!dirty || saving} onClick={revert}>
                  Revert to saved
                </button>
              </div>
              <p className="body-xs">
                If a scale ever leaves the app unreadable, open <code>/settings/text-size?reset</code> in the
                browser. It clears your own size and reloads, and works even when nothing on screen can be read.
              </p>
            </div>

            <Specimen values={draft} />
          </div>
        </div>
      )}
    </div>
  );
}

// One field. The number is typed or stepped; weights are a short select
// because they have four legal values and a number field invites the other six.
function Row({ label, hint, value, onChange, min, max, step, suffix, deflt, options, warn }) {
  const changed = Number(value) !== Number(deflt);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 10, alignItems: 'start', padding: '7px 0' }}>
      <div>
        <span style={{ display: 'block', fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text)' }}>
          {label}
        </span>
        <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', lineHeight: 1.35 }}>
          {hint}
        </span>
        {warn && (
          <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: '#9a6b00', marginTop: 2 }}>
            {warn}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {options ? (
          <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%' }}>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            className="input" type="number" value={value}
            min={min} max={max} step={step}
            onChange={e => onChange(e.target.value)}
            style={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          />
        )}
        {suffix && <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{suffix}</span>}
      </div>
      {changed && (
        <span style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
          Default {deflt}{suffix || ''}
        </span>
      )}
    </div>
  );
}

// A real screen, not an alphabet. Nobody reports that the 24px heading is
// wrong; they report that the coverage table feels cramped, so show a table.
// It carries the draft values itself, because the card around it is pinned.
function Specimen({ values }) {
  return (
    <div style={{ ...asStyle(values), border: '1px solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 18, background: 'var(--surface)', position: 'sticky', top: 12 }}>
      <p className="kicker" style={{ marginBottom: 6 }}>Earned media</p>
      <h2 className="display" style={{ marginBottom: 14 }}>48 placements</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {[['Reach', '2.4m'], ['Tier 1', '11'], ['Avg DA', '62']].map(([k, v]) => (
          <div key={k} style={{ flex: 1, border: '1px solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '8px 10px' }}>
            <p className="caption" style={{ marginBottom: 2 }}>{k}</p>
            <p className="metric" style={{ fontSize: 'var(--fs-section)' }}>{v}</p>
          </div>
        ))}
      </div>
      <h3 className="h3" style={{ marginBottom: 6 }}>Recent coverage</h3>
      <table className="table" style={{ width: '100%' }}>
        <thead><tr><th>Outlet</th><th>Headline</th><th>Tier</th></tr></thead>
        <tbody>
          <tr><td>Dezeen</td><td>A Margate studio opens its first workshop</td><td>1</td></tr>
          <tr><td>Wallpaper*</td><td>Twelve rooms, one material</td><td>1</td></tr>
          <tr><td>Design Week</td><td>The quiet return of the terrazzo floor</td><td>2</td></tr>
        </tbody>
      </table>
      <p className="body-xs" style={{ marginTop: 10 }}>Figures to 27 November. Reach is publisher-reported.</p>
    </div>
  );
}
