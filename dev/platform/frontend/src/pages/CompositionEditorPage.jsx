import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Compositor from '../components/video/Compositor';
import CompositionTimeline from '../components/video/CompositionTimeline';
import {
  emptyComposition, addSource, addTrack, addItem, removeItem,
  updateItem, duration as compDuration,
} from '@shared/composition.mjs';
import * as PB from '@shared/compositionPlayback.mjs';
import ReelChecks from '../components/ReelChecks';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const SIZE_PRESETS = [
  { w: 1080, h: 1920, label: '9:16' },
  { w: 1920, h: 1080, label: '16:9' },
  { w: 1080, h: 1080, label: '1:1' },
];

const FPS_OPTIONS = [24, 25, 30, 60];

function initComp() {
  const base = emptyComposition();
  const { comp } = addTrack(base, 'video');
  return comp;
}

export default function CompositionEditorPage({ clientId }) {
  const toast = useToast();
  const [composition, setComposition] = useState(initComp);
  const [sourceUrls, setSourceUrls] = useState({});
  const [sourceNames, setSourceNames] = useState({});
  const [sourceAssets, setSourceAssets] = useState({});
  const [transcripts, setTranscripts] = useState({});
  const [playhead, setPlayhead] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [transcribing, setTranscribing] = useState(null);
  const [compId, setCompId] = useState(null);
  const [captionTemplates, setCaptionTemplates] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const compositorRef = useRef(null);
  const fileRef = useRef(null);

  const total = compDuration(composition);
  const fps = composition.fps || 30;
  const W = composition.size?.width || 1080;
  const H = composition.size?.height || 1920;

  useEffect(() => {
    api.get('/compose/caption-templates').then(setCaptionTemplates).catch(() => {});
  }, []);

  const handleSelect = useCallback((itemId, trackId) => {
    setSelectedId(itemId);
    setSelectedTrackId(trackId);
  }, []);

  const selectedItem = useMemo(() => {
    if (!selectedId) return null;
    for (const track of composition.tracks) {
      const item = track.items.find(i => i.id === selectedId);
      if (item) return { item, track };
    }
    return null;
  }, [selectedId, composition.tracks]);

  const selectedSource = selectedItem
    ? composition.sources[selectedItem.item.source] : null;

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const vids = Array.from(files).filter(f => f.type.startsWith('video/'));
    if (!vids.length) { toast('Please choose video files.', 'error'); return; }

    setUploading(true);
    setUploadProgress(0);

    try {
      const fd = new FormData();
      vids.forEach(f => fd.append('files', f));
      const result = await api.postFormProgress(
        `/clients/${clientId}/assets/upload`, fd,
        (pct) => setUploadProgress(pct),
      );
      const added = result.added || [];
      if (!added.length) { toast('Upload failed.', 'error'); return; }

      setComposition(prev => {
        let comp = prev;
        let trackId = comp.tracks.find(t => t.kind === 'video')?.id;
        if (!trackId) {
          const r = addTrack(comp, 'video');
          comp = r.comp;
          trackId = r.id;
        }

        const newUrls = {};
        const newNames = {};
        const newAssets = {};
        for (const asset of added) {
          const blobFile = vids.find(f => f.name === asset.title);
          const blobUrl = blobFile ? URL.createObjectURL(blobFile) : null;

          const { comp: c2, id: sourceId } = addSource(comp, {
            kind: 'clip', asset: asset.id, url: asset.url, duration: 0,
            width: 0, height: 0, fps: 30,
          });
          comp = c2;

          const end = compDuration(comp);
          const { comp: c3 } = addItem(comp, trackId, {
            at: end, len: 0, source: sourceId,
          });
          comp = c3;

          if (blobUrl) newUrls[sourceId] = blobUrl;
          else if (asset.url) newUrls[sourceId] = asset.url;
          newNames[sourceId] = asset.title || 'Clip';
          newAssets[sourceId] = asset.id;
        }
        setSourceUrls(u => ({ ...u, ...newUrls }));
        setSourceNames(n => ({ ...n, ...newNames }));
        setSourceAssets(a => ({ ...a, ...newAssets }));
        return comp;
      });

      toast(`${added.length} clip${added.length > 1 ? 's' : ''} added.`, 'success');
    } catch (err) {
      toast(err.message || 'Upload failed.', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [clientId, toast]);

  const onFileChange = useCallback((e) => {
    handleFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }, [handleFiles]);

  const onMeta = useCallback(({ sourceId, duration: dur, width, height }) => {
    if (!sourceId || !dur) return;
    setComposition(prev => {
      let comp = {
        ...prev,
        sources: {
          ...prev.sources,
          [sourceId]: { ...prev.sources[sourceId], duration: dur, width, height },
        },
      };
      for (const track of comp.tracks) {
        for (const item of track.items) {
          if (item.source === sourceId && item.len === 0) {
            comp = updateItem(comp, track.id, item.id, { len: dur });
          }
        }
      }
      return comp;
    });
  }, []);

  const handleRemoveItem = useCallback(() => {
    if (!selectedItem) return;
    setComposition(prev => removeItem(prev, selectedItem.track.id, selectedItem.item.id));
    setSelectedId(null);
    setSelectedTrackId(null);
  }, [selectedItem]);

  const setSize = useCallback((w, h) => {
    setComposition(prev => ({ ...prev, size: { width: w, height: h } }));
  }, []);

  const setFps = useCallback((f) => {
    setComposition(prev => ({ ...prev, fps: f }));
  }, []);

  // ── Save / load ─────────────────────────────────────────────────────

  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (compId) {
        await api.put(`/compose/compositions/${compId}`, {
          data: composition, sourceAssets, transcripts,
        });
      } else {
        const row = await api.post(`/compose/clients/${clientId}/compositions`, {
          title: 'Untitled', data: composition,
        });
        setCompId(row.id);
        await api.put(`/compose/compositions/${row.id}`, { sourceAssets, transcripts });
      }
      toast('Saved.', 'success');
    } catch (err) {
      toast(err.message || 'Save failed.', 'error');
    } finally { setSaving(false); }
  }, [compId, composition, sourceAssets, transcripts, clientId, toast]);

  // ── Transcribe ──────────────────────────────────────────────────────

  const transcribeSource = useCallback(async (sourceId) => {
    if (!compId) {
      toast('Save the composition first.', 'error');
      return;
    }
    const assetId = sourceAssets[sourceId];
    if (!assetId) {
      toast('This clip has no uploaded asset yet.', 'error');
      return;
    }
    setTranscribing(sourceId);
    try {
      const result = await api.post(`/compose/compositions/${compId}/transcribe`, { sourceId });
      setTranscripts(prev => ({ ...prev, [sourceId]: result.words }));
      toast(`Transcribed: ${result.words.length} words.`, 'success');
    } catch (err) {
      toast(err.message || 'Transcription failed.', 'error');
    } finally { setTranscribing(null); }
  }, [compId, sourceAssets, toast]);

  // ── Add captions ────────────────────────────────────────────────────

  const addCaptions = useCallback((sourceId, templateId) => {
    const words = transcripts[sourceId];
    if (!words?.length) { toast('Transcribe the clip first.', 'error'); return; }
    const src = composition.sources[sourceId];
    if (!src) return;

    setComposition(prev => {
      const { comp: c1, id: captionSourceId } = addSource(prev, {
        kind: 'captions', transcript: words, template: templateId,
        marginV: 60,
      });
      let comp = c1;

      let audioTrackId = comp.tracks.find(t => t.kind === 'audio')?.id;
      if (!audioTrackId) {
        const r = addTrack(comp, 'audio');
        comp = r.comp;
        audioTrackId = r.id;
      }

      for (const track of comp.tracks) {
        for (const item of track.items) {
          if (item.source === sourceId) {
            const { comp: c2 } = addItem(comp, audioTrackId, {
              at: item.at, len: item.len, source: captionSourceId,
              in: item.in || 0,
            });
            comp = c2;
          }
        }
      }
      return comp;
    });
    toast('Captions added to timeline.', 'success');
  }, [transcripts, composition, toast]);

  const hasSources = Object.keys(composition.sources).length > 0;
  const selectedSourceId = selectedItem?.item?.source;
  const hasTranscript = selectedSourceId && transcripts[selectedSourceId]?.length > 0;

  // ── Reel checks: combine all transcripts into timeline-mapped timings ──

  const allTimings = useMemo(() => {
    const words = [];
    for (const [sourceId, wList] of Object.entries(transcripts)) {
      if (!Array.isArray(wList)) continue;
      for (const track of composition.tracks) {
        for (const item of track.items) {
          if (item.source !== sourceId) continue;
          const inPt = item.in || 0;
          for (const w of wList) {
            if (w.start >= inPt && w.start < inPt + item.len) {
              words.push({
                word: w.word,
                start: item.at + (w.start - inPt),
                end: item.at + (w.end - inPt),
              });
            }
          }
        }
      }
    }
    words.sort((a, b) => a.start - b.start);
    return words;
  }, [transcripts, composition.tracks]);

  const hasCaptionSource = Object.values(composition.sources).some(s => s.kind === 'captions');

  const reelEdit = useMemo(() => ({
    duration_s: total,
    caption_template: hasCaptionSource ? 'yes' : null,
  }), [total, hasCaptionSource]);

  // ── Drag-and-drop ──────────────────────────────────────────────────

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div style={{ marginTop: 'var(--s4)' }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="edit-split" style={{ marginTop: 'var(--s4)' }}>
        <div>
          <Compositor
            ref={compositorRef}
            composition={composition}
            sourceUrls={sourceUrls}
            playhead={playhead}
            onSeek={setPlayhead}
            onMeta={onMeta}
            maxHeight="50vh"
          />
          <div style={{ marginTop: 'var(--s3)' }}>
            <CompositionTimeline
              composition={composition}
              sourceNames={sourceNames}
              onChange={setComposition}
              sourceUrls={sourceUrls}
              playhead={playhead}
              onSeek={setPlayhead}
              selectedId={selectedId}
              selectedTrackId={selectedTrackId}
              onSelect={handleSelect}
            />
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 'var(--s4)' }}>
            <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
              <h3 className="title">Editor</h3>
              <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={save} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Add clip */}
            <div style={{ marginBottom: 'var(--s4)' }}>
              <input
                ref={fileRef} type="file" accept="video/*" multiple
                style={{ display: 'none' }} onChange={onFileChange}
              />
              <button type="button" className="btn btn-primary btn-sm"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? `Uploading ${Math.round(uploadProgress * 100)}%` : '+ Add clip'}
              </button>
            </div>

            {!hasSources && (
              <div style={{
                padding: 'var(--s6) var(--s4)', textAlign: 'center',
                color: dragOver ? 'var(--primary)' : 'var(--text-muted)',
                border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--card-border)'}`,
                borderRadius: 'var(--r-md)',
                background: dragOver ? 'var(--surface-sunken)' : 'transparent',
                transition: 'all 150ms ease',
              }}>
                {dragOver ? 'Drop to add clips' : 'Drop clips to begin'}
              </div>
            )}

            {/* Selected item properties */}
            {selectedItem && (
              <div style={{
                marginBottom: 'var(--s4)', padding: 'var(--s3)',
                background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)',
              }}>
                <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s2)' }}>
                  {sourceNames[selectedSourceId] || 'Selected item'}
                </div>
                <table style={{ width: '100%', fontSize: 'var(--fs-caption)' }}>
                  <tbody>
                    <tr>
                      <td className="text-subtle" style={{ paddingRight: 'var(--s2)' }}>At</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {PB.timecode(selectedItem.item.at, fps)}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-subtle" style={{ paddingRight: 'var(--s2)' }}>Length</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {PB.timecode(selectedItem.item.len, fps)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={handleRemoveItem}>
                    Remove
                  </button>

                  {selectedSource?.kind === 'clip' && (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => transcribeSource(selectedSourceId)}
                        disabled={transcribing === selectedSourceId || !compId}>
                        {transcribing === selectedSourceId ? 'Transcribing...'
                          : hasTranscript ? 'Re-transcribe' : 'Transcribe'}
                      </button>

                      {hasTranscript && captionTemplates?.length > 0 && (
                        <select
                          className="btn-chip"
                          style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)' }}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) addCaptions(selectedSourceId, e.target.value);
                            e.target.value = '';
                          }}
                        >
                          <option value="">+ Captions</option>
                          {captionTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>

                {hasTranscript && (
                  <div style={{
                    marginTop: 'var(--s2)', maxHeight: '6rem', overflow: 'auto',
                    fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
                    lineHeight: 1.4,
                  }}>
                    {transcripts[selectedSourceId].map(w => w.word).join(' ')}
                  </div>
                )}
              </div>
            )}

            {/* Composition settings */}
            <div style={{ marginBottom: 'var(--s3)' }}>
              <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>Frame size</div>
              <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                {SIZE_PRESETS.map(p => (
                  <button key={p.label} type="button"
                    className={`btn-chip${W === p.w && H === p.h ? ' is-active' : ''}`}
                    onClick={() => setSize(p.w, p.h)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="body-xs text-muted" style={{ marginTop: 'var(--s1)' }}>
                {W} x {H}
              </div>
            </div>

            <div style={{ marginBottom: 'var(--s3)' }}>
              <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>Frame rate</div>
              <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                {FPS_OPTIONS.map(f => (
                  <button key={f} type="button"
                    className={`btn-chip${fps === f ? ' is-active' : ''}`}
                    onClick={() => setFps(f)}>
                    {f}fps
                  </button>
                ))}
              </div>
            </div>

            {hasSources && (
              <div className="body-xs text-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {PB.timecode(total, fps)} total
                {` · ${Object.keys(composition.sources).length} source${Object.keys(composition.sources).length === 1 ? '' : 's'}`}
                {` · ${composition.tracks.length} track${composition.tracks.length === 1 ? '' : 's'}`}
              </div>
            )}
          </div>

          {/* Reel checks: live advisory panel, runs on transcript data */}
          {hasSources && (
            <div className="card" style={{ padding: 'var(--s4)', marginTop: 'var(--s3)' }}>
              <ReelChecks
                timings={allTimings}
                edit={reelEdit}
                clientId={clientId}
                defaultOpen={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
