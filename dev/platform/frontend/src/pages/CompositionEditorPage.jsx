import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Compositor from '../components/video/Compositor';
import CompositionTimeline from '../components/video/CompositionTimeline';
import {
  emptyComposition, addSource, addTrack, addItem, removeItem,
  updateItem, duration as compDuration,
  rippleRemoveItem, isStillMime, CLIP_ACCEPT,
} from '@shared/composition.mjs';
import {
  MOTION_NAMES, transformFor, describeMotion, STILL_DEFAULT_LEN,
} from '@shared/compositionTemplate.mjs';
import * as PB from '@shared/compositionPlayback.mjs';
import { FX, FX_NAMES, describeFx } from '@shared/compositionFx.mjs';
import ReelChecks from '../components/ReelChecks';
import TightenPanel from '../components/video/TightenPanel';
import BrollPanel from '../components/video/BrollPanel';
import ShortcutReference, { ShortcutButton } from '../components/video/ShortcutReference';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useCompositionHistory } from '../hooks/useCompositionHistory';
import ExportModal from '../components/video/ExportModal';
import ShareReelModal from '../components/video/ShareReelModal';

const SIZE_PRESETS = [
  { w: 1080, h: 1920, label: '9:16' },
  { w: 1920, h: 1080, label: '16:9' },
  { w: 1080, h: 1080, label: '1:1' },
];

function parseTimecode(str, fps) {
  str = str.trim();
  let m = str.match(/^(\d+):(\d+):(\d+):(\d+)$/);
  if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / (fps || 30);
  m = str.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3] + (m[4] ? '.' + m[4] : ''));
  const n = parseFloat(str);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function TimecodeInput({ value, fps, onChange, label }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  function startEdit() {
    setText(PB.timecode(value, fps));
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const parsed = parseTimecode(text, fps);
    if (parsed != null && parsed !== value) onChange(parsed);
  }

  if (editing) {
    return (
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        style={{
          width: 96, padding: '1px 4px', fontSize: 'var(--fs-caption)',
          fontFamily: 'var(--font-mono, monospace)', background: 'var(--surface-sunken)',
          border: '1px solid var(--card-border)', borderRadius: 'var(--r-sm)',
          color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
        }}
      />
    );
  }
  return (
    <span
      onClick={startEdit}
      title={`Click to edit ${label}`}
      style={{
        cursor: 'pointer', padding: '1px 4px', borderRadius: 'var(--r-sm)',
        fontVariantNumeric: 'tabular-nums',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {PB.timecode(value, fps)}
    </span>
  );
}

const FPS_OPTIONS = [24, 25, 30, 60];

const AUTOSAVE_MS = 1500;

function initComp() {
  const base = emptyComposition();
  const { comp } = addTrack(base, 'video');
  return comp;
}

export default function CompositionEditorPage({ clientId, clientName = null, openId = null }) {
  const toast = useToast();
  const {
    state: composition, setState: setComposition,
    undo, redo, canUndo, canRedo, resetHistory,
    startBatch, commitBatch, discardBatch,
  } = useCompositionHistory(initComp());
  const [sourceUrls, setSourceUrls] = useState({});
  const [sourceNames, setSourceNames] = useState({});
  const [sourceAssets, setSourceAssets] = useState({});
  const [transcripts, setTranscripts] = useState({});
  const [playhead, setPlayhead] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(null);
  const [compId, setCompId] = useState(null);
  const [compList, setCompList] = useState(null);
  const [captionTemplates, setCaptionTemplates] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [dragOver, setDragOver] = useState(false);
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [ripple, setRipple] = useState(false);
  const compositorRef = useRef(null);
  const fileRef = useRef(null);
  const audioFileRef = useRef(null);
  const saveTimerRef = useRef(null);
  const latestCompRef = useRef(null);
  const latestAssetsRef = useRef(null);
  const latestTransRef = useRef(null);
  const selectedItemRef = useRef(null);
  const playheadRef = useRef(0);

  const total = compDuration(composition);
  const fps = composition.fps || 30;
  const W = composition.size?.width || 1080;
  const H = composition.size?.height || 1920;

  // Keep refs in sync for the auto-save closure
  latestCompRef.current = composition;
  latestAssetsRef.current = sourceAssets;
  latestTransRef.current = transcripts;
  playheadRef.current = playhead;

  // ── Initialise: load compositions list, templates ─────────────────

  useEffect(() => {
    let live = true;
    async function init() {
      try {
        const [list, templates, designList] = await Promise.all([
          api.get(`/compose/clients/${clientId}/compositions`),
          api.get('/compose/caption-templates').catch(() => []),
          api.get(`/compose/designs/${clientId}`).catch(() => []),
        ]);
        if (!live) return;
        setCaptionTemplates(templates);
        setDesigns(designList);
        setCompList(list);

        // `openId` is a handoff: "Send to Edit" on the Record tab and "Open
        // in editor" on the review sheet both name the composition they mean.
        // Without it the editor opened the first row of its own list, so the
        // review sheet's button landed on whatever was newest rather than on
        // the item the operator had clicked.
        const wanted = openId
          ? list.find((r) => String(r.id) === String(openId))
          : null;
        if (wanted) {
          loadFromRow(wanted);
        } else if (list.length > 0) {
          const row = list[0];
          loadFromRow(row);
        } else {
          const row = await api.post(`/compose/clients/${clientId}/compositions`, {
            title: 'Untitled', data: initComp(),
          });
          if (!live) return;
          setCompId(row.id);
          setCompList([row]);
        }
      } catch (err) {
        if (live) toast('Failed to load compositions.', 'error');
      } finally {
        if (live) setLoading(false);
      }
    }
    init();
    return () => { live = false; };
  }, [clientId, openId]);

  function loadFromRow(row) {
    const data = row.data && typeof row.data === 'object' && row.data.version
      ? row.data : initComp();
    setCompId(row.id);
    resetHistory(data);
    setSourceAssets(row.source_assets || {});
    setTranscripts(row.transcripts || {});
    setPlayhead(0);
    setSelectedId(null);
    setSelectedTrackId(null);

    const urls = {};
    const names = {};
    if (data.sources) {
      for (const [sid, src] of Object.entries(data.sources)) {
        if (src.url) urls[sid] = src.url;
        names[sid] = src.originalName || src.url?.split('/').pop() || 'Clip';
      }
    }
    setSourceUrls(urls);
    setSourceNames(names);
    setSaveStatus('saved');
  }

  // ── Auto-save ─────────────────────────────────────────────────────

  const doSave = useCallback(async (id) => {
    if (!id) return;
    setSaveStatus('saving');
    try {
      await api.put(`/compose/compositions/${id}`, {
        data: latestCompRef.current,
        sourceAssets: latestAssetsRef.current,
        transcripts: latestTransRef.current,
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      doSave(compId);
    }, AUTOSAVE_MS);
  }, [compId, doSave]);

  /**
   * Save now, and cancel the pending autosave.
   *
   * ANYTHING THAT HANDS THE COMPOSITION TO THE BACKEND MUST CALL THIS
   * FIRST. The render route reads `data` out of the database row and takes
   * only format, resolution and quality from the request body: the timeline
   * on screen is never sent. So a render started inside the 1500ms autosave
   * window encodes the PREVIOUS cut and reports success, which is the
   * worst shape of bug this editor can have, because the file looks fine
   * and is of the wrong edit.
   *
   * `doSave` reads `latestCompRef`, so this always writes what is on screen
   * now rather than whatever the pending timer had in mind.
   */
  const flushSave = useCallback(async (id) => {
    if (!id) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await doSave(id);
  }, [doSave]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // Mark unsaved on composition changes (skip during initial load)
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!compId) return;
    scheduleSave();
  }, [composition, sourceAssets, transcripts]);

  // ── Selection ─────────────────────────────────────────────────────

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

  selectedItemRef.current = selectedItem;

  const selectedSource = selectedItem
    ? composition.sources[selectedItem.item.source] : null;

  // ── Clip upload via compose endpoint ──────────────────────────────

  const handleFiles = useCallback(async (files) => {
    if (!files?.length) return;
    // Photographs as well as footage. Everything downstream already handled a
    // still: the model has `src.still` with the `-loop 1` reasoning, the
    // preview knows a photograph carries no audio stream, the render graph
    // bounds the loop with `-t`, and the batch emits a photograph as a clip.
    // This filter and the `accept` attribute were the only two things
    // refusing them, so six photographs could not enter the editor at all
    // while being the headline case of the headline template.
    const wanted = Array.from(files)
      .filter(f => f.type.startsWith('video/') || isStillMime(f.type));
    if (!wanted.length) { toast('Choose video files or photographs.', 'error'); return; }
    if (!compId) { toast('Composition not ready yet.', 'error'); return; }

    setUploading(true);

    try {
      for (const file of wanted) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/compose/compositions/${compId}/clip`, {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText);
        }
        const clip = await res.json();

        const blobUrl = URL.createObjectURL(file);

        setComposition(prev => {
          let comp = prev;
          let trackId = comp.tracks.find(t => t.kind === 'video')?.id;
          if (!trackId) {
            const r = addTrack(comp, 'video');
            comp = r.comp;
            trackId = r.id;
          }

          // `still` comes from the server rather than from the File object,
          // because the server decided which mime types it would store and
          // the two must not disagree: a source marked still that is really
          // footage loses its audio in the render, and footage marked still
          // freezes on its first frame.
          const still = clip.still === true;

          // A photograph has NO duration, and the model is strict about the
          // difference between absent and zero: `duration` may be omitted,
          // and a clip source carrying 0 is rejected outright
          // (composition.mjs: "clip duration must be positive"). So the field
          // is left off rather than set to 0.
          //
          // The same guard covers footage whose probe came back empty, which
          // the old `duration: clip.duration || 0` would have written as 0 —
          // an invalid composition from a corrupt upload, with the failure
          // surfacing later as a refused save rather than at the upload.
          const dur = Number(clip.duration) > 0 ? Number(clip.duration) : null;

          const { comp: c2, id: sourceId } = addSource(comp, {
            kind: 'clip', asset: clip.assetId, url: clip.url,
            ...(still ? { still: true } : {}),
            ...(dur ? { duration: dur } : {}),
            width: clip.width || 0, height: clip.height || 0,
            fps: clip.fps || 30, originalName: clip.originalName,
          });
          comp = c2;

          const end = compDuration(comp);
          // A photograph takes the length the batch already gives a still,
          // rather than a second number chosen here. Footage keeps its own,
          // and falls back to the same figure when its duration is unknown:
          // an item length must be positive, so the alternative is a clip
          // that cannot be placed at all.
          const len = still ? STILL_DEFAULT_LEN : (dur || STILL_DEFAULT_LEN);
          const { comp: c3 } = addItem(comp, trackId, {
            at: end, len, source: sourceId,
          });
          comp = c3;

          setSourceUrls(u => ({ ...u, [sourceId]: blobUrl }));
          setSourceNames(n => ({ ...n, [sourceId]: clip.originalName || (still ? 'Photograph' : 'Clip') }));
          setSourceAssets(a => ({ ...a, [sourceId]: clip.assetId }));
          return comp;
        });
      }

      // Name what actually went in. "6 clips added" after dropping six
      // photographs is the kind of small lie that makes an operator distrust
      // the rest of the screen.
      const shots = wanted.filter(f => isStillMime(f.type)).length;
      const clips = wanted.length - shots;
      const parts = [];
      if (clips) parts.push(`${clips} clip${clips > 1 ? 's' : ''}`);
      if (shots) parts.push(`${shots} photograph${shots > 1 ? 's' : ''}`);
      toast(`${parts.join(' and ')} added.`, 'success');
    } catch (err) {
      toast(err.message || 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  }, [compId, toast]);

  const onFileChange = useCallback((e) => {
    handleFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }, [handleFiles]);

  // ── Audio upload ──────────────────────────────────────────────────

  const handleAudioFiles = useCallback(async (files) => {
    if (!files?.length) return;
    const auds = Array.from(files).filter(f => f.type.startsWith('audio/'));
    if (!auds.length) { toast('Choose audio files.', 'error'); return; }
    if (!compId) { toast('Composition not ready yet.', 'error'); return; }

    setUploadingAudio(true);
    try {
      for (const file of auds) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/compose/compositions/${compId}/audio`, {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText);
        }
        const clip = await res.json();
        const blobUrl = URL.createObjectURL(file);

        setComposition(prev => {
          let comp = prev;
          let audioTrackId = comp.tracks.find(t => t.kind === 'audio')?.id;
          if (!audioTrackId) {
            const r = addTrack(comp, 'audio');
            comp = r.comp;
            audioTrackId = r.id;
          }

          const { comp: c2, id: sourceId } = addSource(comp, {
            kind: 'audio', asset: clip.assetId, url: clip.url,
            duration: clip.duration || 0, originalName: clip.originalName,
          });
          comp = c2;

          const end = compDuration(comp);
          const { comp: c3 } = addItem(comp, audioTrackId, {
            at: 0, len: clip.duration || end || 10, source: sourceId,
          });
          comp = c3;

          setSourceUrls(u => ({ ...u, [sourceId]: blobUrl }));
          setSourceNames(n => ({ ...n, [sourceId]: clip.originalName || 'Audio' }));
          setSourceAssets(a => ({ ...a, [sourceId]: clip.assetId }));
          return comp;
        });
      }
      toast(`${auds.length} audio file${auds.length > 1 ? 's' : ''} added.`, 'success');
    } catch (err) {
      toast(err.message || 'Audio upload failed.', 'error');
    } finally {
      setUploadingAudio(false);
    }
  }, [compId, toast]);

  const onAudioFileChange = useCallback((e) => {
    handleAudioFiles(e.target.files);
    if (audioFileRef.current) audioFileRef.current.value = '';
  }, [handleAudioFiles]);

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
    setComposition(prev => ripple
      ? rippleRemoveItem(prev, selectedItem.track.id, selectedItem.item.id)
      : removeItem(prev, selectedItem.track.id, selectedItem.item.id)
    );
    setSelectedId(null);
    setSelectedTrackId(null);
  }, [selectedItem, ripple]);

  const setSize = useCallback((w, h) => {
    setComposition(prev => ({ ...prev, size: { width: w, height: h } }));
  }, []);

  const setFps = useCallback((f) => {
    setComposition(prev => ({ ...prev, fps: f }));
  }, []);

  // ── Transcribe ────────────────────────────────────────────────────

  const transcribeSource = useCallback(async (sourceId) => {
    if (!compId) { toast('Save the composition first.', 'error'); return; }
    if (!sourceAssets[sourceId]) { toast('No uploaded asset for this clip.', 'error'); return; }

    setTranscribing(sourceId);
    try {
      await doSave(compId);
      const result = await api.post(`/compose/compositions/${compId}/transcribe`, { sourceId });
      setTranscripts(prev => ({ ...prev, [sourceId]: result.words }));
      toast(`Transcribed: ${result.words.length} words.`, 'success');
    } catch (err) {
      toast(err.message || 'Transcription failed.', 'error');
    } finally { setTranscribing(null); }
  }, [compId, sourceAssets, toast, doSave]);

  // ── Add captions ──────────────────────────────────────────────────

  const addCaptions = useCallback((sourceId, templateId) => {
    const words = transcripts[sourceId];
    if (!words?.length) { toast('Transcribe the clip first.', 'error'); return; }

    setComposition(prev => {
      const { comp: c1, id: captionSourceId } = addSource(prev, {
        kind: 'captions', transcript: sourceId, template: templateId,
        marginV: 60,
      });
      let comp = c1;

      let captionTrackId = null;
      for (const t of comp.tracks) {
        if (t.kind === 'video' && t.items.some(i => comp.sources[i.source]?.kind === 'captions')) {
          captionTrackId = t.id;
          break;
        }
      }
      if (!captionTrackId) {
        const r = addTrack(comp, 'video');
        comp = r.comp;
        captionTrackId = r.id;
      }

      for (const track of prev.tracks) {
        for (const item of track.items) {
          if (item.source === sourceId) {
            const { comp: c2 } = addItem(comp, captionTrackId, {
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
  }, [transcripts, toast]);

  // ── Add a finishing effect ────────────────────────────────────────
  //
  // Generated, so there is nothing to upload and nothing to pay for: the
  // render makes it with a filter expression and the preview paints the same
  // mask. It spans the whole composition, because all three of them are
  // finishing passes over a cut rather than something that happens at a
  // moment.

  const addEffect = useCallback((effect) => {
    if (!FX[effect]) return;
    setComposition(prev => {
      const total = compDuration(prev);
      if (!(total > 0)) return prev;

      const { comp: c1, id: sourceId } = addSource(prev, { kind: 'fx', effect });
      let comp = c1;

      // Its own track, above everything that draws a picture. Reusing a
      // track that holds footage would put the effect in that track's own
      // time layout, where a second item on the same track is a transition.
      let fxTrackId = null;
      for (const t of comp.tracks) {
        if (t.kind === 'video' && t.items.length
            && t.items.every(i => comp.sources[i.source]?.kind === 'fx')) {
          fxTrackId = t.id;
          break;
        }
      }
      if (!fxTrackId) {
        const r = addTrack(comp, 'video');
        comp = r.comp;
        fxTrackId = r.id;
      }

      const { comp: c2 } = addItem(comp, fxTrackId, { at: 0, len: total, source: sourceId });
      return c2;
    });
    toast(describeFx(effect), 'success');
  }, [toast]);

  // ── Add design page as graphic ────────────────────────────────────

  const addDesign = useCallback((design, durationSecs = 5) => {
    setComposition(prev => {
      const { comp: c1, id: sourceId } = addSource(prev, {
        kind: 'design',
        project: design.id,
        page: 1,
        alpha: true,
        url: design.url,
        width: design.width || 1080,
        height: design.height || 1080,
      });
      let comp = c1;

      let overlayTrackId = null;
      for (const t of comp.tracks) {
        if (t.kind === 'video') {
          const hasDesignItems = t.items.some(i => comp.sources[i.source]?.kind === 'design');
          const hasCaptionItems = t.items.some(i => comp.sources[i.source]?.kind === 'captions');
          if (hasDesignItems && !hasCaptionItems) {
            overlayTrackId = t.id;
            break;
          }
        }
      }
      if (!overlayTrackId) {
        const r = addTrack(comp, 'video');
        comp = r.comp;
        overlayTrackId = r.id;
      }

      const end = compDuration(comp);
      const at = Math.max(0, playhead);
      const { comp: c2 } = addItem(comp, overlayTrackId, {
        at, len: durationSecs, source: sourceId,
        fit: 'contain', opacity: 1,
      });

      setSourceUrls(u => ({ ...u, [sourceId]: design.url }));
      setSourceNames(n => ({ ...n, [sourceId]: design.title || 'Design' }));
      return c2;
    });
    toast('Design added to timeline.', 'success');
  }, [playhead, toast]);

  // ── Switch composition ────────────────────────────────────────────

  const switchComposition = useCallback(async (id) => {
    if (id === compId) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (compId && saveStatus === 'unsaved') await doSave(compId);

    try {
      const row = await api.get(`/compose/compositions/${id}`);
      loadFromRow(row);
    } catch (err) {
      toast('Failed to load composition.', 'error');
    }
  }, [compId, saveStatus, doSave, toast]);

  const createNew = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (compId && saveStatus === 'unsaved') await doSave(compId);

    try {
      const row = await api.post(`/compose/clients/${clientId}/compositions`, {
        title: 'Untitled', data: initComp(),
      });
      setCompList(prev => [row, ...(prev || [])]);
      loadFromRow(row);
    } catch (err) {
      toast('Failed to create composition.', 'error');
    }
  }, [clientId, compId, saveStatus, doSave, toast]);

  // ── Derived state ─────────────────────────────────────────────────

  const hasSources = Object.keys(composition.sources).length > 0;
  const selectedSourceId = selectedItem?.item?.source;
  const hasTranscript = selectedSourceId && transcripts[selectedSourceId]?.length > 0;

  const firstClipSourceId = useMemo(() =>
    Object.keys(composition.sources).find(k => composition.sources[k].kind === 'clip'),
    [composition.sources]
  );
  const effectiveClipSourceId = (selectedSourceId && composition.sources[selectedSourceId]?.kind === 'clip')
    ? selectedSourceId : firstClipSourceId;
  const effectiveHasTranscript = effectiveClipSourceId && transcripts[effectiveClipSourceId]?.length > 0;
  const effectiveTrackId = useMemo(() => {
    if (!effectiveClipSourceId) return null;
    for (const track of composition.tracks) {
      if (track.items.some(i => i.source === effectiveClipSourceId)) return track.id;
    }
    return null;
  }, [effectiveClipSourceId, composition.tracks]);

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

  // ── Drag-and-drop ─────────────────────────────────────────────────

  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Shortcut-reference toggle (? key) ─────────────────────────────

  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        compositorRef.current?.step?.(-1);
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        compositorRef.current?.pause?.();
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        compositorRef.current?.play?.();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setRipple(prev => !prev);
          return;
        }
      }

      // Trim shortcuts: [ ] for in/out points, , . for frame nudge
      const sel = selectedItemRef.current;
      if (sel && !e.ctrlKey && !e.metaKey) {
        const frameDur = 1 / (composition.fps || 30);

        if (e.key === '[') {
          e.preventDefault();
          const ph = playheadRef.current;
          const item = sel.item;
          if (ph > item.at && ph < item.at + item.len) {
            const delta = ph - item.at;
            const updates = { at: ph, len: item.len - delta };
            if (item.sourceStart != null) updates.sourceStart = (item.sourceStart || 0) + delta;
            if (item.in != null) updates.in = (item.in || 0) + delta;
            setComposition(prev => updateItem(prev, sel.track.id, item.id, updates));
          }
          return;
        }
        if (e.key === ']') {
          e.preventDefault();
          const ph = playheadRef.current;
          const item = sel.item;
          if (ph > item.at && ph < item.at + item.len) {
            setComposition(prev => updateItem(prev, sel.track.id, item.id, { len: ph - item.at }));
          }
          return;
        }
        if (e.key === ',') {
          e.preventDefault();
          setComposition(prev => updateItem(prev, sel.track.id, sel.item.id,
            { at: Math.max(0, sel.item.at - frameDur) }));
          return;
        }
        if (e.key === '.') {
          e.preventDefault();
          setComposition(prev => updateItem(prev, sel.track.id, sel.item.id,
            { at: sel.item.at + frameDur }));
          return;
        }
      }

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: 'var(--s6)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading editor...</div>;
  }

  const saveLabel = saveStatus === 'saving' ? 'Saving...'
    : saveStatus === 'unsaved' ? 'Unsaved'
    : saveStatus === 'error' ? 'Save failed' : 'Saved';

  return (
    <div style={{ marginTop: 'var(--s4)' }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

      {/* Composition switcher */}
      {compList && compList.length > 0 && (
        <div className="row center" style={{ gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
          <select
            className="input"
            style={{ maxWidth: 260, fontSize: 'var(--fs-caption)' }}
            value={compId || ''}
            onChange={(e) => switchComposition(Number(e.target.value))}
          >
            {compList.map(c => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled'} ({new Date(c.updated_at).toLocaleDateString()})
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={createNew}>
            + New
          </button>
          <span className="body-xs text-subtle" style={{ marginLeft: 'auto' }}>
            {saveLabel}
          </span>
        </div>
      )}

      <div className="edit-split" style={{ marginTop: 'var(--s2)' }}>
        <div>
          <div className="studio-stage">
            <Compositor
              ref={compositorRef}
              composition={composition}
              sourceUrls={sourceUrls}
              transcripts={transcripts}
              playhead={playhead}
              onSeek={setPlayhead}
              onMeta={onMeta}
              maxHeight="50vh"
            />
            {/* Open, not collapsed. A panel that answers the operator's
                question and has to be unfolded to do it is a panel nobody
                opens, and the checks are advisory and say so on screen, so
                there is nothing here to protect anyone from. */}
            {hasSources && (
              // Capped to the player's own height and scrolled, because the
              // grid row is as tall as its tallest cell: opened, the eight
              // checks and their evidence measured 964px against the player's
              // 500, which pushed the timeline 460px down and off a
              // 1000px-tall screen. The timeline is the thing you work in, so
              // the panel beside the picture may not be taller than the
              // picture. Found by measuring the boxes in a browser; no unit
              // test and no amount of reading would have shown it.
              <div className="card" data-studio-checks
                style={{ padding: 'var(--s4)', maxHeight: '50vh', overflowY: 'auto' }}>
                <ReelChecks
                  timings={allTimings}
                  edit={reelEdit}
                  clientId={clientId}
                  defaultOpen
                />
              </div>
            )}
          </div>
          <div style={{ marginTop: 'var(--s3)' }}>
            <CompositionTimeline
              composition={composition}
              onChange={setComposition}
              sourceUrls={sourceUrls}
              playhead={playhead}
              onSeek={setPlayhead}
              selectedId={selectedId}
              selectedTrackId={selectedTrackId}
              onSelect={handleSelect}
              onDragStart={startBatch}
              onDragEnd={commitBatch}
              onDragCancel={discardBatch}
              ripple={ripple}
            />
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 'var(--s4)' }}>
            <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
              <h3 className="title">Editor</h3>
              <div className="row center" style={{ gap: 'var(--s1)' }}>
                <button type="button" className="btn-chip" title="Undo (Ctrl+Z)"
                  disabled={!canUndo} onClick={undo}
                  style={{ fontSize: 'var(--fs-caption)', width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  &#x21a9;
                </button>
                <button type="button" className="btn-chip" title="Redo (Ctrl+Shift+Z)"
                  disabled={!canRedo} onClick={redo}
                  style={{ fontSize: 'var(--fs-caption)', width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  &#x21aa;
                </button>
                <button type="button" className="btn-chip" title="Ripple edit: shift subsequent items when trimming or deleting"
                  onClick={() => setRipple(v => !v)}
                  style={{
                    fontSize: 'var(--fs-caption)', padding: '0 8px', height: 26,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    borderColor: ripple ? 'var(--accent)' : undefined,
                    fontWeight: ripple ? 700 : undefined,
                    background: ripple ? 'var(--accent-soft)' : undefined,
                  }}>
                  Ripple
                </button>
                <ShortcutButton onClick={() => setShortcutsOpen(v => !v)} />
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={async () => { await flushSave(compId); setExportOpen(true); }}
                  disabled={!compId || total <= 0}>
                  Export
                </button>
                {/* Share needs no flushSave, deliberately, and it is worth
                    saying why: a link carries renders that already exist, so
                    the unsaved edit in front of you is not part of what the
                    client would see. Flushing here would imply otherwise. The
                    dialog lists exports by time so a stale one is visible. */}
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => setShareOpen(true)} disabled={!compId}>
                  Share
                </button>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => doSave(compId)} disabled={saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Saving...' : 'Save now'}
                </button>
              </div>
            </div>

            {/* Add clip / design / audio */}
            <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept={CLIP_ACCEPT} multiple
                style={{ display: 'none' }} onChange={onFileChange} />
              <input ref={audioFileRef} type="file" accept="audio/*" multiple
                style={{ display: 'none' }} onChange={onAudioFileChange} />
              <button type="button" className="btn btn-primary btn-sm"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading...' : '+ Add clip'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => audioFileRef.current?.click()} disabled={uploadingAudio}>
                {uploadingAudio ? 'Uploading...' : '+ Add music'}
              </button>

              {designs.length > 0 && (
                <select className="btn btn-secondary btn-sm"
                  style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)' }}
                  value=""
                  onChange={(e) => {
                    const d = designs.find(x => String(x.id) === e.target.value);
                    if (d) addDesign(d);
                    e.target.value = '';
                  }}>
                  <option value="">+ Add design</option>
                  {designs.map(d => (
                    <option key={d.id} value={d.id}>{d.title || `Design ${d.id}`}</option>
                  ))}
                </select>
              )}

              {hasSources && (
                <select className="btn btn-secondary btn-sm"
                  style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)' }}
                  value=""
                  title="Generated in the render. No upload, no cost."
                  onChange={(e) => {
                    if (e.target.value) addEffect(e.target.value);
                    e.target.value = '';
                  }}>
                  <option value="">+ Add effect</option>
                  {FX_NAMES.map(name => (
                    <option key={name} value={name}>{FX[name].label}</option>
                  ))}
                </select>
              )}
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

            {/* Selected item inspector */}
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
                      <td>
                        <TimecodeInput value={selectedItem.item.at} fps={fps} label="start time"
                          onChange={(v) => {
                            setComposition(prev =>
                              updateItem(prev, selectedItem.track.id, selectedItem.item.id, { at: v })
                            );
                          }}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="text-subtle" style={{ paddingRight: 'var(--s2)' }}>Length</td>
                      <td>
                        <TimecodeInput value={selectedItem.item.len} fps={fps} label="duration"
                          onChange={(v) => {
                            if (v > 0) {
                              setComposition(prev =>
                                updateItem(prev, selectedItem.track.id, selectedItem.item.id, { len: v })
                              );
                            }
                          }}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Camera moves, on a photograph only.
                    Six chips rather than a scale slider and a position pair.
                    The move is the unit of work here: a photograph with a
                    slow push reads as expensive and a static one reads as a
                    slideshow, and nobody chooses that by typing 1.12 into a
                    number field. The vocabulary is MOTIONS from the template
                    engine, unchanged, so a move chosen here and the same move
                    chosen by the stills-montage template produce the same
                    animated scale and pos — one list, not a second opinion.

                    Rotation is absent and stays absent: the render graph's
                    output box is init-only, so an animated rotation cannot be
                    produced, and a control for it would be the page lying
                    about its own export. */}
                {selectedSource?.still === true && (
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                      Camera move
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                      <button type="button"
                        className={`btn-chip${selectedItem.item.beat ? '' : ' is-active'}`}
                        onClick={() => setComposition(prev => updateItem(
                          prev, selectedItem.track.id, selectedItem.item.id,
                          // Undoing a move has to clear every field the move
                          // set, not just the name. A leftover `scale` with no
                          // `beat` is a move the inspector says is off and the
                          // render still performs.
                          { scale: null, pos: null, beat: null },
                        ))}>
                        Hold
                      </button>
                      {MOTION_NAMES.map(name => (
                        <button key={name} type="button"
                          className={`btn-chip${selectedItem.item.beat === name ? ' is-active' : ''}`}
                          title={describeMotion(name)}
                          onClick={() => setComposition(prev => updateItem(
                            prev, selectedItem.track.id, selectedItem.item.id,
                            // `beat` carries the name so the chip can light up
                            // and the review sheet can say why a clip moves.
                            // It is already a rationale field on an item.
                            { scale: null, pos: null, ...transformFor(name), beat: name },
                          ))}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
                        <select className="btn-chip"
                          style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)' }}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) addCaptions(selectedSourceId, e.target.value);
                            e.target.value = '';
                          }}>
                          <option value="">+ Captions</option>
                          {captionTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name || t.id}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}

                  {selectedSource?.kind === 'design' && (
                    <>
                      <span className="body-xs text-muted">
                        {selectedSource.width || '?'} x {selectedSource.height || '?'}
                      </span>
                      <select className="btn-chip"
                        style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)' }}
                        value={selectedItem.item.fit || 'contain'}
                        onChange={(e) => {
                          setComposition(prev =>
                            updateItem(prev, selectedItem.track.id, selectedItem.item.id,
                              { fit: e.target.value })
                          );
                        }}>
                        <option value="contain">Contain</option>
                        <option value="cover">Cover</option>
                      </select>
                    </>
                  )}
                </div>

                {/* Volume slider for any item */}
                <div style={{ marginTop: 'var(--s3)' }}>
                  <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                    Volume: {(selectedItem.item.gain ?? 1).toFixed(1)}
                  </div>
                  <input type="range" min="0" max="4" step="0.1"
                    value={selectedItem.item.gain ?? 1}
                    style={{ width: '100%', accentColor: 'var(--primary)' }}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setComposition(prev =>
                        updateItem(prev, selectedItem.track.id, selectedItem.item.id,
                          { gain: val })
                      );
                    }}
                  />
                </div>

                {/* Ducking toggle for audio track items */}
                {selectedItem.track.kind === 'audio' && (() => {
                  const speechTrack = composition.tracks.find(t => t.kind === 'video');
                  if (!speechTrack) return null;
                  const isDucked = selectedItem.track.duckUnder === speechTrack.id;
                  return (
                    <label className="body-xs" style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--s1)',
                      marginTop: 'var(--s2)', cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={isDucked}
                        onChange={(e) => {
                          const trackId = selectedItem.track.id;
                          const newVal = e.target.checked ? speechTrack.id : undefined;
                          setComposition(prev => ({
                            ...prev,
                            tracks: prev.tracks.map(t =>
                              t.id === trackId
                                ? { ...t, duckUnder: newVal }
                                : t
                            ),
                          }));
                        }}
                      />
                      Duck under speech
                    </label>
                  );
                })()}

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

            {/* Tighten and B-roll: use selected clip or auto-detect first clip */}
            {effectiveHasTranscript && effectiveTrackId && (
              <>
                <TightenPanel
                  compId={compId}
                  sourceId={effectiveClipSourceId}
                  composition={composition}
                  onCompositionChange={setComposition}
                  trackId={effectiveTrackId}
                />
                <BrollPanel
                  compId={compId}
                  sourceId={effectiveClipSourceId}
                  clientId={clientId}
                  composition={composition}
                  onCompositionChange={setComposition}
                />
              </>
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


        </div>
      </div>

      {exportOpen && (
        <ExportModal compId={compId} composition={composition}
          onClose={() => setExportOpen(false)} />
      )}
      {shareOpen && (
        <ShareReelModal compId={compId} clientId={clientId}
          clientName={clientName} title={composition?.title}
          onClose={() => setShareOpen(false)} />
      )}
      <ShortcutReference visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
