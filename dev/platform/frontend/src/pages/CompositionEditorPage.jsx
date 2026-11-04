import React, { useCallback, useRef, useState } from 'react';
import Compositor from '../components/video/Compositor';
import CompositionTimeline from '../components/video/CompositionTimeline';
import {
  emptyComposition, addSource, addTrack, addItem, removeItem,
  updateItem, duration as compDuration,
} from '@shared/composition.mjs';
import * as PB from '@shared/compositionPlayback.mjs';

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
  const [composition, setComposition] = useState(initComp);
  const [sourceUrls, setSourceUrls] = useState({});
  const [playhead, setPlayhead] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const compositorRef = useRef(null);
  const fileRef = useRef(null);

  const total = compDuration(composition);
  const fps = composition.fps || 30;
  const W = composition.size?.width || 1080;
  const H = composition.size?.height || 1920;

  // Find a video track (first one), creating one if needed
  const videoTrackId = composition.tracks.find(t => t.kind === 'video')?.id;

  const handleSelect = useCallback((itemId, trackId) => {
    setSelectedId(itemId);
    setSelectedTrackId(trackId);
  }, []);

  const selectedItem = (() => {
    if (!selectedId) return null;
    for (const track of composition.tracks) {
      const item = track.items.find(i => i.id === selectedId);
      if (item) return { item, track };
    }
    return null;
  })();

  // Add a clip from a file input
  const handleFiles = useCallback((files) => {
    if (!files?.length) return;
    setComposition(prev => {
      let comp = prev;
      let trackId = comp.tracks.find(t => t.kind === 'video')?.id;
      if (!trackId) {
        const r = addTrack(comp, 'video');
        comp = r.comp;
        trackId = r.id;
      }

      const newUrls = {};
      for (const file of files) {
        if (!file.type.startsWith('video/')) continue;
        const url = URL.createObjectURL(file);
        const { comp: c2, id: sourceId } = addSource(comp, {
          kind: 'clip', asset: null, url: null, duration: 0,
          width: 0, height: 0, fps: 30,
        });
        comp = c2;

        const end = compDuration(comp);
        const { comp: c3, id: itemId } = addItem(comp, trackId, {
          at: end, len: 0, source: sourceId,
        });
        comp = c3;
        newUrls[sourceId] = url;
      }
      setSourceUrls(u => ({ ...u, ...newUrls }));
      return comp;
    });
  }, []);

  const onFileChange = useCallback((e) => {
    handleFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }, [handleFiles]);

  // When the Compositor reports metadata for a source, update the source
  // duration and the item len (if still 0).
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

  const hasSources = Object.keys(composition.sources).length > 0;

  return (
    <div style={{ marginTop: 'var(--s4)' }}>
      <div className="edit-split"
        style={{ marginTop: 'var(--s4)' }}>
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
            <h3 className="title" style={{ marginBottom: 'var(--s3)' }}>Editor</h3>

            {/* Add clip */}
            <div style={{ marginBottom: 'var(--s4)' }}>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                multiple
                style={{ display: 'none' }}
                onChange={onFileChange}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                + Add clip
              </button>
            </div>

            {!hasSources && (
              <div style={{
                padding: 'var(--s6) var(--s4)',
                textAlign: 'center',
                color: 'var(--text-muted)',
                border: '2px dashed var(--card-border)',
                borderRadius: 'var(--r-md)',
              }}>
                Drop clips to begin
              </div>
            )}

            {/* Selected item properties */}
            {selectedItem && (
              <div style={{
                marginBottom: 'var(--s4)',
                padding: 'var(--s3)',
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--r-sm)',
              }}>
                <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s2)' }}>
                  Selected item
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
                    {selectedItem.item.in > 0 && (
                      <tr>
                        <td className="text-subtle" style={{ paddingRight: 'var(--s2)' }}>In</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {PB.timecode(selectedItem.item.in, fps)}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="text-subtle" style={{ paddingRight: 'var(--s2)' }}>Source</td>
                      <td>{selectedItem.item.source}</td>
                    </tr>
                  </tbody>
                </table>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 'var(--s2)' }}
                  onClick={handleRemoveItem}
                >
                  Remove
                </button>
              </div>
            )}

            {/* Composition settings */}
            <div style={{ marginBottom: 'var(--s3)' }}>
              <div className="body-xs text-subtle" style={{ marginBottom: 'var(--s1)' }}>Frame size</div>
              <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                {SIZE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn-chip${W === p.w && H === p.h ? ' is-active' : ''}`}
                    onClick={() => setSize(p.w, p.h)}
                  >
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
                  <button
                    key={f}
                    type="button"
                    className={`btn-chip${fps === f ? ' is-active' : ''}`}
                    onClick={() => setFps(f)}
                  >
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
    </div>
  );
}
