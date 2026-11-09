// The media bin: where material enters the Studio.
//
// Before this there was no way to put anything OMI already owns into a
// composition. Not an awkward path: none. `+ Add clip` read local disk,
// `+ Add design` took design pages, and the b-roll picker filled planned
// cutaway slots. A screen recording made inside OMI could not come back in at
// all.
//
// A 240px COLUMN on the left, which is where the mockup has it, and this was
// refused twice on a measurement that has since been retracted.
//
// The argument against it was: the stage's player cell is 284px at 1440px, so
// a 240px bin beside it leaves 28px of picture. True of the page it was
// measured on, which was a tall scrolling document in which the picture was
// bounded by its WIDTH. The Studio fills the window now and the picture is
// bounded by the HEIGHT of its row. Measured: narrowing the stage column from
// 1008px to 748px leaves the picture at 220x391, identical, and at 1600x1000
// there is 892px of empty black beside a 278px picture.
//
// So the bin is free and the strip was not. As a full-width row under the
// timeline this cost the picture 199px of HEIGHT, which is the one dimension
// that comes straight off the only thing on the screen being judged. The rule
// for this screen: 2.4x of headroom horizontally, none vertically.
//
// Two scopes, not two components, and that is a departure the mockup does not
// make. "In this reel" is the composition's own sources, already in memory,
// and it is the default because it is the only surface that makes a project's
// contents visible.
//
// "In this reel" gives you back a clip you already trimmed and is where a
// recording made here lands. "All footage" is the client's library.

import React, { useMemo, useState } from 'react';
import AssetLibrary from '../AssetLibrary';

const LINE = 'var(--border-w) solid var(--card-border)';

function Tile({ label, sub, badge, url, kind, onClick }) {
  return (
    <div role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{ cursor: 'pointer', minWidth: 0 }}>
      <div style={{
        /* 16:9, as the mockup's thumbs are, and not the square the strip
           used. A square tile of a 9:16 reel is mostly letterbox; the point
           of the picture is to be recognised at a glance, and the landscape
           crop gives the recognisable part more pixels per row of bin. */
        aspectRatio: '16 / 9', borderRadius: 'var(--r-sm)', border: LINE,
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

export default function StudioBin({
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
    <div className="card studio-bin" data-studio-bin style={{ padding: 'var(--s3)' }}>
      {/* The chrome is two rows and both of them earn it. The scopes stack
          above the door rather than sharing a line, because at 240px the two
          chips and the button together overflow and a wrapped button looks
          like a mistake. */}
      <div className="row" style={{ gap: 'var(--s1)', flexShrink: 0 }}>
        <button type="button" className={`btn-chip${scope === 'reel' ? ' is-active' : ''}`}
          onClick={() => setScope('reel')}>In this reel</button>
        <button type="button" className={`btn-chip${scope === 'library' ? ' is-active' : ''}`}
          onClick={() => setScope('library')}>All footage</button>
      </div>
      {/* One door for files. `+ Add clip`, `+ Add music` and `+ Add design`
          used to be three buttons in the inspector, which is the two-doors
          problem this codebase keeps finding; the bin decides what a file is
          from its mime type, which `isStillMime` and `CLIP_ACCEPT` already
          do. */}
      <button type="button" className="btn btn-secondary btn-sm"
        style={{ marginTop: 'var(--s2)', width: '100%', flexShrink: 0 }}
        onClick={onAddFiles} disabled={uploading}>
        {uploading ? 'Adding…' : 'Add files'}
      </button>

      {/* The one part that scrolls. `minHeight: 0` is what lets it: without
          it a flex child refuses to shrink below its content and the bin
          grows until the column does, which on this screen means the page
          does. */}
      <div className="studio-bin-body" style={{ minHeight: 0, flex: 1, overflowY: 'auto', marginTop: 'var(--s2)' }}>
        {scope === 'reel' ? (
          sources.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)',
              padding: 'var(--s2) 0' }}>
              Nothing in this reel yet. Drop footage or photographs anywhere on
              this page, add files above, or take something from All footage.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--s2)' }}>
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
          // Filters on, which they were not on the strip, and the reason has
          // reversed with the shape. Two rows of chips cost 110px of a 130px
          // strip — most of the thing they sat above. In a column that is the
          // height of the picture they cost two rows of tiles, and the mockup
          // puts search and type filters at the top of its bin because that
          // is how you find one file among a client's whole library.
          <AssetLibrary clientId={clientId} compact filters layout="grid" minTile={100}
            title="" refreshKey={refreshKey} onPick={onPickAsset} />
        )}
      </div>
    </div>
  );
}
