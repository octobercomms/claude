import { useEffect, useRef, useState } from 'react';

/**
 * Stills along a clip, pulled out in the browser.
 *
 * The spec put this on the server: "ffmpeg extracts them at an interval on
 * upload; the front end places them." That does not work, and the reason is
 * worth writing down. On the Edit page a clip is a local `File` with a
 * `blob:` URL from the moment it is dropped, and it does not reach the server
 * until Render is pressed. Server-side extraction would therefore leave the
 * timeline blank for exactly as long as the timeline is being used, and would
 * only fill in for a job reopened later. The filmstrip is most of what makes a
 * timeline feel like one, so it has to be there while the edit is being made.
 *
 * A browser can do it: seek a `<video>`, draw the frame to a canvas, keep the
 * JPEG. Thumbnails are the one part of a timeline that does not need frame
 * accuracy, so seeking to a keyframe instead of a frame costs nothing here,
 * which is the whole reason this is cheap when the preview is not.
 *
 * What it costs: decode time on the main thread, in bursts of one frame. The
 * mitigations are a small fixed count per clip, a short height, sequential
 * extraction so several clips do not fight, and a cache keyed on the clip so
 * nothing is decoded twice. A clip that will not decode gives up silently and
 * the block stays plain, which is how it looked before.
 */

export const THUMB_COUNT = 12;
export const THUMB_HEIGHT = 44;      // CSS pixels; the block is 64 tall

// One seek can hang (a codec the browser half-supports, a blob that went away
// when the person removed the clip). Without a ceiling the whole strip waits
// on it and no clip after this one is ever drawn.
const SEEK_TIMEOUT_MS = 2500;
const LOAD_TIMEOUT_MS = 8000;

function once(el, event, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`${event} timed out`));
    }, ms);
    function onEvent() { if (done) return; done = true; cleanup(); resolve(); }
    function onError() {
      if (done) return;
      done = true; cleanup(); reject(new Error(`${event} failed`));
    }
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(event, onEvent);
      el.removeEventListener('error', onError);
    }
    el.addEventListener(event, onEvent);
    el.addEventListener('error', onError);
  });
}

/**
 * Pull `count` stills out of one video, evenly spaced. Each is sampled at the
 * MIDDLE of its slice rather than at the start: a still taken at exactly 0 is
 * often a black frame from a fade-in, and a strip that opens with black reads
 * as a broken clip.
 *
 * Resolves with whatever it managed to get, in order, so a clip that fails
 * halfway still shows the half it has. Never throws.
 */
export async function extractThumbs(url, { count = THUMB_COUNT, height = THUMB_HEIGHT, cancelled } = {}) {
  if (!url || typeof document === 'undefined') return [];
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;

  const out = [];
  try {
    await once(video, 'loadeddata', LOAD_TIMEOUT_MS);
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return [];
    const drawH = height * 2;                      // 2x for a sharp strip
    const drawW = Math.max(1, Math.round((w / h) * drawH));

    const canvas = document.createElement('canvas');
    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    for (let k = 0; k < count; k++) {
      if (cancelled?.()) break;
      const t = duration * ((k + 0.5) / count);
      try {
        video.currentTime = t;
        await once(video, 'seeked', SEEK_TIMEOUT_MS);
        ctx.drawImage(video, 0, 0, drawW, drawH);
        // A tainted canvas throws here rather than returning nothing, which is
        // how a cross-origin clip announces itself.
        out.push({ t, src: canvas.toDataURL('image/jpeg', 0.55) });
      } catch {
        break;     // one bad seek means the rest will be bad too
      }
    }
  } catch {
    // Metadata never arrived, or the source is not decodable here.
  } finally {
    video.removeAttribute('src');
    video.load();
  }
  return out;
}

/**
 * Filmstrips for a list of clips, built one clip at a time and cached by clip
 * id. Returns `{ [clipId]: { thumbs, duration, state } }` where state is
 * 'working' | 'done' | 'failed', so a block can say which it is rather than
 * leaving the operator wondering whether the strip is coming.
 *
 * Sequential on purpose. Twelve parallel decodes across four clips makes the
 * page stutter while the person is trying to drag a block, and the strip is a
 * convenience: it must never compete with the edit for the main thread.
 */
export function useFilmstrips(clips, { count = THUMB_COUNT } = {}) {
  const [strips, setStrips] = useState({});
  const cache = useRef(new Map());
  const latest = useRef([]);
  const pumping = useRef(false);
  const again = useRef(false);
  const dead = useRef(false);

  latest.current = Array.isArray(clips) ? clips : [];

  // Keyed on which clips there are, not on the array's identity: the page
  // replaces the clips array whenever a duration lands from the browser's
  // metadata probe, which is within a second of every upload.
  const key = latest.current.map((c) => c?.id).join('|');

  useEffect(() => () => { dead.current = true; }, []);

  useEffect(() => {
    const publish = () => setStrips(Object.fromEntries(cache.current));

    // Clips that have gone lose their cache entry. A memory measure, not a
    // correctness one: every clip gets a fresh id, so a re-added file could
    // never be served another clip's frames. What it prevents is a session of
    // swapping clips in and out holding a strip of base64 JPEGs for every file
    // ever dropped on the page.
    const live = new Set(latest.current.map((c) => c?.id));
    let dropped = false;
    for (const id of [...cache.current.keys()]) {
      if (!live.has(id)) { cache.current.delete(id); dropped = true; }
    }

    // One pump for the life of the component, rather than one loop per effect
    // run. The first attempt used a "running" ref as a mutex and tore the loop
    // down whenever the clip list changed, which deadlocked: adding a second
    // file cancelled the loop reading the first, and the replacement loop saw
    // the mutex still held by the loop that had not finished unwinding, so it
    // returned and nothing was ever read again. Both blocks then said "reading
    // frames" for the rest of the session.
    //
    // So: a clip list change asks the pump to take another pass rather than
    // replacing it. The pump reads `latest.current` each pass, so it picks up
    // clips added while it was working, and nothing is decoded twice because
    // the cache entry goes in before the await.
    async function pump() {
      if (pumping.current) { again.current = true; return; }
      pumping.current = true;
      try {
        do {
          again.current = false;
          for (const clip of latest.current) {
            if (dead.current) return;
            if (!clip?.id || !clip.url) continue;
            // Already read, or being read. Bounded work saved rather than a
            // correctness guard: without it a second pass re-decodes clips it
            // has already done and arrives at the same frames, so it costs
            // decode time and shows nothing. Kept because the pump will take
            // more passes as more is hung off it, not because anything
            // currently observable depends on it.
            if (cache.current.has(clip.id)) continue;
            cache.current.set(clip.id, { thumbs: [], state: 'working' });
            publish();
            const thumbs = await extractThumbs(clip.url, {
              count, cancelled: () => dead.current,
            });
            if (dead.current) return;
            // The clip may have been removed while it was being read, in which
            // case its entry was just purged and must not come back.
            if (!latest.current.some((c) => c?.id === clip.id)) {
              cache.current.delete(clip.id);
            } else {
              cache.current.set(clip.id, {
                thumbs, state: thumbs.length ? 'done' : 'failed',
              });
            }
            publish();
          }
        } while (again.current && !dead.current);
      } finally {
        pumping.current = false;
      }
    }

    if (dropped) publish();
    pump();
  }, [key, count]);

  return strips;
}

// The placement arithmetic lives in its own import-free module so it can be
// unit-tested without a browser; re-exported here so a caller needs one import.
export { thumbsForBlock } from './filmstripPlace';
