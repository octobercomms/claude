/**
 * The composition model: what the new editor is, as data.
 *
 * Replaces the single-track EDL with a multi-track, absolute-time model.
 * The browser edits a composition; the renderer reads it. Both import this
 * file, so they agree by construction.
 *
 * Key differences from edl.mjs:
 *   - `at` is absolute seconds on the timeline, not derived from sequence
 *   - Multiple tracks (video and audio), composited in track order
 *   - Frame size and fps are chosen, not inherited from clip 1
 *   - Transitions are overlaps: two items whose ranges overlap on one track
 *   - Captions, graphics and music are source kinds, not special passes
 *
 * Everything here is pure. No side effects, no I/O.
 */

export const COMP_VERSION = 1;

const EPS = 1e-9;

function secs(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 1e6) / 1e6;
}

let seq = 0;
function nextId(prefix = 'c') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export { secs, EPS };

// ── Source kinds ───────────────────────────────────────────────────────

const SOURCE_KINDS = ['clip', 'design', 'audio', 'captions'];

function validateSource(id, src) {
  if (!src || typeof src !== 'object') {
    return `source "${id}": not an object`;
  }
  if (!SOURCE_KINDS.includes(src.kind)) {
    return `source "${id}": unknown kind "${src.kind}"`;
  }
  if (src.kind === 'clip') {
    if (!src.asset && !src.url) return `source "${id}": clip needs asset or url`;
    if (src.duration != null && (typeof src.duration !== 'number' || src.duration <= 0)) {
      return `source "${id}": clip duration must be positive`;
    }
  }
  if (src.kind === 'audio') {
    if (!src.asset && !src.url) return `source "${id}": audio needs asset or url`;
    if (src.duration != null && (typeof src.duration !== 'number' || src.duration <= 0)) {
      return `source "${id}": audio duration must be positive`;
    }
  }
  if (src.kind === 'design') {
    if (!src.project) return `source "${id}": design needs a project`;
  }
  if (src.kind === 'captions') {
    if (!src.transcript) return `source "${id}": captions needs a transcript`;
  }
  return null;
}

// ── Transition types ──────────────────────────────────────────────────

export const TRANSITION_TYPES = ['fade', 'fadeblack', 'wipeleft', 'dissolve'];

// ── Item validation ───────────────────────────────────────────────────

const FIT_VALUES = ['cover', 'contain'];
const MIN_ITEM = 0.001;

function validateItem(item, sources, trackKind) {
  if (!item || typeof item !== 'object') return 'item is not an object';
  if (typeof item.at !== 'number' || !Number.isFinite(item.at) || item.at < 0) {
    return `item "${item.id}": at must be a non-negative number`;
  }
  if (typeof item.len !== 'number' || !Number.isFinite(item.len) || item.len < MIN_ITEM - EPS) {
    return `item "${item.id}": len must be positive`;
  }
  if (!item.source || !sources[item.source]) {
    return `item "${item.id}": references unknown source "${item.source}"`;
  }
  const src = sources[item.source];
  if (trackKind === 'video' && src.kind === 'audio') {
    return `item "${item.id}": audio source on a video track`;
  }
  if (trackKind === 'audio' && (src.kind === 'clip' || src.kind === 'design')) {
    return `item "${item.id}": video/design source on an audio track`;
  }
  if (item.in != null && (typeof item.in !== 'number' || item.in < 0)) {
    return `item "${item.id}": in must be non-negative`;
  }
  if (item.fit != null && !FIT_VALUES.includes(item.fit)) {
    return `item "${item.id}": fit must be cover or contain`;
  }
  if (item.gain != null && (typeof item.gain !== 'number' || item.gain < 0 || item.gain > 4)) {
    return `item "${item.id}": gain must be 0..4`;
  }
  if (item.opacity != null && (typeof item.opacity !== 'number' || item.opacity < 0 || item.opacity > 1)) {
    return `item "${item.id}": opacity must be 0..1`;
  }
  if (item.trans != null) {
    if (!item.trans.type || !TRANSITION_TYPES.includes(item.trans.type)) {
      return `item "${item.id}": unknown transition type "${item.trans?.type}"`;
    }
  }
  return null;
}

// ── Track validation ──────────────────────────────────────────────────

const TRACK_KINDS = ['video', 'audio'];

function validateTrack(track, sources, allTracks) {
  if (!track || typeof track !== 'object') return 'track is not an object';
  if (!TRACK_KINDS.includes(track.kind)) {
    return `track "${track.id}": unknown kind "${track.kind}"`;
  }
  if (!Array.isArray(track.items)) {
    return `track "${track.id}": items must be an array`;
  }
  if (track.duckUnder != null) {
    if (typeof track.duckUnder !== 'string') {
      return `track "${track.id}": duckUnder must be a track id string`;
    }
    if (allTracks && !allTracks.some(t => t.id === track.duckUnder)) {
      return `track "${track.id}": duckUnder references unknown track "${track.duckUnder}"`;
    }
  }
  for (const item of track.items) {
    const err = validateItem(item, sources, track.kind);
    if (err) return err;
  }
  return null;
}

// ── Composition ───────────────────────────────────────────────────────

export function emptyComposition(opts = {}) {
  return {
    version: COMP_VERSION,
    size: {
      width: opts.width || 1080,
      height: opts.height || 1920,
    },
    fps: opts.fps || 30,
    sources: {},
    tracks: [],
  };
}

export function validate(comp) {
  const errors = [];
  if (!comp || typeof comp !== 'object') return ['not an object'];
  if (comp.version !== COMP_VERSION) {
    errors.push(`unknown version ${comp.version}`);
  }
  if (!comp.size || typeof comp.size.width !== 'number' || typeof comp.size.height !== 'number'
      || comp.size.width < 1 || comp.size.height < 1) {
    errors.push('size must have positive width and height');
  }
  if (typeof comp.fps !== 'number' || comp.fps < 1 || comp.fps > 120) {
    errors.push('fps must be 1..120');
  }
  if (!comp.sources || typeof comp.sources !== 'object') {
    errors.push('sources must be an object');
  } else {
    for (const [id, src] of Object.entries(comp.sources)) {
      const err = validateSource(id, src);
      if (err) errors.push(err);
    }
  }
  if (!Array.isArray(comp.tracks)) {
    errors.push('tracks must be an array');
  } else {
    for (const track of comp.tracks) {
      const err = validateTrack(track, comp.sources || {}, comp.tracks);
      if (err) errors.push(err);
    }
  }
  return errors;
}

export function isValid(comp) {
  return validate(comp).length === 0;
}

// ── Constructors ──────────────────────────────────────────────────────

export function addSource(comp, source) {
  const id = nextId('s');
  return {
    comp: {
      ...comp,
      sources: { ...comp.sources, [id]: { ...source } },
    },
    id,
  };
}

export function addTrack(comp, kind = 'video') {
  const id = nextId('t');
  const track = { id, kind, items: [] };
  return {
    comp: { ...comp, tracks: [...comp.tracks, track] },
    id,
  };
}

export function addItem(comp, trackId, item) {
  const id = item.id || nextId('i');
  const newItem = {
    ...item,
    id,
    at: secs(item.at),
    len: secs(item.len),
  };
  if (newItem.in != null) newItem.in = secs(newItem.in);
  return {
    comp: {
      ...comp,
      tracks: comp.tracks.map(t =>
        t.id === trackId
          ? { ...t, items: [...t.items, newItem].sort((a, b) => a.at - b.at) }
          : t
      ),
    },
    id,
  };
}

export function removeItem(comp, trackId, itemId) {
  return {
    ...comp,
    tracks: comp.tracks.map(t =>
      t.id === trackId
        ? { ...t, items: t.items.filter(i => i.id !== itemId) }
        : t
    ),
  };
}

export function updateItem(comp, trackId, itemId, updates) {
  const cleaned = { ...updates };
  if ('at' in cleaned) cleaned.at = secs(cleaned.at);
  if ('len' in cleaned) cleaned.len = secs(cleaned.len);
  if ('in' in cleaned) cleaned.in = cleaned.in != null ? secs(cleaned.in) : undefined;
  return {
    ...comp,
    tracks: comp.tracks.map(t =>
      t.id === trackId
        ? {
            ...t,
            items: t.items
              .map(i => i.id === itemId ? { ...i, ...cleaned } : i)
              .sort((a, b) => a.at - b.at),
          }
        : t
    ),
  };
}

export function splitItem(comp, trackId, itemId, splitTime) {
  const track = comp.tracks.find(t => t.id === trackId);
  if (!track) return { comp, id: null };
  const item = track.items.find(i => i.id === itemId);
  if (!item) return { comp, id: null };

  const end = itemEnd(item);
  if (splitTime <= item.at + EPS || splitTime >= end - EPS) return { comp, id: null };

  const inPt = item.in || 0;
  const splitOffset = secs(splitTime - item.at);
  const secondId = nextId('i');

  const first = { ...item, len: secs(splitOffset) };
  const second = {
    ...item,
    id: secondId,
    at: secs(splitTime),
    len: secs(end - splitTime),
    in: secs(inPt + splitOffset),
  };
  delete second.trans;

  return {
    comp: {
      ...comp,
      tracks: comp.tracks.map(t =>
        t.id === trackId
          ? { ...t, items: t.items.flatMap(i => i.id === itemId ? [first, second] : [i]) }
          : t
      ),
    },
    id: secondId,
  };
}

export function moveItemToTrack(comp, fromTrackId, itemId, toTrackId) {
  if (fromTrackId === toTrackId) return comp;
  const fromTrack = comp.tracks.find(t => t.id === fromTrackId);
  const toTrack = comp.tracks.find(t => t.id === toTrackId);
  if (!fromTrack || !toTrack) return comp;

  const item = fromTrack.items.find(i => i.id === itemId);
  if (!item) return comp;

  const src = comp.sources[item.source];
  if (toTrack.kind === 'video' && src?.kind === 'audio') return comp;
  if (toTrack.kind === 'audio' && (src?.kind === 'clip' || src?.kind === 'design')) return comp;

  return {
    ...comp,
    tracks: comp.tracks.map(t => {
      if (t.id === fromTrackId) {
        return { ...t, items: t.items.filter(i => i.id !== itemId) };
      }
      if (t.id === toTrackId) {
        return { ...t, items: [...t.items, item].sort((a, b) => a.at - b.at) };
      }
      return t;
    }),
  };
}

export function removeTrack(comp, trackId) {
  return { ...comp, tracks: comp.tracks.filter(t => t.id !== trackId) };
}

export function removeSource(comp, sourceId) {
  const { [sourceId]: _, ...rest } = comp.sources;
  return {
    ...comp,
    sources: rest,
    tracks: comp.tracks.map(t => ({
      ...t,
      items: t.items.filter(i => i.source !== sourceId),
    })),
  };
}

// ── Queries ───────────────────────────────────────────────────────────

export function duration(comp) {
  let end = 0;
  for (const track of comp.tracks) {
    for (const item of track.items) {
      const itemEnd = secs(item.at + item.len);
      if (itemEnd > end) end = itemEnd;
    }
  }
  return end;
}

export function itemEnd(item) {
  return secs(item.at + item.len);
}

export function itemsAt(comp, t) {
  const result = [];
  for (const track of comp.tracks) {
    for (const item of track.items) {
      if (t >= item.at - EPS && t < itemEnd(item) + EPS) {
        result.push({ track, item });
      }
    }
  }
  return result;
}

/**
 * Find overlapping items on a single track. An overlap is a transition:
 * two items whose time ranges overlap on the same track.
 */
export function overlaps(track) {
  const sorted = [...track.items].sort((a, b) => a.at - b.at);
  const result = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aEnd = itemEnd(a);
    if (aEnd > b.at + EPS) {
      result.push({
        items: [a, b],
        from: b.at,
        to: Math.min(aEnd, itemEnd(b)),
        duration: secs(Math.min(aEnd, itemEnd(b)) - b.at),
      });
    }
  }
  return result;
}

/**
 * The topmost item at a given timeline time. Track index 0 is the base;
 * higher indices composite over it, so the last track with coverage wins.
 */
export function topmostAt(comp, t) {
  let best = null;
  for (let ti = 0; ti < comp.tracks.length; ti++) {
    const track = comp.tracks[ti];
    if (track.kind !== 'video') continue;
    for (const item of track.items) {
      if (t >= item.at - EPS && t < itemEnd(item) + EPS) {
        best = { track, item, trackIndex: ti };
      }
    }
  }
  return best;
}

// ── Timeline editing helpers ─────────────────────────────────────────

/**
 * Trim the start of an item. Moves `at` forward by `delta` seconds,
 * adjusts `in` to match, and shortens `len`. Clamps so the item never
 * inverts or goes negative.
 */
export function trimStart(comp, trackId, itemId, delta) {
  return updateItemWith(comp, trackId, itemId, (item) => {
    const d = Math.max(-item.at, Math.min(item.len - MIN_ITEM, delta));
    return {
      at: secs(item.at + d),
      in: secs((item.in || 0) + d),
      len: secs(item.len - d),
    };
  });
}

/**
 * Trim the end of an item. Extends or shortens `len` by `delta` seconds.
 * Clamps so len stays above MIN_ITEM. When the source has a known
 * duration, clamps to available material.
 */
export function trimEnd(comp, trackId, itemId, delta, sourceDuration) {
  return updateItemWith(comp, trackId, itemId, (item) => {
    let newLen = secs(item.len + delta);
    newLen = Math.max(MIN_ITEM, newLen);
    if (sourceDuration != null) {
      const inPt = item.in || 0;
      newLen = Math.min(newLen, secs(sourceDuration - inPt));
    }
    return { len: newLen };
  });
}

/**
 * Move an item to a new absolute timeline position.
 */
export function moveItemTo(comp, trackId, itemId, newAt) {
  return updateItem(comp, trackId, itemId, { at: Math.max(0, secs(newAt)) });
}

function updateItemWith(comp, trackId, itemId, fn) {
  const track = comp.tracks.find(t => t.id === trackId);
  if (!track) return comp;
  const item = track.items.find(i => i.id === itemId);
  if (!item) return comp;
  const updates = fn(item);
  return updateItem(comp, trackId, itemId, updates);
}
