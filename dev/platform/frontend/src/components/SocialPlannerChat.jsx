import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { primaryBtn, secondaryBtn } from '../styles/theme';

// Conversational social post planner. Pattern matches ReportTemplateChat:
// chat on the left, live plan preview on the right, lock & save when ready.
// Locked plans persist server-side and can be downloaded as PDF / Word.

export default function SocialPlannerChat({ clientId, clientName, planId, onClose, onSaved }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [proposed, setProposed] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [planRowId, setPlanRowId] = useState(planId || null);
  const [attachment, setAttachment] = useState(null);
  const [schedule, setSchedule] = useState({ scheduled_at: '', drive_folder_url: '', target_platforms: [] });
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [driveFiles, setDriveFiles] = useState(null);
  const [checkingDrive, setCheckingDrive] = useState(false);
  const [captionPreview, setCaptionPreview] = useState(null);
  const [previewingCaptions, setPreviewingCaptions] = useState(false);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!planId) return;
    api.get(`/social/clients/${clientId}/plans/${planId}`)
      .then(r => {
        setSaved(r.plan);
        setProposed(r.plan);
        // Pre-fill the autopilot fields from the row so the form
        // shows existing schedule when the plan is reopened.
        setSchedule({
          scheduled_at: r.scheduled_at ? new Date(r.scheduled_at).toISOString().slice(0, 16) : '',
          drive_folder_url: r.drive_folder_url || '',
          target_platforms: r.target_platforms || [],
        });
        setScheduleDirty(false);
      })
      .catch(e => setError(e.message));
  }, [clientId, planId]);

  function togglePlatform(p) {
    setSchedule(s => {
      const has = s.target_platforms.includes(p);
      return { ...s, target_platforms: has ? s.target_platforms.filter(x => x !== p) : [...s.target_platforms, p] };
    });
    setScheduleDirty(true);
  }

  async function checkDrive() {
    if (!planRowId) return;
    setCheckingDrive(true);
    try {
      const r = await api.get(`/social/clients/${clientId}/plans/${planRowId}/drive-files`);
      setDriveFiles(r.files || []);
    } catch (e) {
      setError(e.message);
      setDriveFiles([]);
    } finally {
      setCheckingDrive(false);
    }
  }

  async function previewCaptions() {
    if (!planRowId) return;
    setPreviewingCaptions(true);
    try {
      const r = await api.post(`/social/clients/${clientId}/plans/${planRowId}/preview-captions`, {});
      setCaptionPreview(r.captions || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewingCaptions(false);
    }
  }

  async function saveSchedule() {
    if (!planRowId) return;
    setSavingSchedule(true);
    try {
      await api.patch(`/social/clients/${clientId}/plans/${planRowId}/schedule`, {
        scheduled_at: schedule.scheduled_at ? new Date(schedule.scheduled_at).toISOString() : null,
        drive_folder_url: schedule.drive_folder_url || null,
        target_platforms: schedule.target_platforms,
      });
      setScheduleDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSchedule(false);
    }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, proposed]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    const text = input.trim();
    if (!text && !attachment) return;
    if (sending) return;
    const displayContent = attachment
      ? (text ? `${text}\n\n[attached: ${attachment.name}]` : `[attached: ${attachment.name}]`)
      : text;
    const next = [...history, { role: 'user', content: displayContent }];
    setHistory(next);
    setInput('');
    const sentAttachment = attachment;
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setSending(true);
    setError(null);
    try {
      let result;
      if (sentAttachment) {
        const form = new FormData();
        form.append('history', JSON.stringify(next));
        form.append('current_plan', JSON.stringify(proposed || saved || null));
        form.append('attachment', sentAttachment);
        result = await api.postForm(`/social/clients/${clientId}/plans/chat`, form);
      } else {
        result = await api.post(`/social/clients/${clientId}/plans/chat`, {
          history: next,
          current_plan: proposed || saved || null,
        });
      }
      const { reply, proposed: p } = result;
      setHistory([...next, { role: 'assistant', content: reply || '(no reply)' }]);
      if (p) setProposed(p);
    } catch (e) {
      setError(e.message);
      setHistory(next.slice(0, -1));
      setInput(text);
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
      setSending(false);
    }
  }

  function onFilePicked(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!ok.includes(f.type)) {
      setError(`Unsupported file: ${f.type || 'unknown'}. Attach a PDF or image.`);
      e.target.value = '';
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError('File too large (max 25MB).');
      e.target.value = '';
      return;
    }
    setError(null);
    setAttachment(f);
  }

  async function lockAndSave() {
    if (!proposed) return;
    setSaving(true);
    setError(null);
    try {
      let row;
      if (planRowId) {
        row = await api.put(`/social/clients/${clientId}/plans/${planRowId}`, {
          title: proposed.title,
          plan: proposed,
        });
      } else {
        row = await api.post(`/social/clients/${clientId}/plans`, {
          title: proposed.title,
          plan: proposed,
        });
        setPlanRowId(row.id);
      }
      setSaved(proposed);
      onSaved?.(row);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadPlan(format) {
    if (!planRowId) return;
    try {
      const res = await api.raw(`/social/clients/${clientId}/plans/${planRowId}/export.${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `social-plan.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Download failed: ${e.message}`);
    }
  }

  const proposedDiffers = proposed && JSON.stringify(proposed) !== JSON.stringify(saved);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={styles.modal}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            Social post plan — {clientName}
          </h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>×</button>
        </div>
        <p style={styles.hint}>
          Describe the post idea (platform, audience, angle). Claude proposes a structured plan with scenes, equipment, captions and approval gates. Iterate, then lock to save and download.
        </p>

        <div style={styles.split}>
          <div style={styles.chatPane}>
            <div style={styles.history} ref={scrollRef}>
              {!history.length && (
                <div style={styles.kicker}>
                  Examples:
                  <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12 }}>
                    <li>"60-second Reel about our new Quiet Luxury collection — Instagram + TikTok. Audience: design-led 35-50s."</li>
                    <li>"3-post carousel for LinkedIn explaining our attribution methodology."</li>
                    <li>"Talking-head Story showing behind-the-scenes of yesterday's shoot."</li>
                  </ul>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} style={m.role === 'user' ? styles.userMsg : styles.assistantMsg}>
                  <div style={styles.msgRole}>{m.role === 'user' ? 'You' : 'Claude'}</div>
                  <div style={styles.msgBody}>{m.content}</div>
                </div>
              ))}
              {sending && <div style={styles.assistantMsg}><div style={styles.msgRole}>Claude</div><div style={styles.msgBody}>Thinking…</div></div>}
            </div>
            {attachment && (
              <div style={styles.attachChip}>
                <span style={{ fontSize: 12 }}>📎 {attachment.name} <span style={{ color: '#888' }}>({Math.round(attachment.size / 1024)}KB)</span></span>
                <button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={styles.chipRemove} title="Remove attachment">×</button>
              </div>
            )}
            <div style={styles.inputRow}>
              <textarea
                style={styles.textarea}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={attachment ? 'Optional — describe how to use the file, or just send' : (history.length ? 'Describe a change, or ⌘↩ to send' : 'Describe the post — platform, audience, angle. ⌘↩ to send.')}
                disabled={sending}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  onChange={onFilePicked}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || !!attachment}
                  style={styles.attachBtn}
                  title="Attach an example post / brand guidelines (PDF or image)"
                >📎</button>
                <button type="button" onClick={send} disabled={(!input.trim() && !attachment) || sending} style={primaryBtn}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ ...styles.previewPane, position: 'relative' }}>
            <div style={styles.previewTitle}>
              {sending ? 'Drafting…' : proposed ? (proposedDiffers ? 'Draft — not yet locked' : 'Locked plan') : 'No draft yet'}
            </div>
            {proposed ? (
              <PlanPreview plan={proposed} />
            ) : (
              <div style={{ fontSize: 12, color: '#888' }}>
                {saved ? 'A plan is locked. Ask Claude to change it.' : 'Tell Claude about the post.'}
              </div>
            )}
          </div>
        </div>

        {/* Autopilot — only meaningful after the plan is locked. The
            scheduler picks the plan up at scheduled_at, reads the
            Drive folder, generates per-platform captions and posts to
            every channel in target_platforms. Phase 1 stores the
            config; publishing arrives in Phase 2-4. */}
        {planRowId && saved && (
          <div style={styles.autopilot}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={styles.sectionLabel}>AUTOPILOT</div>
              {scheduleDirty && (
                <button type="button" onClick={saveSchedule} disabled={savingSchedule} style={styles.smallBtn}>
                  {savingSchedule ? 'Saving…' : 'Save schedule'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 1 auto' }}>
                <span style={{ fontSize: 11, color: '#666' }}>Publish at</span>
                <input
                  type="datetime-local"
                  value={schedule.scheduled_at}
                  onChange={e => { setSchedule(s => ({ ...s, scheduled_at: e.target.value })); setScheduleDirty(true); }}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 3 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 240px' }}>
                <span style={{ fontSize: 11, color: '#666' }}>Google Drive folder (where you'll drop the final media)</span>
                <input
                  type="url"
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={schedule.drive_folder_url}
                  onChange={e => { setSchedule(s => ({ ...s, drive_folder_url: e.target.value })); setScheduleDirty(true); }}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 3 }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {['instagram', 'facebook', 'linkedin'].map(p => (
                <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                  <input type="checkbox" checked={schedule.target_platforms.includes(p)} onChange={() => togglePlatform(p)} /> {p}
                </label>
              ))}
            </div>
            {schedule.scheduled_at && schedule.target_platforms.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
                Will publish to {schedule.target_platforms.join(', ')} on {new Date(schedule.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
              </div>
            )}
            {/* Drive folder check + caption preview — visible once the
                AM has saved a folder URL + platforms, lets them sanity
                check before the schedule fires. */}
            {!scheduleDirty && schedule.drive_folder_url && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={checkDrive} disabled={checkingDrive} style={styles.smallBtn}>
                  {checkingDrive ? 'Checking…' : '📁 Check Drive folder'}
                </button>
                {driveFiles !== null && (
                  <div style={{ marginTop: 6, fontSize: 11, color: driveFiles.length ? '#2e7d32' : '#c62828' }}>
                    {driveFiles.length === 0
                      ? 'No video / image files found yet. Drop the final media into the folder and re-check.'
                      : `${driveFiles.length} file${driveFiles.length === 1 ? '' : 's'} found: ${driveFiles.slice(0, 5).map(f => f.name).join(', ')}${driveFiles.length > 5 ? '…' : ''}`}
                  </div>
                )}
              </div>
            )}
            {!scheduleDirty && schedule.target_platforms.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={previewCaptions} disabled={previewingCaptions} style={styles.smallBtn}>
                  {previewingCaptions ? 'Generating…' : '✍ Preview captions'}
                </button>
                {captionPreview && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(captionPreview).map(([platform, text]) => (
                      <div key={platform} style={{ padding: '8px 10px', background: 'white', border: '1px solid #eee', borderRadius: 3, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>{platform}</div>
                        {text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Close</button>
          {planRowId && saved && !proposedDiffers && (
            <>
              <button type="button" onClick={() => downloadPlan('pdf')} style={secondaryBtn}>↓ PDF</button>
              <button type="button" onClick={() => downloadPlan('docx')} style={secondaryBtn}>↓ Word</button>
            </>
          )}
          <button
            type="button"
            onClick={lockAndSave}
            disabled={!proposed || !proposedDiffers || saving || sending}
            style={primaryBtn}
          >
            {saving ? 'Saving…' : planRowId ? 'Save changes' : 'Lock & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanPreview({ plan }) {
  if (!plan) return null;
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{plan.title || '(untitled)'}</div>
      {plan.platforms?.length > 0 && (
        <div style={{ color: '#666', marginBottom: 6 }}>
          {plan.platforms.join(', ')}
          {plan.duration_seconds ? ` · ${plan.duration_seconds}s` : ''}
        </div>
      )}
      {plan.framework && (
        <div style={{ marginBottom: 8 }}>
          <span style={styles.tag}>{plan.framework}</span>
          {plan.framework_rationale && <span style={{ color: '#888', marginLeft: 6 }}>{plan.framework_rationale}</span>}
        </div>
      )}
      {plan.hook?.text && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>HOOK</div>
          <div style={{ fontWeight: 600 }}>{plan.hook.text}</div>
          {plan.hook.rationale && <div style={{ color: '#888', marginTop: 2 }}>{plan.hook.rationale}</div>}
        </div>
      )}
      {plan.scenes?.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>SCENES</div>
          {plan.scenes.map(s => (
            <div key={s.number} style={styles.sceneCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Scene {s.number}{s.style_code ? ` [${s.style_code}]` : ''} — {s.name}</strong>
                <span style={{ color: '#888' }}>{s.duration_seconds ? `${s.duration_seconds}s` : ''}</span>
              </div>
              {s.shot && <div style={{ marginTop: 3 }}>{s.shot}</div>}
              {s.bullets?.length > 0 && (
                <ul style={{ margin: '3px 0 0 16px', padding: 0 }}>
                  {s.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
              {s.b_roll?.length > 0 && (
                <div style={{ marginTop: 3, color: '#666' }}>B-roll: {s.b_roll.join(', ')}</div>
              )}
              {s.on_screen_text?.length > 0 && (
                <div style={{ marginTop: 3, color: '#666' }}>
                  Text: {s.on_screen_text.map((t, i) => <span key={i}>"{t.text}"{i < s.on_screen_text.length - 1 ? ', ' : ''}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {plan.cta && <div style={styles.section}><div style={styles.sectionLabel}>CTA</div>{plan.cta}</div>}
      {plan.caption && <div style={styles.section}><div style={styles.sectionLabel}>CAPTION</div>{plan.caption}</div>}
      {plan.hashtags?.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>HASHTAGS</div>
          {plan.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ')}
        </div>
      )}
      {plan.equipment && (plan.equipment.minimum?.length || plan.equipment.ideal?.length) && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>EQUIPMENT</div>
          {plan.equipment.minimum?.length > 0 && (
            <div>Min: {plan.equipment.minimum.join(', ')}</div>
          )}
          {plan.equipment.ideal?.length > 0 && (
            <div>Ideal: {plan.equipment.ideal.join(', ')}</div>
          )}
        </div>
      )}
      {plan.talent && <div style={styles.section}><div style={styles.sectionLabel}>TALENT</div>{plan.talent}</div>}
      {plan.music && (plan.music.mood || plan.music.suggestions?.length) && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>MUSIC</div>
          {plan.music.mood && <span>{plan.music.mood}</span>}
          {plan.music.tempo && <span> · {plan.music.tempo}</span>}
          {plan.music.suggestions?.length > 0 && (
            <div style={{ color: '#666', marginTop: 2 }}>{plan.music.suggestions.join(' / ')}</div>
          )}
        </div>
      )}
      {plan.reuse_plan?.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>REUSE</div>
          {plan.reuse_plan.map((r, i) => (
            <div key={i}>{r.platform}{r.duration_seconds ? ` (${r.duration_seconds}s)` : ''}{r.notes ? ` — ${r.notes}` : ''}</div>
          ))}
        </div>
      )}
      {plan.approval_gates?.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>APPROVALS</div>
          {plan.approval_gates.map((g, i) => (
            <div key={i}>{g.gate} — {g.owner || '—'}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 1080, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 60px)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  hint: { fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.5 },
  split: { display: 'flex', gap: 16, flex: 1, minHeight: 0 },
  chatPane: { flex: 1.2, display: 'flex', flexDirection: 'column', minHeight: 0 },
  previewPane: { flex: 1, padding: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 4, overflowY: 'auto', maxHeight: '60vh' },
  previewTitle: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  history: { flex: 1, border: '1px solid #eee', borderRadius: 4, padding: 10, overflowY: 'auto', minHeight: 220, maxHeight: '50vh', background: '#fff' },
  kicker: { fontSize: 13, color: '#666', padding: 4 },
  userMsg: { marginBottom: 10, padding: '6px 10px', background: '#fff7d6', borderRadius: 4 },
  assistantMsg: { marginBottom: 10, padding: '6px 10px', background: '#f4f4f4', borderRadius: 4 },
  msgRole: { fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 2 },
  msgBody: { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  inputRow: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' },
  textarea: { flex: 1, minHeight: 60, maxHeight: 200, padding: '8px 10px', fontSize: 13, lineHeight: 1.5, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  attachChip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#eef4ff', border: '1px solid #c7d8f5', borderRadius: 4, marginTop: 8, alignSelf: 'flex-start' },
  chipRemove: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666', lineHeight: 1, padding: '0 2px' },
  attachBtn: { padding: '6px 10px', fontSize: 14, background: '#fff', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' },
  error: { color: '#c62828', fontSize: 12, marginTop: 10, padding: 8, background: '#fdecea', borderRadius: 4 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, borderTop: '1px solid #eee', paddingTop: 12 },
  tag: { display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 6px', background: '#E7CD41', color: '#000', borderRadius: 3, textTransform: 'uppercase' },
  section: { marginTop: 10 },
  sectionLabel: { fontSize: 10, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  sceneCard: { marginTop: 6, padding: '6px 8px', background: '#fff', border: '1px solid #eee', borderRadius: 3 },
  autopilot: { marginTop: 14, padding: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 },
  smallBtn: { fontSize: 11, padding: '3px 8px', background: 'white', border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer' },
};
