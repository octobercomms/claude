/**
 * Peaks: turning a decoded audio channel into something drawable, and slicing
 * it to a block. Pure, and in its own import-free file so it can be
 * unit-tested without a browser.
 *
 * You cut on speech, so this is not decoration. Without it a trim lands in the
 * middle of a word and you only find out on playback. What the drawing has to
 * be right about is *where* a loud moment is: a waveform offset from the
 * footage is worse than none, because it moves the cut confidently to the
 * wrong place.
 */

// Peaks per clip, held once and resampled per block. 1600 is about four
// columns per pixel on a 400px block, which survives zooming in a long way
// before the drawing goes soft, and costs 6KB a clip.
export const CLIP_BUCKETS = 1600;

/**
 * Reduce a decoded mono channel to `buckets` peak magnitudes.
 *
 * Peak, not average. An average over a few thousand samples of speech trends
 * towards silence and draws a flat line through the middle of a sentence; the
 * loudest sample in each bucket is what shows you where the words are.
 */
export function peaksFromChannel(samples, buckets = CLIP_BUCKETS) {
  const n = samples?.length || 0;
  const want = Math.max(1, Math.trunc(buckets));
  if (!n) return [];
  const out = new Array(want);
  // Walked with a float stride and rounded per bucket rather than with an
  // integer step: an integer step leaves the tail of the clip unread whenever
  // the length is not a multiple of the bucket count, which silently drops the
  // end of every clip that is not a round length.
  const stride = n / want;
  for (let i = 0; i < want; i++) {
    const from = Math.floor(i * stride);
    const to = Math.min(n, Math.max(from + 1, Math.floor((i + 1) * stride)));
    let peak = 0;
    for (let k = from; k < to; k++) {
      const v = samples[k] < 0 ? -samples[k] : samples[k];
      if (v > peak) peak = v;
    }
    out[i] = peak > 1 ? 1 : peak;
  }
  return out;
}

/**
 * The peaks for one block, resampled to `columns` bars.
 *
 * `wave` is `{ peaks, duration }` for the whole source clip. A block shows
 * [in, out] of that clip, so this is the same idea as the filmstrip's
 * placement: one set of peaks per clip serves every block over it, and a trim,
 * a split or a reorder re-slices rather than re-decoding.
 */
export function peaksForBlock(wave, inPoint, outPoint, columns = 120) {
  const peaks = Array.isArray(wave?.peaks) ? wave.peaks : [];
  const duration = Number(wave?.duration);
  const cols = Math.max(1, Math.trunc(columns));
  if (!peaks.length || !Number.isFinite(duration) || duration <= 0) return [];

  const a = inPoint == null ? 0 : Number(inPoint);
  const b = Number(outPoint);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return [];

  // Where in the peak array the block begins and ends. Clamped because a
  // stored edit can out-live the clip it was measured against. The clamp on
  // `from` is explicitness rather than behaviour: a block starting past the
  // end of the clip reads past the array, and an out-of-range read gives
  // undefined, which loses every comparison and draws silence either way. It
  // stays so the intent is on the page and so a future Float32Array here does
  // not depend on that accident.
  const perSecond = peaks.length / duration;
  const from = Math.max(0, Math.min(peaks.length - 1, a * perSecond));
  const to = Math.max(from + 1, Math.min(peaks.length, b * perSecond));
  const span = to - from;

  const out = new Array(cols);
  for (let i = 0; i < cols; i++) {
    const lo = Math.floor(from + (i / cols) * span);
    const hi = Math.min(peaks.length, Math.max(lo + 1, Math.floor(from + ((i + 1) / cols) * span)));
    let peak = 0;
    for (let k = lo; k < hi; k++) {
      const v = peaks[k];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

// The quietest level drawn, in dBFS. Below this a column is silence.
// Speech sits between about -12 and -25 dBFS once it has been through a codec,
// and room tone around -50, so -60 puts the words high in the strip and still
// shows the difference between a quiet room and true silence.
export const FLOOR_DB = -60;

/**
 * A peak's drawn height, 0 to 1, on a decibel scale.
 *
 * Not linear, and this is the difference between a waveform and a flat line.
 * A sine tone through AAC measures about -18 dBFS, which is 0.13 of full
 * scale: drawn linearly that is a one-pixel bar in a sixteen-pixel strip, and
 * actual speech is quieter still. Every editor draws audio in decibels for
 * this reason. Linear peaks are kept as the data, because that is what was
 * measured; the curve belongs to the drawing.
 */
export function heightOf(peak) {
  const v = Number(peak);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const clamped = v > 1 ? 1 : v;
  const db = 20 * Math.log10(clamped);
  if (db <= FLOOR_DB) return 0;
  return Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
}

/**
 * An SVG path for a set of columns, drawn as a centred waveform inside a box
 * `width` by `height`. One path node per block rather than a div per column:
 * a hundred and twenty divs per block, times a dozen blocks, is a layout cost
 * paid on every drag.
 *
 * Returns an empty string for nothing to draw, so the caller can leave the
 * element out rather than render an empty `<path>`.
 */
export function peaksPath(columns, width = 100, height = 20) {
  const cols = Array.isArray(columns) ? columns : [];
  if (!cols.length || !(width > 0) || !(height > 0)) return '';
  const mid = height / 2;
  const step = width / cols.length;
  // A floor of half a pixel, so silence is a visible line rather than a gap:
  // a waveform that disappears where the audio is quiet looks like a waveform
  // that failed to load.
  const parts = [];
  for (let i = 0; i < cols.length; i++) {
    const h = Math.max(0.5, heightOf(cols[i]) * mid);
    const x = +(i * step).toFixed(2);
    const w = +Math.max(step * 0.7, 0.5).toFixed(2);
    parts.push(`M${x} ${+(mid - h).toFixed(2)}h${w}v${+(h * 2).toFixed(2)}h${-w}Z`);
  }
  return parts.join('');
}
