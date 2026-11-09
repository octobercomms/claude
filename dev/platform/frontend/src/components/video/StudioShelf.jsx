// Where material enters the Studio.
//
// Before this there was no way to put anything OMI already owns into a
// composition. Not an awkward path: none. `+ Add clip` read local disk,
// `+ Add design` took design pages, and the b-roll picker filled planned
// cutaway slots. A screen recording made inside OMI could not come back in at
// all.
//
// A full-width strip under the player rather than a column beside it, and the
// reason is a measurement. The composition is 9:16 and the stage's player cell
// is 284px wide at 1440px, which is a normal laptop. Put the mockup's 240px
// bin beside it and the player cell becomes 28px: the bin would have destroyed
// the only thing on the screen being judged. Across the bottom it is 600px at
// 1440 and it sits next to the timeline, which is where the material is going.
//
// Two scopes, not two components. "In this reel" is the composition's own
// sources, already in memory, and it is the default because it is the only
// surface that makes a project's contents visible — it gives you back a clip
// you already trimmed, and it is where a recording made here lands. "All
// footage" is the client's library.

import React, { useMemo, useState } from 'react';
import AssetLibrary from '../AssetLibrary';

const LINE = 'var(--border-w) solid var(--card-border)';

function Tile({ label, sub, badge, url, kind, onClick }) {
  return (
    <div role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ flex: '0 0 96px', width: 96, cursor: 'pointer' }}>
      <div style={{
        aspectRatio: '1 / 1', borderRadius: 'var(--r-sm)', border: LINE,
        background: 'var(--surface-sunken, #141414)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {kind === 'image' && url
          ? <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : kind === 'video' && url
            ? <video src={url} muted playsInline preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
              {kind === 'audio' ? 'Audio' : kind === 'design' ? 'Design' : 'Clip'}
            </span>}
        {/* How many times this source is already on the timeline. A count
            rather than a disabled state: reusing a clip for b-roll is normal,
            and a picker that silently no-ops on an already-added item reads as
            a broken click. */}
        {badge > 0 && (
          <span style={{
            position: 'absolute', top: 3, right: 3,
            background: 'var(--accent)', color: 'var(--on-accent, #1a1a1a)',
            borderRadius: 'var(--r-pill)', padding: '0 6px',
            fontSize: 10, fontWeight: 700, lineHeight: '16px',
          }}>{badge}</span>
        )}
      </div>
      {/* The name, and nothing under it. A second line saying "2 on the
          timeline" repeats the badge in the corner and costs every tile 14px,
          which on a strip is 14px of the whole strip. */}
      <div title={sub} style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, marginTop: 3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

export default function StudioShelf({
  composition, clientId, sourceUrls = {}, sourceNames = {},
  onPickAsset, onPickSource, onAddFiles, uploading = false, refreshKey = 0,
}) {
  const [scope, setScope] = useState('reel');

  // How many items use each source, for the count badge.
  const uses = useMemo(() => {
    const n = {};
    for (const t of composition?.tracks || []) {
      for (const it of t.items) n[it.source] = (n[it.source] || 0) + 1;
    }
    return n;
  }, [composition]);

  const sources = Object.entries(composition?.sources || {});

  return (
    <div className="card" data-studio-shelf
      style={{ padding: 'var(--s3)', marginTop: 'var(--s3)' }}>
      <div className="row center" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 'var(--s1)' }}>
          <button type="button" className={`btn-chip${scope === 'reel' ? ' is-active' : ''}`}
            onClick={() => setScope('reel')}>In this reel</button>
          <button type="button" className={`btn-chip${scope === 'library' ? ' is-active' : ''}`}
            onClick={() => setScope('library')}>All footage</button>
        </div>
        {/* One door for files. `+ Add clip`, `+ Add music` and `+ Add design`
            used to be three buttons in the inspector, which is the two-doors
            problem this codebase keeps finding; the shelf decides what a file
            is from its mime type, which `isStillMime` and `CLIP_ACCEPT`
            already do. */}
        <button type="button" className="btn btn-secondary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={onAddFiles} disabled={uploading}>
          {uploading ? 'Adding…' : 'Add files'}
        </button>
      </div>

      {scope === 'reel' ? (
        sources.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)',
            marginTop: 'var(--s2)', padding: 'var(--s3) 0' }}>
            Nothing in this reel yet. Drop footage or photographs anywhere on this
            page, add files above, or take something from All footage.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)',
            overflowX: 'auto', overflowY: 'hidden', paddingBottom: 'var(--s1)' }}>
            {sources.map(([sid, src]) => (
              <Tile key={sid}
                label={sourceNames[sid] || sid}
                sub={uses[sid] ? `${uses[sid]} on the timeline` : 'not used'}
                badge={uses[sid] || 0}
                url={sourceUrls[sid]}
                kind={src.kind === 'clip' ? (src.still ? 'image' : 'video') : src.kind}
                onClick={() => onPickSource(sid)} />
            ))}
          </div>
        )
      ) : (
        <AssetLibrary clientId={clientId} compact filters={false} layout="strip"
          title="" refreshKey={refreshKey} onPick={onPickAsset} />
      )}
    </div>
  );
}
