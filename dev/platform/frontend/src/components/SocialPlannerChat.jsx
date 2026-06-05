import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

// Conversational social post planner. Pattern matches ReportTemplateChat:
// chat on the left, live plan preview on the right, lock & save when ready.
// Locked plans persist server-side and can be downloaded as PDF / Word.

export default function SocialPlannerChat({ clientId, clientName, planId, seedHook, onClose, onSaved }) {
  const [history, setHistory] = useState([]);
  // When seeded from the Hook Vault, drop the hook into the input box
  // so the AM can extend it before sending (or just hit send to let
  // Claude work from the hook as the opening directive).
  const [input, setInput] = useState(seedHook ? `Plan a new post that opens with this hook:\n\n"${seedHook}"\n\nWork the angle from there.` : '');
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
  const [publications, setPublications] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishTargets, setPublishTargets] = useState(null);
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

  async function publishNow() {
    if (!planRowId) return;
    if (!confirm('Publish to the selected platforms now? This pushes live posts to Instagram / Facebook — there is no undo from the platform side.')) return;
    setPublishing(true);
    try {
      const r = await api.post(`/social/clients/${clientId}/plans/${planRowId}/publish-now`, {});
      setPublications(r.publications || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function refreshPublications() {
    if (!planRowId) return;
    try {
      const r = await api.get(`/social/clients/${clientId}/plans/${planRowId}/publications`);
      setPublications(r || []);
    } catch (e) {
      // Non-fatal — empty status panel is fine.
    }
  }

  useEffect(() => { if (planRowId) refreshPublications(); /* eslint-disable-next-line */ }, [planRowId]);

  // Resolve the IG / FB Page / LinkedIn handles the publisher will use,
  // so the AM can sanity-check they're posting to the right account
  // before they hit Publish. Only fetched once the AM has picked a
  // platform — no point asking before then.
  useEffect(() => {
    if (!planRowId || !schedule.target_platforms.length) { setPublishTargets(null); return; }
    api.get(`/social/clients/${clientId}/plans/${planRowId}/publish-targets`)
      .then(setPublishTargets)
      .catch(() => setPublishTargets(null));
  }, [clientId, planRowId, schedule.target_platforms.join(',')]);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="modal">
        <div className="modal-head">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            Social post plan — {clientName}
          </h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>
        <p className="body-sm text-muted">
          Describe the post idea (platform, audience, angle). Claude proposes a structured plan with scenes, equipment, captions and approval gates. Iterate, then lock to save and download.
        </p>

        <div className="row" style={{ gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1.2, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="card" style={{ flex: 1, padding: 10, overflowY: "auto", minHeight: 220, maxHeight: "50vh" }} ref={scrollRef}>
              {!history.length && (
                <div className="body-sm text-muted">
                  Examples:
                  <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12 }}>
                    <li>"60-second Reel about our new Quiet Luxury collection — Instagram + TikTok. Audience: design-led 35-50s."</li>
                    <li>"3-post carousel for LinkedIn explaining our attribution methodology."</li>
                    <li>"Talking-head Story showing behind-the-scenes of yesterday's shoot."</li>
                  </ul>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} className={`chat-bubble ${m.role === "user" ? "user" : "assistant"}`} style={{ marginBottom: 10 }}>
                  <div className="caption mb-2" style={{ fontSize: 10 }}>{m.role === 'user' ? 'You' : 'Claude'}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ))}
              {sending && <div className="chat-bubble assistant" style={{ marginBottom: 10 }}><div className="caption mb-2" style={{ fontSize: 10 }}>Claude</div><div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>Thinking…</div></div>}
            </div>
            {attachment && (
              <div className="chip chip-accent" style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12 }}>📎 {attachment.name} <span style={{ color: 'var(--text-subtle)' }}>({Math.round(attachment.size / 1024)}KB)</span></span>
                <button type="button" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="btn-ghost" style={{ fontSize: 16, padding: "0 2px" }} title="Remove attachment">×</button>
              </div>
            )}
            <div className="chat-input-row">
              <textarea
                className="textarea"
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
                  className="btn btn-secondary btn-sm"
                  title="Attach an example post / brand guidelines (PDF or image)"
                >📎</button>
                <button type="button" onClick={send} disabled={(!input.trim() && !attachment) || sending} className="btn btn-primary">
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: 1, padding: 12, overflowY: "auto", maxHeight: "60vh", position: "relative" }}>
            <div className="caption mb-2">
              {sending ? 'Drafting…' : proposed ? (proposedDiffers ? 'Draft — not yet locked' : 'Locked plan') : 'No draft yet'}
            </div>
            {proposed ? (
              <PlanPreview plan={proposed} />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
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
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="caption mb-2">AUTOPILOT</div>
              {scheduleDirty && (
                <button type="button" onClick={saveSchedule} disabled={savingSchedule} className="btn btn-secondary btn-sm">
                  {savingSchedule ? 'Saving…' : 'Save schedule'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 1 auto' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Publish at</span>
                <input
                  type="datetime-local"
                  value={schedule.scheduled_at}
                  onChange={e => { setSchedule(s => ({ ...s, scheduled_at: e.target.value })); setScheduleDirty(true); }}
                  style={{ padding: '4px 8px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 3 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 240px' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Google Drive folder (where you'll drop the final media)</span>
                <input
                  type="url"
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={schedule.drive_folder_url}
                  onChange={e => { setSchedule(s => ({ ...s, drive_folder_url: e.target.value })); setScheduleDirty(true); }}
                  style={{ padding: '4px 8px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 3 }}
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
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Will publish to {schedule.target_platforms.join(', ')} on {new Date(schedule.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
              </div>
            )}
            {publishTargets && schedule.target_platforms.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {schedule.target_platforms.map(p => {
                  const t = publishTargets[p];
                  if (!t) return null;
                  return (
                    <div key={p} style={{ color: t.ok ? 'var(--positive)' : 'var(--negative)' }}>
                      <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{p}:</span> {t.ok ? `posts as ${t.label}` : t.label}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Drive folder check + caption preview — visible once the
                AM has saved a folder URL + platforms, lets them sanity
                check before the schedule fires. */}
            {!scheduleDirty && schedule.drive_folder_url && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={checkDrive} disabled={checkingDrive} className="btn btn-secondary btn-sm">
                  {checkingDrive ? 'Checking…' : '📁 Check Drive folder'}
                </button>
                {driveFiles !== null && (
                  <div style={{ marginTop: 6, fontSize: 11 }}>
                    {driveFiles.length === 0 ? (
                      <div style={{ color: 'var(--negative)' }}>No video / image files found yet. Drop the final media into the folder and re-check.</div>
                    ) : (
                      <>
                        <div style={{ color: 'var(--positive)', marginBottom: 4 }}>
                          {driveFiles.length} file{driveFiles.length === 1 ? '' : 's'} found.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {driveFiles.slice(0, 8).map(f => (
                            <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                              <span style={{ color: 'var(--text-muted)' }}>{f.name}</span>
                              {f.aspect_ratio && (
                                <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>
                                  {f.width}×{f.height}
                                  {f.duration_ms ? ` · ${Math.round(f.duration_ms / 1000)}s` : ''}
                                </span>
                              )}
                              {f.warnings?.length > 0 && (
                                <span style={{ color: 'var(--warning)', fontSize: 10 }} title={f.warnings.join(' · ')}>⚠</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {/* Surface the warnings inline below so the AM
                            sees them without having to hover the ⚠. */}
                        {driveFiles.some(f => f.warnings?.length > 0) && (
                          <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--warning-soft)', border: '1px solid #ffe0a3', borderRadius: 3 }}>
                            {driveFiles.filter(f => f.warnings?.length > 0).slice(0, 5).map(f => (
                              <div key={f.id} style={{ color: '#7c5800', fontSize: 11 }}>
                                <b>{f.name}</b>: {f.warnings.join(' · ')}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {!scheduleDirty && schedule.target_platforms.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={previewCaptions} disabled={previewingCaptions} className="btn btn-secondary btn-sm">
                  {previewingCaptions ? 'Generating…' : '✍ Preview captions'}
                </button>
                {captionPreview && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(captionPreview).map(([platform, text]) => (
                      <div key={platform} style={{ padding: '8px 10px', background: 'white', border: '2px solid var(--accent)', borderRadius: 3, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{platform}</div>
                        {text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Phase 3 — manual publish + live publication status. Once
                the AM is happy with Drive + captions they can either wait
                for the scheduler cron or kick it off now. Status rows
                show each platform's outcome with the live post URL. */}
            {!scheduleDirty && schedule.target_platforms.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #eee' }}>
                <button type="button" onClick={publishNow} disabled={publishing} className="btn btn-primary btn-sm">
                  {publishing ? 'Publishing…' : '🚀 Publish now'}
                </button>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-subtle)' }}>
                  Or wait — the scheduler will pick this up at the time above.
                </span>
                {publications && publications.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {publications.map(pub => (
                      <div key={pub.platform} style={{ padding: '6px 10px', background: 'white', border: '2px solid var(--accent)', borderRadius: 3, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, textTransform: 'capitalize', minWidth: 80 }}>{pub.platform}</span>
                        <span style={{ color: pub.status === 'posted' ? 'var(--positive)' : pub.status === 'failed' ? 'var(--negative)' : 'var(--text-muted)' }}>
                          {pub.status === 'posted' ? '✓ posted' : pub.status === 'failed' ? '✗ failed' : pub.status}
                        </span>
                        {pub.posted_url && <a href={pub.posted_url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: '#1976d2' }}>view →</a>}
                        {pub.error_message && <span style={{ color: 'var(--negative)', fontSize: 11, marginLeft: 'auto' }}>{pub.error_message}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <div className="callout callout-danger">{error}</div>}

        <div className="row end">
          <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
          {planRowId && saved && !proposedDiffers && (
            <>
              <button type="button" onClick={() => downloadPlan('pdf')} className="btn btn-secondary">↓ PDF</button>
              <button type="button" onClick={() => downloadPlan('docx')} className="btn btn-secondary">↓ Word</button>
            </>
          )}
          <button
            type="button"
            onClick={lockAndSave}
            disabled={!proposed || !proposedDiffers || saving || sending}
            className="btn btn-primary"
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
        <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
          {plan.platforms.join(', ')}
          {plan.duration_seconds ? ` · ${plan.duration_seconds}s` : ''}
        </div>
      )}
      {plan.framework && (
        <div style={{ marginBottom: 8 }}>
          <span className="chip chip-accent" style={{ fontSize: 10 }}>{plan.framework}</span>
          {plan.framework_rationale && <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>{plan.framework_rationale}</span>}
        </div>
      )}
      {plan.hook?.text && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">HOOK</div>
          <div style={{ fontWeight: 600 }}>{plan.hook.text}</div>
          {plan.hook.rationale && <div style={{ color: 'var(--text-subtle)', marginTop: 2 }}>{plan.hook.rationale}</div>}
        </div>
      )}
      {plan.scenes?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">SCENES</div>
          {plan.scenes.map(s => (
            <div key={s.number} className="card" style={{ padding: "6px 8px", marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Scene {s.number}{s.style_code ? ` [${s.style_code}]` : ''} — {s.name}</strong>
                <span style={{ color: 'var(--text-subtle)' }}>{s.duration_seconds ? `${s.duration_seconds}s` : ''}</span>
              </div>
              {s.shot && <div style={{ marginTop: 3 }}>{s.shot}</div>}
              {s.bullets?.length > 0 && (
                <ul style={{ margin: '3px 0 0 16px', padding: 0 }}>
                  {s.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
              {s.b_roll?.length > 0 && (
                <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>B-roll: {s.b_roll.join(', ')}</div>
              )}
              {s.on_screen_text?.length > 0 && (
                <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                  Text: {s.on_screen_text.map((t, i) => <span key={i}>"{t.text}"{i < s.on_screen_text.length - 1 ? ', ' : ''}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {plan.cta && <div style={{ marginTop: 10 }}><div className="caption mb-2">CTA</div>{plan.cta}</div>}
      {plan.caption && <div style={{ marginTop: 10 }}><div className="caption mb-2">CAPTION</div>{plan.caption}</div>}
      {plan.hashtags?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">HASHTAGS</div>
          {plan.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ')}
        </div>
      )}
      {plan.equipment && (plan.equipment.minimum?.length || plan.equipment.ideal?.length) && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">EQUIPMENT</div>
          {plan.equipment.minimum?.length > 0 && (
            <div>Min: {plan.equipment.minimum.join(', ')}</div>
          )}
          {plan.equipment.ideal?.length > 0 && (
            <div>Ideal: {plan.equipment.ideal.join(', ')}</div>
          )}
        </div>
      )}
      {plan.talent && <div style={{ marginTop: 10 }}><div className="caption mb-2">TALENT</div>{plan.talent}</div>}
      {plan.music && (plan.music.mood || plan.music.suggestions?.length) && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">MUSIC</div>
          {plan.music.mood && <span>{plan.music.mood}</span>}
          {plan.music.tempo && <span> · {plan.music.tempo}</span>}
          {plan.music.suggestions?.length > 0 && (
            <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{plan.music.suggestions.join(' / ')}</div>
          )}
        </div>
      )}
      {plan.reuse_plan?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">REUSE</div>
          {plan.reuse_plan.map((r, i) => (
            <div key={i}>{r.platform}{r.duration_seconds ? ` (${r.duration_seconds}s)` : ''}{r.notes ? ` — ${r.notes}` : ''}</div>
          ))}
        </div>
      )}
      {plan.approval_gates?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="caption mb-2">APPROVALS</div>
          {plan.approval_gates.map((g, i) => (
            <div key={i}>{g.gate} — {g.owner || '—'}</div>
          ))}
        </div>
      )}
    </div>
  );
}

