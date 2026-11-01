import { useEffect, useRef, useState } from 'react';
import { peaksFromChannel, CLIP_BUCKETS } from './waveformPeaks';

/**
 * Audio peaks for a clip, decoded in the browser.
 *
 * **Why not on the server, since the spec said so.** Two reasons, and the
 * second is the one that decides it.
 *
 * ffmpeg does this far more cheaply than a browser: `-ac 1 -ar 8000 -f f32le`
 * is 32KB a second of audio, so a twenty-minute recording streams 38MB and
 * buckets down to a few kilobytes. `silenceCut.js` already does something
 * adjacent. If the clips were on the server this would be the obvious answer.
 *
 * They are not. A clip on the Edit page is a local `File` with a `blob:` URL
 * from the moment it is dropped and does not reach the server until Render is
 * pressed, which is the same wall the filmstrip hit. A waveform that appears
 * only after you have finished cutting is a waveform for a job you have
 * already done.
 *
 * **What the browser route costs, stated rather than buried.**
 * `decodeAudioData` needs the whole file as an ArrayBuffer, and it decodes the
 * audio track in full. Decoding into an `OfflineAudioContext` at 8kHz mono
 * resamples on the way in, which brings twenty minutes down to about 38MB of
 * transient float data instead of nearly half a gigabyte. The file read is the
 * part that cannot be made cheap, so there is a ceiling: above it the waveform
 * is skipped and the block says so. Reading a two-gigabyte upload into an
 * ArrayBuffer would take the tab down, and losing the edit is a worse outcome
 * than not drawing the audio.
 */

// 8kHz is well above what a peak drawing needs (we keep 1600 buckets for a
// whole clip regardless) and is the lowest rate every browser will resample to
// without complaint.
const DECODE_RATE = 8000;

// The ceiling. A 1080p phone clip runs 10 to 20 Mbps, so a 90-second reel is
// 100 to 250MB and a minute of screen capture rather less. 300MB therefore
// covers every reel and short clip, and excludes the long screen recordings
// where the read itself is the risk. Stated on the block when it bites, so the
// absence is explained rather than looking like a failure.
export const MAX_DECODE_BYTES = 300 * 1024 * 1024;

/**
 * Does this media have an audio track at all? `true`, `false`, or `null` when
 * the browser will not say.
 *
 * This exists because `decodeAudioData` cannot tell the difference. An mp4
 * with no audio track throws `EncodingError: Unable to decode audio data`,
 * which is the identical error a codec it cannot read throws. Without a second
 * signal, a screen recording made with no microphone, which is an ordinary
 * thing to edit, gets reported as "audio could not be read" and sends the
 * operator looking for a fault that is not there.
 *
 * `captureStream()` on a loaded video element answers it: zero audio tracks
 * for a silent file, one for a file with sound. Chromium and Firefox have it
 * (Firefox as `mozCaptureStream`), Safari does not, which is what `null` is
 * for: there the wording covers both cases rather than picking one.
 *
 * Probing first also saves reading a whole file into memory to decode audio
 * that is not there.
 */
export async function probeAudioTrack(url) {
  if (!url || typeof document === 'undefined') return null;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      const done = (fn) => () => { clearTimeout(timer); fn(); };
      video.addEventListener('loadeddata', done(resolve), { once: true });
      video.addEventListener('error', done(() => reject(new Error('load'))), { once: true });
    });
    const capture = video.captureStream || video.mozCaptureStream;
    if (typeof capture !== 'function') return null;
    const stream = capture.call(video);
    const tracks = stream.getAudioTracks();
    // Stop what was opened: a live capture holds the decoder open, and a dozen
    // of them across a dozen clips is a dozen decoders that never close.
    for (const t of stream.getTracks()) t.stop();
    return tracks.length > 0;
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export async function decodePeaks(clip, { buckets = CLIP_BUCKETS } = {}) {
  const AC = typeof window !== 'undefined'
    && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!AC) return { peaks: [], duration: 0, state: 'unsupported' };

  // Ask whether there is any audio before reading the file for it.
  const hasTrack = await probeAudioTrack(clip?.url);
  if (hasTrack === false) return { peaks: [], duration: 0, state: 'silent' };
  // `null` means the browser would not say, so a decode failure below cannot
  // be blamed on the codec with any confidence.
  const onFailure = hasTrack === true ? 'failed' : 'unknown';

  try {
    if (clip?.file) {
      if (clip.file.size > MAX_DECODE_BYTES) {
        return { peaks: [], duration: 0, state: 'too-big' };
      }
      return await decodeBuffer(AC, await clip.file.arrayBuffer(), buckets, onFailure);
    }
    if (clip?.url) {
      const res = await fetch(clip.url);
      if (!res.ok) return { peaks: [], duration: 0, state: 'failed' };
      const len = Number(res.headers.get('content-length'));
      // A remote clip may not declare its length, in which case the ceiling
      // cannot be checked before the body is read. Checking it afterwards is
      // not a protection, so an undeclared length is allowed through: these
      // are OMI's own stored renders, not arbitrary uploads.
      if (Number.isFinite(len) && len > MAX_DECODE_BYTES) {
        return { peaks: [], duration: 0, state: 'too-big' };
      }
      return await decodeBuffer(AC, await res.arrayBuffer(), buckets, onFailure);
    }
  } catch {
    return { peaks: [], duration: 0, state: onFailure };
  }
  return { peaks: [], duration: 0, state: 'failed' };
}

async function decodeBuffer(AC, buf, buckets, onFailure = 'failed') {
  try {
    // One sample frame is enough to construct the context: it is only being
    // used for its decoder and its sample rate, never to render anything.
    const ctx = new AC(1, 1, DECODE_RATE);
    const audio = await ctx.decodeAudioData(buf);
    if (!audio || !audio.numberOfChannels) {
      // A video with no audio track. Not a failure: it is a silent clip, and
      // saying so is more use than an empty strip that might be either.
      return { peaks: [], duration: 0, state: 'silent' };
    }
    const channel = audio.getChannelData(0);
    const peaks = peaksFromChannel(channel, buckets);
    const loudest = peaks.reduce((m, v) => (v > m ? v : m), 0);
    return {
      peaks,
      duration: audio.duration,
      // Decoded, but nothing in it. Worth distinguishing from a failure for
      // the same reason: silence is information when you are placing a cut.
      state: loudest > 0.001 ? 'done' : 'silent',
    };
  } catch {
    // An mp4 with no audio and a codec this browser cannot read throw the same
    // EncodingError, so which of the two this was comes from the track probe
    // rather than from here.
    return { peaks: [], duration: 0, state: onFailure };
  }
}

/**
 * Peaks for a list of clips, one at a time, cached by clip id.
 *
 * Same shape as `useFilmstrips`, and for the same reasons: keyed on the clip
 * **ids** rather than the clips array, because the page replaces that array
 * whenever a duration lands; and one pump for the life of the component that
 * takes another pass when the list changes, rather than a loop per effect run
 * with a mutex, which deadlocks the moment a teardown lands on a held mutex.
 *
 * Deliberately started after a tick, so the filmstrip's seeks get the main
 * thread first. The strip is what makes the timeline readable at a glance; the
 * waveform is what makes a cut land on a word, and it is wanted a moment
 * later than the strip is.
 */
export function useWaveforms(clips) {
  const [waves, setWaves] = useState({});
  const cache = useRef(new Map());
  const latest = useRef([]);
  const pumping = useRef(false);
  const again = useRef(false);
  const dead = useRef(false);

  latest.current = Array.isArray(clips) ? clips : [];
  const key = latest.current.map((c) => c?.id).join('|');

  useEffect(() => () => { dead.current = true; }, []);

  useEffect(() => {
    const publish = () => setWaves(Object.fromEntries(cache.current));

    const live = new Set(latest.current.map((c) => c?.id));
    let dropped = false;
    for (const id of [...cache.current.keys()]) {
      if (!live.has(id)) { cache.current.delete(id); dropped = true; }
    }

    async function pump() {
      if (pumping.current) { again.current = true; return; }
      pumping.current = true;
      try {
        do {
          again.current = false;
          for (const clip of latest.current) {
            if (dead.current) return;
            if (!clip?.id) continue;
            if (!clip.file && !clip.url) continue;
            if (cache.current.has(clip.id)) continue;
            cache.current.set(clip.id, { peaks: [], duration: 0, state: 'working' });
            publish();
            const wave = await decodePeaks(clip);
            if (dead.current) return;
            if (!latest.current.some((c) => c?.id === clip.id)) {
              cache.current.delete(clip.id);
            } else {
              cache.current.set(clip.id, wave);
            }
            publish();
          }
        } while (again.current && !dead.current);
      } finally {
        pumping.current = false;
      }
    }

    if (dropped) publish();
    // One tick behind the filmstrip, which is started from its own effect in
    // the same render.
    const t = setTimeout(pump, 0);
    return () => clearTimeout(t);
  }, [key]);

  return waves;
}
