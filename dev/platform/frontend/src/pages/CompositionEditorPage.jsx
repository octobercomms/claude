import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Compositor from '../components/video/Compositor';
import CompositionTimeline from '../components/video/CompositionTimeline';
import {
  emptyComposition, addSource, addTrack, addItem, removeItem,
  updateItem, duration as compDuration,
  rippleRemoveItem, splitItem, isStillMime, CLIP_ACCEPT, TRANSITION_TYPES,
} from '@shared/composition.mjs';
import {
  MOTION_NAMES, transformFor, describeMotion, STILL_DEFAULT_LEN,
} from '@shared/compositionTemplate.mjs';
import * as PB from '@shared/compositionPlayback.mjs';
import { FX, FX_NAMES, describeFx } from '@shared/compositionFx.mjs';
import ReelChecks from '../components/ReelChecks';
import TightenPanel from '../components/video/TightenPanel';
import BrollPanel from '../components/video/BrollPanel';
import ShortcutReference from '../components/video/ShortcutReference';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useCompositionHistory } from '../hooks/useCompositionHistory';
import ExportModal from '../components/video/ExportModal';
import ShareReelModal from '../components/video/ShareReelModal';
import StudioShelf from '../components/video/StudioShelf';

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

export default function CompositionEditorPage({
  clientId, clientName = null, openId = null, onOpen = null,
}) {
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
  // The reel's NAME, which the editor did not hold. `composition` is the
  // `data` blob and `emptyComposition()` has no title in it, so the one place
  // the name was meant to reach a client — the share link's heading — fell
  // through to ShareReelModal's own fallback and every link a client ever
  // received was called "Reel — for your review".
  const [compTitle, setCompTitle] = useState('');
  const [compStatus, setCompStatus] = useState('draft');
  // Which reel is open, for the effects and cleanups that read it after the
  // render they were created in. Declared here rather than beside the
  // autosave it was added for, because the loader above reads it too and a
  // `const` used before its line is the shape of fault that cost this file a
  // blank page once already.
  const compIdRef = useRef(null);
  compIdRef.current = compId;
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [captionTemplates, setCaptionTemplates] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [dragOver, setDragOver] = useState(false);
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showFrame, setShowFrame] = useState(false);
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
  const totalRef = useRef(0);
  totalRef.current = total;

  // ── Initialise: load compositions list, templates ─────────────────

  /**
   * Which reel is open, and the one place that decides it.
   *
   * `openId` used to be a handoff only: "Send to Edit" on the Record tab and
   * "Open in editor" on the review sheet name the composition they mean,
   * because without it the editor opened the first row of its own list and
   * the review sheet's button landed on whatever was newest.
   *
   * IT IS NOW THE ADDRESS. It comes from `?open=` in the URL rather than from
   * component state in the tab above, so a reel can be linked, pasted into a
   * message and reached with Back — which is what every other record type in
   * OMI already gets from `useOpenState`. The composition was the only one
   * without it, and that, rather than its styling, was what made the
   * composition `<select>` load-bearing: it was a navigation system standing
   * in for a URL nobody had written.
   *
   * The list is fetched once per client. This effect also runs when the
   * address changes, and refetching 14 rows to answer "open number 7" would
   * put a loading state over work in progress.
   */
  const compListRef = useRef(null);
  const listForClientRef = useRef(null);
  useEffect(() => {
    let live = true;
    async function init() {
      try {
        let list = compListRef.current;
        if (listForClientRef.current !== clientId) {
          const [fetched, templates, designList] = await Promise.all([
            api.get(`/compose/clients/${clientId}/compositions`),
            api.get('/compose/caption-templates').catch(() => []),
            api.get(`/compose/designs/${clientId}`).catch(() => []),
          ]);
          if (!live) return;
          setCaptionTemplates(templates);
          setDesigns(designList);
          list = fetched;
          compListRef.current = fetched;
          listForClientRef.current = clientId;
          setCompList(fetched);
        }

        if (openId && String(openId) === String(compIdRef.current)) return;

        if (openId) {
          // A link may name a reel made after this list was fetched, which is
          // the ordinary case for an address somebody pasted.
          const known = list.find((r) => String(r.id) === String(openId));
          const row = known || await api.get(`/compose/compositions/${openId}`);
          if (!live) return;
          if (!known) {
            const next = [row, ...list];
            compListRef.current = next;
            setCompList(next);
          }
          loadFromRow(row);
          return;
        }

        if (compIdRef.current) return;
        if (list.length > 0) {
          loadFromRow(list[0]);
        } else {
          const row = await api.post(`/compose/clients/${clientId}/compositions`, {
            title: 'Untitled', data: initComp(),
          });
          if (!live) return;
          setCompId(row.id);
          compListRef.current = [row];
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
    const loadedAssets = row.source_assets || {};
    const loadedTranscripts = row.transcripts || {};
    setCompId(row.id);
    setCompTitle(row.title || '');
    setCompStatus(row.status || 'draft');
    resetHistory(data);
    setSourceAssets(loadedAssets);
    setTranscripts(loadedTranscripts);
    savedJsonRef.current = JSON.stringify([data, loadedAssets, loadedTranscripts]);
    setPlayhead(0);
    setSelectedId(null);
    setSelectedTrackId(null);

    // A source may know where its media is in one of two ways, and until now
    // the editor only understood one of them.
    //
    // An uploaded clip carries a `url`. A RECORDING does not:
    // `compositions.fromRecording` writes `asset: <id>` and nothing else,
    // because a recording lives behind `mediaStore` under a storage key and
    // has no servable path. So "Send to Edit" on the Record tab opened a
    // correct timeline over a BLACK player, while the render was fine all
    // along — the renderer resolves by asset id through `assetMedia`.
    //
    // `/api/assets/:id/file` is the browser's half of that, and it matters
    // beyond recordings: anything picked from the library is an id, so every
    // future way into a composition reproduces the fault without it.
    //
    // The url wins when both exist. It is what every existing composition
    // carries, it is already in the uploads tree, and going through the asset
    // route instead would add a redirect to the common case.
    const urls = {};
    const names = {};
    if (data.sources) {
      for (const [sid, src] of Object.entries(data.sources)) {
        if (src.url) urls[sid] = src.url;
        else if (src.asset) urls[sid] = `/api/assets/${src.asset}/file`;
        names[sid] = src.originalName || src.url?.split('/').pop() || 'Clip';
      }
    }
    setSourceUrls(urls);
    setSourceNames(names);
    setSaveStatus('saved');
  }

  // ── Auto-save ─────────────────────────────────────────────────────

  // What the server is known to hold, serialised. It is set when a reel is
  // loaded and again whenever a write succeeds, and the autosave effect
  // below compares against it. See that effect for why.
  const savedJsonRef = useRef(null);
  const snapshot = () => JSON.stringify([
    latestCompRef.current, latestAssetsRef.current, latestTransRef.current,
  ]);

  const doSave = useCallback(async (id) => {
    if (!id) return false;
    const sending = snapshot();
    setSaveStatus('saving');
    try {
      await api.put(`/compose/compositions/${id}`, {
        data: latestCompRef.current,
        sourceAssets: latestAssetsRef.current,
        transcripts: latestTransRef.current,
      });
      savedJsonRef.current = sending;
      setSaveStatus('saved');
      return true;
    } catch {
      setSaveStatus('error');
      return false;
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

  // Leaving the screen inside the autosave window used to lose the last
  // edit: this cleanup cleared the pending timer and saved nothing, so a
  // click on any nav row within 1500ms of a trim discarded it in silence.
  // The request is started here rather than awaited — a cleanup cannot wait
  // — and a PUT already in flight completes after the component is gone.
  useEffect(() => {
    return () => {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (compIdRef.current) doSave(compIdRef.current);
    };
  }, [doSave]);

  // And the browser's own exit. `ClientDesignPage` and `RecordingsPage` both
  // warn before an unload with work in hand; the editor, which is the screen
  // with the autosave window, did not.
  useEffect(() => {
    const pending = saveStatus === 'unsaved' || saveStatus === 'error';
    if (!pending) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveStatus]);

  /**
   * Mark unsaved on composition changes.
   *
   * OPENING A REEL IS NOT AN EDIT. `mountedRef` skipped the first run of
   * this effect, which happens before the row has arrived; the run that
   * mattered was the second one, after `loadFromRow` had put the loaded
   * composition into state with `compId` now set. It scheduled a save, so
   * MERELY LOOKING at a reel wrote to the database. Measured in the browser:
   * one `PUT /api/compose/compositions/1` with no interaction at all.
   *
   * Two things came of that. `compositions.list` orders by `updated_at`, so
   * browsing three reels to find the right one restamped all three and
   * reordered the list you were browsing. And when that write failed you got
   * "Your last change is only in this tab", in red, on a page where you had
   * changed nothing — which is how the loudest state in the editor ends up
   * meaning nothing.
   *
   * The comparison is against what the server is known to hold rather than a
   * skip-the-next-run flag, because a flag has to guess how many renders a
   * load takes. It also gets undo right: an edit undone back to the saved
   * state is not a change, and an edit undone back to the LOADED state after
   * a save in between still is.
   */
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!compId) return;
    if (savedJsonRef.current !== null && snapshot() === savedJsonRef.current) return;
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

  // The rule the toolbar's Split button shows rather than keeps to itself:
  // the playhead has to be inside the selected clip, which is what
  // `splitItem` requires and what `[` and `]` have always no-opped on in
  // silence.
  const canSplit = !!selectedItem
    && playhead > selectedItem.item.at + 0.001
    && playhead < selectedItem.item.at + selectedItem.item.len - 0.001;

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

  // One door for files, which is what the shelf's "Add files" presses.
  //
  // Three buttons used to live in the inspector — `+ Add clip`, `+ Add music`,
  // `+ Add design` — and the first two are the same gesture with a different
  // `accept`. A person with a folder open does not sort their selection by
  // kind first. The mime type already decides everything downstream, so it
  // decides here too: `isStillMime` and `CLIP_ACCEPT` were written for exactly
  // this and the upload routes disagree about nothing.
  //
  // `+ Add design` stays where it is: a design is not a file, it is a page of
  // a set this client already has, so it is a picker rather than an upload.
  const handleAnyFiles = useCallback(async (files) => {
    const all = Array.from(files || []);
    if (!all.length) return;
    const audio = all.filter(f => f.type.startsWith('audio/'));
    const rest = all.filter(f => !f.type.startsWith('audio/'));
    // Sequential, not parallel: both paths read and replace the composition,
    // and two of them racing would drop whichever finished first.
    if (rest.length) await handleFiles(rest);
    if (audio.length) await handleAudioFiles(audio);
  }, [handleFiles, handleAudioFiles]);

  // The shelf's input takes every kind, so its change handler sorts them.
  const onAnyFileChange = useCallback((e) => {
    handleAnyFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }, [handleAnyFiles]);

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

  /**
   * Remove the selected clip, and close the gap when there is one to close.
   *
   * THE RIPPLE MODE IS GONE, and this replaces it rather than hiding it.
   * Three measured reasons it had to go. `shiftAfter` in composition.mjs
   * shifts ONE track, and every October reel has a music bed, so a ripple
   * delete on the picture shortened the video and left the music at full
   * length — `duration()` takes the max, so the reel still reported 00:14:12
   * and now ended on music over nothing. Its own tooltip claimed it worked on
   * trimming, which it never did: `rippleTrimStart` and `rippleTrimEnd` were
   * imported by the timeline and never called. And it was an invisible mode
   * you could enter from anywhere with `r`, whose only indicator sat 193px
   * above the top of the viewport when the timeline was in view.
   *
   * What a person means by "close the gap" is: the clip after this one was
   * butted up against it, so pull it back. A cutaway floating on V2 where the
   * speech put it is not a gap and must not move, which is exactly what the
   * old mode did to it silently.
   */
  const handleRemoveItem = useCallback(() => {
    if (!selectedItem) return;
    const { track, item } = selectedItem;
    const end = item.at + item.len;
    const abuts = track.items.some(
      (i) => i.id !== item.id && Math.abs(i.at - end) < 0.001);
    setComposition(prev => (abuts
      ? rippleRemoveItem(prev, track.id, item.id)
      : removeItem(prev, track.id, item.id)));
    setSelectedId(null);
    setSelectedTrackId(null);
  }, [selectedItem]);

  // Split the selected item at the playhead, and SELECT THE TAIL.
  //
  // `splitItem` has always returned `{ comp, id }` where `id` is the new
  // second piece, and the timeline's handler destructured only `comp` and
  // threw the id away. Selecting the tail is what the gesture is for: cut,
  // move on, cut again, delete the middle.
  const handleSplitItem = useCallback(() => {
    if (!selectedItem) return;
    const { comp: next, id } = splitItem(
      latestCompRef.current, selectedItem.track.id, selectedItem.item.id,
      playheadRef.current);
    if (!id) return;              // the playhead is not inside the item
    setComposition(() => next);
    setSelectedId(id);
  }, [selectedItem]);

  // Move the playhead, in seconds. The compositor follows the `playhead`
  // prop when it is not playing, so this is the one way to move it and it
  // works whether or not anything has focus.
  const seekBy = useCallback((secs) => {
    compositorRef.current?.pause?.();
    const fpsNow = latestCompRef.current?.fps || 30;
    setPlayhead((p) => {
      const next = Math.max(0, Math.min(totalRef.current, p + secs));
      return Math.round(next * fpsNow) / fpsNow;
    });
  }, []);

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

  /**
   * Put the work in hand on the server before the screen changes under it.
   *
   * This guarded `'unsaved'` and let `'error'` fall straight through, which
   * means the control that said "Your last change is only in this tab" sat
   * next to a control that threw that change away without a question. Both
   * states have unsaved work; the difference between them is only whether a
   * write has already been attempted.
   *
   * It returns false when the save fails, and the caller stays where it is
   * and says so. Losing the edit quietly is the one outcome worth refusing.
   */
  const leaveSafely = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (!compId) return true;
    if (saveStatus !== 'unsaved' && saveStatus !== 'error') return true;
    const ok = await doSave(compId);
    if (!ok) toast('That change could not be saved, so this reel stays open.', 'error');
    return ok;
  }, [compId, saveStatus, doSave, toast]);

  /**
   * Open another reel, by changing the address rather than the state.
   *
   * `onOpen` writes `?open=<id>`, the loader above reacts to it and reads the
   * row out of the list it already has. One door: an address typed, a link
   * pasted, Back, and this control all arrive the same way, so none of them
   * can show a different reel from the one the URL names.
   */
  const switchComposition = useCallback(async (id) => {
    if (String(id) === String(compId)) return;
    if (!await leaveSafely()) return;
    if (onOpen) { onOpen(id); return; }
    try {
      const row = await api.get(`/compose/compositions/${id}`);
      loadFromRow(row);
    } catch (err) {
      toast('Failed to load composition.', 'error');
    }
  }, [compId, leaveSafely, onOpen, toast]);

  const createNew = useCallback(async () => {
    if (!await leaveSafely()) return;

    try {
      const row = await api.post(`/compose/clients/${clientId}/compositions`, {
        title: 'Untitled', data: initComp(),
      });
      const next = [row, ...(compListRef.current || [])];
      compListRef.current = next;
      setCompList(next);
      loadFromRow(row);
      // And put it in the address, so the new reel can be linked like any
      // other and a refresh does not land you back on the old one.
      if (onOpen) onOpen(row.id);
    } catch (err) {
      toast('Failed to create composition.', 'error');
    }
  }, [clientId, leaveSafely, onOpen, toast]);

  // ── The reel's name ───────────────────────────────────────────────
  //
  // `PUT /compose/compositions/:id` with a title alone: `compositions.update`
  // builds its SET list field by field, so a rename touches no other column
  // and cannot race the autosave with a stale `data`.
  const startRename = useCallback(() => {
    // Empty rather than prefilled when the reel has never been named, so the
    // first thing you do is type rather than clear the word "Untitled".
    setRenameDraft(compTitle === 'Untitled' ? '' : compTitle);
    setRenaming(true);
  }, [compTitle]);

  const commitRename = useCallback(async () => {
    const next = renameDraft.trim();
    setRenaming(false);
    if (!compId || !next || next === compTitle) return;
    const previous = compTitle;
    setCompTitle(next);
    const apply = (list) => (list || []).map(
      (r) => (String(r.id) === String(compId) ? { ...r, title: next } : r));
    compListRef.current = apply(compListRef.current);
    setCompList(apply);
    try {
      await api.put(`/compose/compositions/${compId}`, { title: next });
    } catch {
      setCompTitle(previous);
      const revert = (list) => (list || []).map(
        (r) => (String(r.id) === String(compId) ? { ...r, title: previous } : r));
      compListRef.current = revert(compListRef.current);
      setCompList(revert);
      toast('That name could not be saved.', 'error');
    }
  }, [compId, compTitle, renameDraft, toast]);

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

  // ── The shelf: material already in the system ─────────────────────
  //
  // A library asset needs no upload and no copy. The renderer resolves a
  // source by its asset id through `assetMedia`, which handles both stores,
  // and the browser resolves it through `/api/assets/:id/file`. So picking is
  // a model edit, not a transfer.
  //
  // Everything lands at the END of its track rather than at the playhead.
  // That is the rule the upload already uses, so the shelf introduces no
  // second rule; the playhead sits at 0 until somebody moves it, so "at the
  // playhead" would mean "insert at the start", which is almost never meant;
  // and dropping onto an occupied range raises insert-or-overwrite, which
  // this editor has no answer for yet.
  const placeSource = useCallback((comp, sourceId, kind, len) => {
    const wantAudio = kind === 'audio';
    let c = comp;
    let trackId = c.tracks.find(t => t.kind === (wantAudio ? 'audio' : 'video'))?.id;
    if (!trackId) {
      const r = addTrack(c, wantAudio ? 'audio' : 'video');
      c = r.comp;
      trackId = r.id;
    }
    const at = compDuration(c);
    const r = addItem(c, trackId, { at, len, source: sourceId });
    return { comp: r.comp, trackId, itemId: r.id, at };
  }, []);

  // Added, then selected, then named in the toast with the time it landed on.
  // Without those three a click reads as a database write rather than as
  // placing something: the inspector is already pointed at the new item, so a
  // camera move is one more click.
  const announce = useCallback((name, at) => {
    toast(`${name} added at ${PB.timecode(at, fps)}`, 'success');
  }, [toast, fps]);

  const pickAsset = useCallback((asset) => {
    const still = String(asset.mime || '').startsWith('image/') || asset.kind === 'image';
    const isAudio = asset.kind === 'audio';
    const dur = Number(asset.duration_s) > 0 ? Number(asset.duration_s) : null;
    const len = still ? STILL_DEFAULT_LEN : (dur || STILL_DEFAULT_LEN);

    setComposition(prev => {
      const { comp: c1, id: sourceId } = addSource(prev, {
        kind: isAudio ? 'audio' : 'clip',
        asset: asset.id,
        ...(asset.url ? { url: asset.url } : {}),
        ...(still ? { still: true } : {}),
        ...(dur ? { duration: dur } : {}),
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
        originalName: asset.title || undefined,
      });
      const placed = placeSource(c1, sourceId, isAudio ? 'audio' : 'video', len);

      // The browser needs a url even when the asset row has none: a recording
      // lives behind the media store under a key, which is exactly the case
      // that used to draw a black player.
      setSourceUrls(u => ({ ...u, [sourceId]: asset.url || `/api/assets/${asset.id}/file` }));
      setSourceNames(n => ({ ...n, [sourceId]: asset.title || 'Clip' }));
      setSourceAssets(a => ({ ...a, [sourceId]: asset.id }));
      setSelectedId(placed.itemId);
      setSelectedTrackId(placed.trackId);
      announce(asset.title || 'Clip', placed.at);
      return placed.comp;
    });
  }, [placeSource, announce]);

  // A source already in the reel, used again. No new source: one source, two
  // items, which is what b-roll is.
  const pickSource = useCallback((sourceId) => {
    setComposition(prev => {
      const src = prev.sources[sourceId];
      if (!src) return prev;
      const len = src.kind === 'clip' && src.still !== true && Number(src.duration) > 0
        ? Number(src.duration) : STILL_DEFAULT_LEN;
      const placed = placeSource(prev, sourceId, src.kind === 'audio' ? 'audio' : 'video', len);
      setSelectedId(placed.itemId);
      setSelectedTrackId(placed.trackId);
      announce(sourceNames[sourceId] || 'Clip', placed.at);
      return placed.comp;
    });
  }, [placeSource, announce, sourceNames]);

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
        compositorRef.current?.toggle?.();
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        compositorRef.current?.play?.();
        return;
      }

      /* Split, delete and the playhead, from anywhere on the page.
       *
       * These three lived on the timeline lane's own `onKeyDown`, which fires
       * only when that div has DOM focus — and CLICKING A CLIP DOES NOT GIVE
       * IT FOCUS. Measured on the shipped build: click a clip, the inspector
       * opens, press Delete and nothing happens; press S and nothing happens.
       * Clicking the RULER focuses the lane, so whether the editing keys
       * worked depended on where you last clicked, and the loser was whoever
       * clicked the thing they wanted to edit. The lane was not reachable
       * with Tab either, in forty presses. Meanwhile the timeline printed a
       * paragraph underneath itself telling you to press those keys.
       *
       * Selection is a property of the document, not of which div has focus.
       */
      if (e.key === 's' || e.key === 'S') {
        if (!selectedItemRef.current) return;
        e.preventDefault();
        handleSplitItem();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedItemRef.current) return;
        e.preventDefault();
        handleRemoveItem();
        return;
      }

      // One meaning for the arrows: step the playhead. They used to mean
      // three different things depending on what had focus — nothing, a
      // frame step in the player, or a 0.1s item nudge on the lane — and
      // scrubbing is the constant act. Shift makes it a second, which is
      // what the shortcut reference has always promised and nothing
      // implemented. `,` and `.` keep the item nudge, in one vocabulary.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const fpsNow = latestCompRef.current?.fps || 30;
        seekBy(dir * (e.shiftKey ? 1 : 1 / fpsNow));
        return;
      }

      // Play and pause, with one owner. Space worked only with the player
      // focused, and K was handled twice — by the compositor as a toggle and
      // here as a pause. A button with focus keeps its own space bar.
      if (e.key === ' ' && tag !== 'button' && tag !== 'a') {
        e.preventDefault();
        compositorRef.current?.toggle?.();
        return;
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
        // Shift for a second, the same two sizes the arrows now have.
        const nudge = e.shiftKey ? 1 : frameDur;
        if (e.key === ',' || e.key === '<') {
          e.preventDefault();
          setComposition(prev => updateItem(prev, sel.track.id, sel.item.id,
            { at: Math.max(0, sel.item.at - nudge) }));
          return;
        }
        if (e.key === '.' || e.key === '>') {
          e.preventDefault();
          setComposition(prev => updateItem(prev, sel.track.id, sel.item.id,
            { at: sel.item.at + nudge }));
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
  }, [undo, redo, handleSplitItem, handleRemoveItem, seekBy]);

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: 'var(--s6)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading editor...</div>;
  }

  // In a tool where every edit is autosaved, the save state is the trust
  // surface, and it was the quietest thing on the page: 12px, grey, and
  // "Save failed" rendered in exactly the same size, weight and colour as
  // "Saved". You had to read the DOM to tell which one you were looking at.
  //
  // So failure is the only one that shouts, and it says what to do. The other
  // three stay quiet on purpose: a tool that congratulates itself every 1500ms
  // trains you to stop reading the one message that matters.
  const save = saveStatus === 'saving' ? { label: 'Saving…', tone: 'text-subtle' }
    : saveStatus === 'unsaved' ? { label: 'Unsaved', tone: 'text-muted' }
      : saveStatus === 'error'
        ? { label: 'Not saved', tone: 'negative', detail: 'Your last change is only in this tab.' }
        : { label: 'Saved', tone: 'text-subtle' };

  return (
    <div style={{ marginTop: 'var(--s4)' }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

      {/* ── The top bar ──────────────────────────────────────────────
          What this replaces was a composition `<select>` as the first thing
          on the page, with the save state pushed to the far right of the same
          row. Two measurements condemned it. With fourteen reels and twelve of
          them never named, the box rendered 14 options with THREE distinct
          strings, and the date meant to tell them apart carries no time and is
          the first thing a 260px box truncates. And the save state, right
          aligned, sat 35px under the fixed connector indicator in the same
          corner, reading as part of that status cluster rather than as a fact
          about your document.

          The bar is also SHORTER than what it replaces. The heading slot it
          takes over held an h2 naming the screen whose nav row is lit and
          whose panel header says PRODUCE above it, so about 40px comes back on
          a screen where the timeline is already near the fold. */}
      <div className="row between" style={{ gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {save.tone === 'negative' ? (
            // The error takes this line from the kicker. The kicker is the
            // least important thing in the bar and can yield, and a 387px
            // pill fits here where it did not fit in the old right-hand
            // corner.
            <span className="body-xs" role="alert"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--s1)',
                color: 'var(--negative)', fontWeight: 700,
                background: 'var(--negative-soft)',
                padding: '2px var(--s2)', borderRadius: 'var(--r-pill)',
              }}>
              <span aria-hidden="true">!</span>
              {save.label}
              <span className="text-subtle" style={{ fontWeight: 400 }}>{save.detail}</span>
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => doSave(compId)} disabled={!compId}>
                Try again
              </button>
            </span>
          ) : (
            <div className="kicker">
              <span className="pip" />
              <span>Reel • {compStatus === 'draft' ? 'Draft'
                : compStatus.charAt(0).toUpperCase() + compStatus.slice(1)}</span>
            </div>
          )}

          <div className="row center" style={{ gap: 'var(--s2)', minWidth: 0 }}>
            {renaming ? (
              <input
                className="input" autoFocus
                aria-label="Reel name"
                value={renameDraft}
                placeholder="Name this reel"
                style={{ maxWidth: 420, fontSize: 'var(--fs-h1)', fontWeight: 700 }}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
                }}
              />
            ) : (
              <>
                {/* One line, always. A heading that wraps moves the timeline,
                    and this screen has lost that fight twice. */}
                <h1 className="h1" title={compTitle || 'Untitled reel'}
                  style={{
                    margin: 0, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    ...(compTitle && compTitle !== 'Untitled'
                      ? {} : { color: 'var(--text-muted)' }),
                  }}>
                  {compTitle && compTitle !== 'Untitled' ? compTitle : 'Untitled reel'}
                </h1>
                <button type="button" className="btn-icon btn-icon-sm"
                  onClick={startRename} disabled={!compId}
                  title="Rename this reel" aria-label="Rename this reel">
                  &#9998;
                </button>
              </>
            )}
            {/* The quietest thing in the bar, beside the work it describes.
                Two words rather than four: "Unsaved" and "Saving…" are the
                same fact to the person reading, and a label that changes
                wording every 1500ms in the corner of your eye is motion you
                have to ignore while judging a picture. */}
            <span className="body-xs text-subtle" style={{ flexShrink: 0 }}>
              {saveStatus === 'saved' ? 'Saved' : 'Saving…'}
            </span>
          </div>
        </div>

        <div className="row center" style={{ gap: 'var(--s2)', flexShrink: 0 }}>
          {/* Switching is demoted, not deleted, and it stays until Library
              grows a Reels tab: cutting the only door to reel seven before
              the other one is built would strand the operator. It writes the
              address now rather than component state, so a reel can be
              linked, pasted and reached with Back. */}
          {compList && compList.length > 1 && (
            <select
              className="btn btn-secondary btn-sm" aria-label="Open another reel"
              style={{ maxWidth: 160 }}
              // It holds no value on purpose: the reel you have open is the
              // heading to the left of it, and a picker that repeats the
              // title is a second answer to a question already answered. It
              // reads as a verb instead, which is what it is.
              value=""
              onChange={(e) => { if (e.target.value) switchComposition(Number(e.target.value)); }}
            >
              <option value="">Open a reel…</option>
              {compList.filter(c => String(c.id) !== String(compId)).map(c => (
                <option key={c.id} value={c.id}>{c.title || 'Untitled'}</option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={createNew}>
            + New
          </button>
          {/* Share needs no flushSave, deliberately, and it is worth saying
              why: a link carries renders that already exist, so the unsaved
              edit in front of you is not part of what the client would see.
              Flushing here would imply otherwise. The dialog lists exports by
              time so a stale one is visible. */}
          <button type="button" className="btn btn-secondary btn-sm"
            onClick={() => setShareOpen(true)} disabled={!compId}>
            Share
          </button>
          {/* The one primary on the screen. It was `btn-secondary`, the same
              class as `-1 frame`, while Play was the only accent fill on the
              page: the most emphasised control in the Studio was "play the
              preview" and the thing the screen exists to produce looked like
              a step-back button. */}
          <button type="button" className="btn btn-primary btn-sm"
            onClick={async () => { await flushSave(compId); setExportOpen(true); }}
            disabled={!compId || total <= 0}>
            Export
          </button>
        </div>
      </div>

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
              sourceNames={sourceNames}
              playhead={playhead}
              onSeek={setPlayhead}
              selectedId={selectedId}
              selectedTrackId={selectedTrackId}
              onSelect={handleSelect}
              onDragStart={startBatch}
              onDragEnd={commitBatch}
              onDragCancel={discardBatch}
              onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo}
              onSplit={handleSplitItem} onDelete={handleRemoveItem}
              canSplit={canSplit} canDelete={!!selectedItem}
              onShortcuts={() => setShortcutsOpen(v => !v)}
            />

          <StudioShelf
            composition={composition}
            clientId={clientId}
            sourceUrls={sourceUrls}
            sourceNames={sourceNames}
            onPickAsset={pickAsset}
            onPickSource={pickSource}
            onAddFiles={() => fileRef.current?.click()}
            uploading={uploading}
          />
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 'var(--s4)' }}>
            {/* The header row is gone, and it was a lid on a junk drawer.
                It held undo, redo, Ripple, the shortcut reference, Export and
                Share: a toolbar, an export bar and a mode switch in one card
                with no title. Export and Share went to the top bar with the
                last change; undo, redo and the `?` are on the timeline's own
                toolbar now, which is the surface they act on, and Ripple is
                deleted rather than moved — see `handleRemoveItem`.

                Measured at 1440x900 with the timeline scrolled into view,
                every one of those controls sat at y = -301. They were being
                offered where no hand could reach them. */}
            {/* Add clip / design / audio */}
            <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept={`${CLIP_ACCEPT},audio/*`} multiple
                style={{ display: 'none' }} onChange={onAnyFileChange} />
              <input ref={audioFileRef} type="file" accept="audio/*" multiple
                style={{ display: 'none' }} onChange={onAudioFileChange} />
              {/* `+ Add clip` and `+ Add music` are gone. Both are "put a file
                  in", which is now the shelf's Add files, and the shelf routes
                  by mime so a person with a folder open does not have to sort
                  their selection by kind first.
                  Two buttons for one gesture is the two-doors problem this
                  codebase keeps finding; worse, the clip one was the only
                  yellow button on the screen and it opened an OS file dialog,
                  so the most emphasised action in the Studio took you out of
                  the application while this client's media sat one panel away.
                  The inputs stay: the shelf presses `fileRef`, and
                  `audioFileRef` is still how an audio-only selection reaches
                  the audio route. */}

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
                color: dragOver ? 'var(--accent)' : 'var(--text-muted)',
                border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--card-border)'}`,
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
                  {/* Remove is on the timeline's toolbar now, and this one is
                      deleted in the same change rather than left as a second
                      door. Three reasons, the first measured: at 1280x800
                      with the timeline scrolled into view — the only position
                      you can work on the timeline from — this button sat at
                      y = -86, above the top of the window, and the Delete key
                      did nothing, so THERE WAS NO REACHABLE WAY TO DELETE A
                      CLIP. At 1440 it rendered five pixels from the fixed
                      client topbar, reading as the sixth item in the
                      application's global header. And the gesture is a
                      timeline gesture: you point at the block you want gone.
                      An inspector is where you change what a thing is. */}
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
                    <span className="body-xs text-muted">
                      {selectedSource.width || '?'} x {selectedSource.height || '?'}
                    </span>
                  )}
                </div>

                {/* Volume slider for any item */}
                <div style={{ marginTop: 'var(--s3)' }}>
                  <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                    Volume: {(selectedItem.item.gain ?? 1).toFixed(1)}
                  </div>
                  <input type="range" min="0" max="4" step="0.1"
                    value={selectedItem.item.gain ?? 1}
                    style={{ width: '100%', accentColor: 'var(--text)' }}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setComposition(prev =>
                        updateItem(prev, selectedItem.track.id, selectedItem.item.id,
                          { gain: val })
                      );
                    }}
                  />
                </div>

                {/* Transition, opacity and fit, moved here from the timeline's
                    own selected-item strip on 9 November.
                    The design review was right that this is a MOVE and not a
                    cut: `trans:` appeared in exactly two lines of JSX in the
                    whole frontend, both inside that strip, and it held the
                    only opacity and fit controls a clip had. Deleting the
                    strip without rehoming them would have removed dissolves
                    from the product.
                    One inspector, in one order, is also the point. The strip
                    was a second inspector 700px below the first, and the two
                    disagreed: both carried a volume slider, one 0–4 and one
                    0–2 with a clamp, for the same number. */}
                {selectedItem.track.kind === 'video' && (() => {
                  const items = selectedItem.track.items;
                  const idx = items.findIndex(i => i.id === selectedItem.item.id);
                  // A transition is between this item and the one before it,
                  // so the first item on a track has nothing to transition
                  // from and is offered nothing.
                  if (idx <= 0) return null;
                  const current = selectedItem.item.trans?.type || 'cut';
                  const LABEL = {
                    cut: 'Cut', fade: 'Fade', fadeblack: 'Via black',
                    wipeleft: 'Wipe', dissolve: 'Dissolve',
                  };
                  return (
                    <div style={{ marginTop: 'var(--s3)' }}>
                      <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                        Transition in
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                        {['cut', ...TRANSITION_TYPES].map(t => (
                          <button key={t} type="button"
                            className={`btn-chip${current === t ? ' is-active' : ''}`}
                            onClick={() => setComposition(prev => updateItem(
                              prev, selectedItem.track.id, selectedItem.item.id,
                              { trans: t === 'cut' ? null : { type: t } },
                            ))}>
                            {LABEL[t] || t}
                          </button>
                        ))}
                      </div>
                      {current !== 'cut' && (
                        <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
                          Overlap the previous item to set its length.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Opacity and fit, for anything that draws a picture. */}
                {(selectedSource?.kind === 'clip' || selectedSource?.kind === 'design') && (
                  <>
                    <div style={{ marginTop: 'var(--s3)' }}>
                      <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                        Opacity: {Math.round((selectedItem.item.opacity ?? 1) * 100)}%
                      </div>
                      <input type="range" min="0" max="1" step="0.05"
                        value={selectedItem.item.opacity ?? 1}
                        style={{ width: '100%', accentColor: 'var(--text)' }}
                        aria-label="Item opacity"
                        onChange={(e) => setComposition(prev => updateItem(
                          prev, selectedItem.track.id, selectedItem.item.id,
                          { opacity: parseFloat(e.target.value) },
                        ))}
                      />
                    </div>
                    {/* One vocabulary. The timeline said "Fill frame" and
                        "Letterbox"; the inspector said "Cover" and "Contain".
                        Two names for two values, both reachable in one
                        sitting. These are the words that say what happens to
                        the picture rather than what the CSS is called. */}
                    <div style={{ marginTop: 'var(--s3)' }}>
                      <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>
                        Fit
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                        {[['cover', 'Fill frame'], ['contain', 'Letterbox']].map(([v, label]) => (
                          <button key={v} type="button"
                            className={`btn-chip${(selectedItem.item.fit || 'cover') === v ? ' is-active' : ''}`}
                            onClick={() => setComposition(prev => updateItem(
                              prev, selectedItem.track.id, selectedItem.item.id, { fit: v },
                            ))}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

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
              {/* Seven chips became a sentence, and the capability stayed.
                  Frame size and frame rate are new-project decisions, not
                  editing ones: every template in this product is 1080x1920 at
                  30fps, nobody changes the rate mid-edit, and a control that
                  is permanently on screen for a value nobody touches teaches
                  the eye to skip that whole corner.
                  They open on Change, which is the honest shape: the decision
                  is rare, so it costs one click, and until then the panel
                  states what the composition IS rather than offering to
                  re-decide it. */}
              <div className="row between center">
                <span className="body-xs text-subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {W} x {H} · {fps}fps
                </span>
                <button type="button" className="btn-link body-xs"
                  onClick={() => setShowFrame(v => !v)}>
                  {showFrame ? 'Done' : 'Change'}
                </button>
              </div>
              {showFrame && (
                <div style={{ marginTop: 'var(--s2)' }}>
                  <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                    {SIZE_PRESETS.map(p => (
                      <button key={p.label} type="button"
                        className={`btn-chip${W === p.w && H === p.h ? ' is-active' : ''}`}
                        onClick={() => setSize(p.w, p.h)}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', marginTop: 'var(--s1)' }}>
                    {FPS_OPTIONS.map(f => (
                      <button key={f} type="button"
                        className={`btn-chip${fps === f ? ' is-active' : ''}`}
                        onClick={() => setFps(f)}>
                        {f}fps
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
          clientName={clientName} title={compTitle}
          onClose={() => setShareOpen(false)} />
      )}
      <ShortcutReference visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
