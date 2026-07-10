import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Visualise — image generation + surgical-refinement studio (docs/omi/visualise-studio.md).
// Phase 2: Library + the Generate studio (create project → inputs + guided
// fields → configurable generation → pick the best variation). The correction
// canvas, lock and 4K export land in later phases.
//
// Views via ?tab= : `library` (default) and `studio&project=<id>`.
const STATUS = {
  draft: { label: 'Draft', tone: 'var(--text-subtle)' },
  in_progress: { label: 'In progress', tone: 'var(--accent)' },
  locked: { label: 'Locked', tone: 'var(--positive)' },
};

export default function ClientVisualisePage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'library';
  const projectId = params.get('project');

  const openStudio = (pid) => setParams({ tab: 'studio', project: pid });
  const openLibrary = () => setParams({ tab: 'library' });

  return (
    <div>
      <div className="kicker"><span className="pip" />Visualise</div>
      {tab === 'studio' && projectId
        ? <Studio clientId={id} projectId={projectId} onBack={openLibrary} />
        : <Library clientId={id} onOpen={openStudio} />}
    </div>
  );
}

// ── Library ───────────────────────────────────────────────────────────────────
function Library({ clientId, onOpen }) {
  const toast = useToast();
  const [projects, setProjects] = useState(null);
  const [presets, setPresets] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);
  async function load() {
    try {
      const [pj, ps] = await Promise.all([
        api.get(`/visualise/clients/${clientId}/projects`),
        api.get(`/visualise/clients/${clientId}/presets`),
      ]);
      setProjects(pj); setPresets(ps);
    } catch (e) { toast(e.message, 'error'); setProjects([]); }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

  return (
    <>
      <header className="hero">
        <h1 className="display">Visualise</h1>
        <p className="body mt-4" style={{ maxWidth: 640 }}>
          Reference in → generate → circle-and-fix the wrong bit → lock → faithful 4K.
          Every project is saved here and reopenable.
        </p>
      </header>

      <div className="row between center mb-6 wrap" style={{ gap: 12 }}>
        <div className="caption">{projects?.length || 0} project{projects?.length === 1 ? '' : 's'}</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!presets.length}>+ New project</button>
      </div>

      {projects === null ? (
        <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
      ) : !projects.length ? (
        <div className="card"><div className="text-subtle" style={{ padding: 20 }}>No projects yet. Start one to generate your first images.</div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {projects.map(p => {
            const st = STATUS[p.status] || STATUS.draft;
            return (
              <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => onOpen(p.id)}>
                <div style={{ aspectRatio: '4/3', background: 'var(--surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.thumb_url
                    ? <img src={p.thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span className="text-subtle body-xs">No image yet</span>}
                </div>
                <div style={{ padding: 12 }}>
                  <div className="strong" style={{ marginBottom: 4 }}>{p.name}</div>
                  <div className="row between center">
                    <span style={{ color: st.tone, fontWeight: 700, fontSize: 12 }}>{st.label}</span>
                    <span className="text-subtle body-xs">{p.variant_count || 0} variant{p.variant_count === 1 ? '' : 's'} · {fmt(p.created_at)}</span>
                  </div>
                  {p.created_by_name && <div className="text-subtle body-xs mt-1">by {p.created_by_name}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreateModal clientId={clientId} presets={presets} onClose={() => setCreating(false)} onCreated={onOpen} />}
    </>
  );
}

function CreateModal({ clientId, presets, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState(presets[0]?.id || '');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const p = await api.post(`/visualise/clients/${clientId}/projects`, { name: name.trim(), preset_id: presetId || null });
      onCreated(p.id);
    } catch (e) { toast(e.message, 'error'); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2 className="h2">New project</h2><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="field"><label className="field-label">Name</label>
          <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kung Fu Panda greeter" onKeyDown={e => e.key === 'Enter' && create()} /></div>
        <div className="field"><label className="field-label">Preset</label>
          <select className="input" value={presetId} onChange={e => setPresetId(e.target.value)}>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div className="row end mt-5">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={create} disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Studio ────────────────────────────────────────────────────────────────────
function Studio({ clientId, projectId, onBack }) {
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [preset, setPreset] = useState(null);
  const [count, setCount] = useState(4);
  const [orientation, setOrientation] = useState('portrait');
  const [generating, setGenerating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [guided, setGuided] = useState({});

  useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);
  async function load() {
    try {
      const p = await api.get(`/visualise/projects/${projectId}`);
      setProject(p); setGuided(p.guided_values || {});
      const presets = await api.get(`/visualise/clients/${clientId}/presets`);
      setPreset(presets.find(x => x.id === p.preset_id) || null);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function patchGuided(next) {
    setGuided(next);
    try { await api.patch(`/visualise/projects/${projectId}`, { guided_values: next }); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function generate() {
    if (generating) return;
    setGenerating(true);
    try {
      await api.post(`/visualise/projects/${projectId}/generate`, { count, orientation });
      await load();
      toast('Generated. Pick the best one.', 'success');
    } catch (e) { toast(`Generation failed: ${e.message}`, 'error'); }
    finally { setGenerating(false); }
  }

  if (!project) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  const baseVariant = (project.variants || []).find(v => !v.scene_prompt) || project.variants?.[0];
  const allSteps = baseVariant?.steps || [];
  const steps = allSteps.filter(s => s.kind === 'generation');
  const activeId = baseVariant?.active_step_id;
  const activeStep = allSteps.find(s => s.id === activeId) || null;
  const price = preset?.price_per_image ?? 0.1;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}>← Library</button>
      <div className="row between center wrap mb-4" style={{ gap: 12 }}>
        <div>
          <h1 className="h1">{project.name}</h1>
          <div className="body-sm text-muted">{preset?.name || 'No preset'} · {steps.length} variation{steps.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        {/* Left: inputs + guided fields + generate controls */}
        <div className="stack" style={{ gap: 14 }}>
          <InputsPanel clientId={clientId} project={project} preset={preset} onChange={load} />

          {preset?.guided_fields?.length > 0 && (
            <div className="card">
              <div className="caption mb-3">Guided fields</div>
              {preset.guided_fields.map(f => (
                <GuidedField key={f.key} field={f} value={guided[f.key]} onChange={(v) => patchGuided({ ...guided, [f.key]: v })} />
              ))}
            </div>
          )}

          <div className="card">
            <div className="caption mb-3">Generate</div>
            <Field label={`How many (${count})`}>
              <input type="range" min="1" max="8" value={count} onChange={e => setCount(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
            </Field>
            <Field label="Orientation">
              <div className="row" style={{ gap: 6 }}>
                {['portrait', 'landscape', 'square'].map(o => (
                  <button key={o} className={'btn btn-sm ' + (orientation === o ? 'btn-primary' : 'btn-secondary')} onClick={() => setOrientation(o)} style={{ textTransform: 'capitalize' }}>{o}</button>
                ))}
              </div>
            </Field>
            <div className="body-xs text-subtle" style={{ margin: '8px 0 12px' }}>
              Est. <strong>${(price * count).toFixed(2)}</strong> for {count} image{count === 1 ? '' : 's'} (${price.toFixed(2)} each).
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={generate} disabled={generating}>
              {generating ? 'Generating…' : `⚡ Generate ${count}`}
            </button>
          </div>
        </div>

        {/* Right: history + circle-and-fix */}
        <div className="card" style={{ minHeight: '60vh' }}>
          {generating ? (
            <GeneratingState count={count} />
          ) : !allSteps.length ? (
            <div className="text-subtle" style={{ padding: 40, textAlign: 'center' }}>
              No images yet. Add your references on the left, fill the guided fields, then <strong>Generate</strong>.
            </div>
          ) : (
            <>
              <div className="caption mb-2">History — click any image to select it ({steps.length} generation{steps.length === 1 ? '' : 's'}{allSteps.length > steps.length ? `, ${allSteps.length - steps.length} fix${allSteps.length - steps.length === 1 ? '' : 'es'}` : ''})</div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 14 }}>
                {allSteps.map(s => (
                  <button key={s.id} onClick={() => setActive(baseVariant.id, s.id)} title={s.kind === 'correction' ? (s.instruction || 'fix') : 'generation'}
                    style={{ flex: '0 0 auto', border: '2px solid ' + (s.id === activeId ? 'var(--accent)' : 'var(--card-border)'), borderRadius: 8, padding: 0, background: 'none', cursor: 'pointer', position: 'relative', lineHeight: 0 }}>
                    <img src={s.image_url} alt="" style={{ width: 66, height: 88, objectFit: 'cover', display: 'block', borderRadius: 6 }} />
                    <span style={{ position: 'absolute', bottom: 3, left: 3, background: s.kind === 'correction' ? 'var(--accent)' : 'rgba(0,0,0,.6)', color: s.kind === 'correction' ? 'var(--accent-on)' : '#fff', fontSize: 8, fontWeight: 800, borderRadius: 3, padding: '0 4px' }}>{s.kind === 'correction' ? 'FIX' : 'GEN'}</span>
                  </button>
                ))}
              </div>

              {activeStep ? (
                <CorrectionCanvas key={activeStep.id} imageUrl={activeStep.image_url} price={preset?.price_inpaint ?? 0.05} busy={fixing} onApply={applyFix} />
              ) : (
                <div className="text-subtle" style={{ padding: 20, textAlign: 'center' }}>Select an image above to refine it — then circle the area to change.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  async function setActive(variantId, stepId) {
    try { await api.post(`/visualise/variants/${variantId}/active`, { step_id: stepId }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function applyFix(maskBlob, instruction, referenceFile) {
    if (fixing) return;
    setFixing(true);
    try {
      const fd = new FormData();
      fd.append('mask', maskBlob, 'mask.png');
      fd.append('instruction', instruction);
      fd.append('base_step_id', activeId);
      if (referenceFile) fd.append('reference', referenceFile);
      await api.postForm(`/visualise/variants/${baseVariant.id}/inpaint`, fd);
      await load();
      toast('Fix applied — only the circled area changed.', 'success');
    } catch (e) { toast(`Fix failed: ${e.message}`, 'error'); }
    finally { setFixing(false); }
  }
}

// The crown jewel (§9): render the active image, let the user circle/paint the
// region to change, and produce a binary mask PNG at the image's native size.
// Only that region is regenerated (server composites the edit back inside the
// mask, so everything else stays pixel-identical).
function CorrectionCanvas({ imageUrl, price, busy, onApply }) {
  const viewRef = useRef(null);
  const maskRef = useRef(null);
  const drawing = useRef(false);
  const [brush, setBrush] = useState(40);
  const [instruction, setInstruction] = useState('');
  const [reference, setReference] = useState(null);
  const [hasMask, setHasMask] = useState(false);

  function onImgLoad(e) {
    const img = e.target, w = img.naturalWidth, h = img.naturalHeight;
    const view = viewRef.current;
    view.width = w; view.height = h;
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    const mctx = mask.getContext('2d'); mctx.fillStyle = '#000'; mctx.fillRect(0, 0, w, h);
    maskRef.current = mask;
    view.getContext('2d').clearRect(0, 0, w, h);
    setHasMask(false);
  }
  function at(e) {
    const view = viewRef.current, rect = view.getBoundingClientRect();
    const sx = view.width / rect.width, sy = view.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy, r: (brush * sx) / 2 };
  }
  function paint(e) {
    if (!maskRef.current) return;
    const { x, y, r } = at(e);
    const v = viewRef.current.getContext('2d');
    v.fillStyle = 'rgba(231,205,65,0.45)'; v.beginPath(); v.arc(x, y, r, 0, Math.PI * 2); v.fill();
    const m = maskRef.current.getContext('2d');
    m.fillStyle = '#fff'; m.beginPath(); m.arc(x, y, r, 0, Math.PI * 2); m.fill();
    if (!hasMask) setHasMask(true);
  }
  function down(e) { e.preventDefault(); drawing.current = true; try { viewRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ } paint(e); }
  function move(e) { if (drawing.current) paint(e); }
  function stop() { drawing.current = false; }
  function clear() {
    const view = viewRef.current; if (view) view.getContext('2d').clearRect(0, 0, view.width, view.height);
    const mask = maskRef.current; if (mask) { const m = mask.getContext('2d'); m.fillStyle = '#000'; m.fillRect(0, 0, mask.width, mask.height); }
    setHasMask(false);
  }
  function apply() {
    if (!hasMask || !instruction.trim() || busy || !maskRef.current) return;
    maskRef.current.toBlob(b => onApply(b, instruction.trim(), reference), 'image/png');
  }

  return (
    <div>
      <div className="caption mb-2">Circle the area to change, then say what it should be</div>
      <div style={{ position: 'relative', maxWidth: 520, margin: '0 auto', lineHeight: 0 }}>
        <img src={imageUrl} alt="" onLoad={onImgLoad} style={{ width: '100%', display: 'block', borderRadius: 8 }} />
        <canvas ref={viewRef}
          onPointerDown={down} onPointerMove={move} onPointerUp={stop} onPointerLeave={stop}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none', borderRadius: 8 }} />
      </div>
      <div className="row center wrap" style={{ gap: 12, margin: '12px 0' }}>
        <label className="row center body-xs text-muted" style={{ gap: 6 }}>Brush
          <input type="range" min="12" max="120" value={brush} onChange={e => setBrush(parseInt(e.target.value, 10))} /></label>
        <button className="btn btn-ghost btn-sm" onClick={clear} disabled={!hasMask}>Clear</button>
      </div>
      <textarea className="textarea" rows={2} value={instruction} onChange={e => setInstruction(e.target.value)}
        placeholder="e.g. the collar underside should be red" />
      <div className="row between center wrap" style={{ gap: 8, marginTop: 8 }}>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          {reference ? '✓ Reference added' : '+ Reference crop (optional)'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setReference(e.target.files?.[0] || null)} />
        </label>
        <span className="body-xs text-subtle">Est. <strong>${price.toFixed(2)}</strong> per fix</span>
      </div>
      <button className="btn btn-primary mt-3" style={{ width: '100%' }} onClick={apply} disabled={busy || !hasMask || !instruction.trim()}>
        {busy ? 'Applying the fix…' : '✎ Apply fix to the circled area'}
      </button>
    </div>
  );
}

function GuidedField({ field, value, onChange }) {
  if (field.type === 'toggle') {
    const on = value == null ? !!field.default : !!value;
    return (
      <label className="row center" style={{ gap: 8, padding: '6px 0', cursor: field.locked ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={on} disabled={field.locked} onChange={e => onChange(e.target.checked)} />
        <span className="body-sm">{field.label}{field.locked ? ' (always on)' : ''}</span>
      </label>
    );
  }
  return (
    <Field label={field.label}>
      <input className="input" defaultValue={value || ''} placeholder={field.placeholder || ''}
        onBlur={e => e.target.value !== (value || '') && onChange(e.target.value)} />
    </Field>
  );
}

function InputsPanel({ clientId, project, preset, onChange }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = preset?.input_slots || [{ kind: 'sketch', label: 'Reference image' }];
  const imageSlots = slots.filter(s => s.kind !== 'note');

  async function upload(file, forKind) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('kind', forKind);
      await api.postForm(`/visualise/projects/${project.id}/inputs`, fd);
      await onChange();
    } catch (e) { toast(`Upload failed: ${e.message}`, 'error'); }
    finally { setBusy(false); }
  }
  async function remove(inputId) {
    try { await api.delete(`/visualise/inputs/${inputId}`); await onChange(); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="card">
      <div className="caption mb-3">References</div>
      {imageSlots.map(slot => {
        const items = (project.inputs || []).filter(i => i.kind === slot.kind);
        return (
          <div key={slot.kind} style={{ marginBottom: 12 }}>
            <div className="row between center" style={{ marginBottom: 6 }}>
              <span className="body-xs text-muted">{slot.label}{slot.required ? ' *' : ''}</span>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setKind(slot.kind); fileRef.current?.click(); }}>⬆ Add</button>
            </div>
            {items.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 6 }}>
                {items.map(i => (
                  <div key={i.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--card-border)', aspectRatio: '1' }}>
                    <img src={i.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => remove(i.id)} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { upload(e.target.files?.[0], kind); e.target.value = ''; }} />
    </div>
  );
}

function GeneratingState({ count }) {
  const msgs = ['Reading your references…', 'Applying the recipe…', 'Painting the details…', `Rendering ${count} variation${count === 1 ? '' : 's'}…`];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(v => (v + 1) % msgs.length), 3000); return () => clearInterval(t); }, []); // eslint-disable-line
  return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
      <div className="strong" style={{ marginTop: 18 }}>{msgs[i]}</div>
      <div className="body-xs text-subtle" style={{ marginTop: 6 }}>This usually takes 20–40 seconds.</div>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="field"><label className="field-label">{label}</label>{children}</div>;
}
