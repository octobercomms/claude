import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';

/**
 * Everything October has made for one client.
 *
 * Two jobs in one component, because they are the same screen with a different
 * ending. As a browser it is the answer to "what do we already have". As a
 * picker it hands an asset back to whatever asked, which is what lets Shared
 * schedule something that already exists instead of producing it again.
 *
 * Nothing here creates an asset. A row in the library is a claim that something
 * exists, and only the thing that made it is entitled to make that claim.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

const KINDS = [
  { key: null, label: 'Everything' },
  { key: 'video', label: 'Video' },
  { key: 'image', label: 'Image' },
  { key: 'audio', label: 'Audio' },
];

// Where a thing came from, in words an account manager uses rather than the
// table name it happens to live in.
const SOURCE_LABEL = {
  recording: 'Recorded',
  video_project: 'Edited',
  social_media: 'Made for a post',
  ad_creative: 'Ad creative',
  design: 'Designed',
  caption_render: 'Captioned',
  scene_render: 'Scene template',
  upload: 'Uploaded',
};

function human(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function duration(s) {
  if (s == null) return '';
  const t = Math.round(Number(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function Thumb({ asset }) {
  const box = {
    aspectRatio: '1 / 1', borderRadius: 'var(--r-sm)', border: LINE,
    background: 'var(--surface-sunken, #141414)', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  // Only a url can be shown inline. A storage key needs the media store to
  // resolve it, which is a request this grid should not be making for every
  // tile, so those get a label instead of a broken image.
  if (asset.kind === 'image' && asset.url) {
    return (
      <div style={box}>
        <img src={asset.url} alt={asset.title || 'Asset'} loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  if (asset.kind === 'video' && asset.url) {
    return (
      <div style={box}>
        <video src={asset.url} muted playsInline preload="metadata"
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.5; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{ ...box, flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 22 }}>{asset.kind === 'audio' ? '♪' : '▦'}</span>
      <span style={CAP}>{asset.kind}</span>
    </div>
  );
}

export default function AssetLibrary({ clientId, onPick = null, kind: fixedKind = null,
  title = 'Asset library', compact = false, refreshKey = 0 }) {
  const [data, setData] = useState({ assets: [], counts: {}, sources: [] });
  const [kind, setKind] = useState(fixedKind);
  const [source, setSource] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (source) q.set('source', source);
    if (search.trim()) q.set('search', search.trim());
    api.get(`/clients/${clientId}/assets?${q}`)
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // refreshKey is how a caller that has just made an asset says so. Without
    // it a grid that filters on its own state never reloads, and the thing the
    // operator produced a second ago is missing from the list of what exists.
  }, [clientId, kind, source, search, refreshKey]);

  const counts = data.counts || {};
  const shown = data.assets || [];
  const sources = useMemo(() => data.sources || [], [data.sources]);

  if (error) return <div style={{ ...CAP, color: 'var(--negative)' }}>{error}</div>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>
          {title}
          {counts.total ? <span style={{ ...CAP, marginLeft: 8 }}>{counts.total} items</span> : null}
        </span>
        <input className="input" style={{ width: 200 }} placeholder="Search titles…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
        {!fixedKind && KINDS.map((k) => (
          <button key={k.label} type="button" className={`chip${kind === k.key ? ' chip-active' : ''}`}
            onClick={() => setKind(k.key)}
            style={{ cursor: 'pointer', border: LINE,
              background: kind === k.key ? 'var(--accent-soft)' : 'transparent' }}>
            {k.label}{k.key && counts[k.key] ? ` ${counts[k.key]}` : ''}
          </button>
        ))}
        {/* Only the sources this client actually has, rather than a list of
            eight mostly-empty options. */}
        {sources.length > 1 && (
          <select className="input" style={{ width: 'auto' }} value={source || ''}
            onChange={(e) => setSource(e.target.value || null)}>
            <option value="">Any source</option>
            {sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>)}
          </select>
        )}
      </div>

      {loading && !shown.length ? (
        <div style={{ ...CAP, marginTop: 'var(--s3)' }}>Loading…</div>
      ) : !shown.length ? (
        <div style={{ ...CAP, marginTop: 'var(--s3)', lineHeight: 1.5 }}>
          {search || kind || source
            ? 'Nothing matches those filters.'
            : 'Nothing here yet. Anything made in Produce, or produced against a social post, '
              + 'lands here on its own.'}
        </div>
      ) : (
        <div style={{
          display: 'grid', marginTop: 'var(--s3)',
          gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 110 : 150}px, 1fr))`,
          gap: 'var(--s2)',
        }}>
          {shown.map((a) => {
            const pickable = !!onPick;
            return (
              <div key={a.id} role={pickable ? 'button' : undefined} tabIndex={pickable ? 0 : undefined}
                onClick={pickable ? () => onPick(a) : undefined}
                onKeyDown={pickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(a); }
                } : undefined}
                style={{ cursor: pickable ? 'pointer' : 'default' }}>
                <Thumb asset={a} />
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, marginTop: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.title || 'Untitled'}
                </div>
                <div style={{ ...CAP, lineHeight: 1.35 }}>
                  {SOURCE_LABEL[a.source] || a.source}
                  {a.duration_s ? ` · ${duration(a.duration_s)}` : ''}
                  {a.bytes ? ` · ${human(Number(a.bytes))}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
