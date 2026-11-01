/**
 * Text over time: a line that appears at 00:03, leaves at 00:06, and sits
 * where you put it.
 *
 * Not the same thing as the caption burn-in, which shares the word "text" and
 * nothing else: captions are whole-video, template-driven and generated from a
 * transcript. These are hand-placed, individually timed, and there may be
 * several at once.
 *
 * **Built as ASS subtitles, not `drawtext`.** The caption pipeline already
 * burns ASS reliably through ffmpeg's `subtitles=` filter, ASS has absolute
 * positioning and per-event timing natively, and its escaping rules are
 * narrow enough to state exactly (see `escapeAss`). `drawtext` would mean a
 * second text mechanism with its own font handling and a filter-option
 * escaping problem where operator text is interpolated into a filter string.
 * One of those is a known quantity.
 *
 * Positions are fractions of the frame, not pixels, so the same overlay is in
 * the same place whether the edit renders 9:16, 1:1 or 4:5. Sizes likewise:
 * a fraction of the frame HEIGHT, because a size in pixels that reads well on
 * 1080x1920 is tiny on a wider frame.
 */

export const MAX_OVERLAYS = 40;
export const MAX_TEXT = 200;
export const MIN_SHOWN = 0.2;          // shorter than this nobody reads
export const DEFAULT_SIZE = 0.055;     // of the frame height
export const MIN_SIZE = 0.02;
export const MAX_SIZE = 0.2;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function secs(v, fallback = 0) {
  return Math.round(num(v, fallback) * 1e6) / 1e6;
}
function frac(v, fallback) {
  return Math.min(1, Math.max(0, num(v, fallback)));
}

/**
 * Is this window long enough to read?
 *
 * Epsilon, not an exact comparison, because `1.2 - 1` is 0.19999999999999996
 * in IEEE doubles: an overlay repaired to exactly MIN_SHOWN would then be
 * judged too short and dropped, and which ones depends on where in the edit
 * they sit. This is the third place in the timeline work where that trap has
 * appeared, after MIN_ITEM in edl.mjs and the waveform's own assertions. Any
 * duration comparison in this codebase wants one of these.
 */
const EPS = 1e-9;
export function shownLongEnough(from, to) {
  return (num(to, 0) - num(from, 0)) >= MIN_SHOWN - EPS;
}

/**
 * Make operator text safe to put in an ASS event, and keep it readable.
 *
 * This is the part that matters. In ASS, `{` opens an override block, so a
 * brace in the text is not text: `{\pos(0,0)}` typed into a caption would
 * move it, `{\c&HFF&}` would recolour it, and the operator would have found a
 * way to drive the renderer by typing. Both braces are replaced rather than
 * stripped, so the text still reads as what was typed.
 *
 * A newline becomes `\N`, ASS's hard break. A backslash would otherwise start
 * an escape of its own, so it goes first and becomes a forward slash: the
 * alternative is `\\`, which some renderers show literally.
 *
 * A trailing or leading run of spaces is collapsed because ASS ignores it
 * anyway, and `\h` (its non-breaking space) is not worth exposing.
 */
export function escapeAss(text) {
  return String(text ?? '')
    .slice(0, MAX_TEXT)
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, i, all) => line.length > 0 || (i > 0 && i < all.length - 1))
    .join('\\N')
    .trim();
}

/**
 * Clean a list of overlays against the edit they belong to.
 *
 * Times are **timeline** times, which is what "appears at 00:03" means, and
 * are clamped to the edit's length: an overlay whose whole window is past the
 * end of the edit is dropped, because a render cannot show it and keeping it
 * would leave the page promising text nobody will see.
 *
 * A consequence worth stating: an overlay is pinned to a time, not to a block,
 * so reordering the timeline moves the footage underneath it. That is the
 * right default for the thing these are mostly for (a hook line over the first
 * three seconds of a reel) and the wrong one for a lower third naming whoever
 * is on screen. Pinning to a block is a later choice, not an oversight.
 */
export function normaliseOverlays(list, editDuration) {
  const total = num(editDuration, 0);
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_OVERLAYS) break;
    const text = escapeAss(raw?.text);
    if (!text) continue;
    let from = Math.max(0, secs(raw?.from, 0));
    let to = secs(raw?.to, from + 2);
    if (total > 0) {
      // Said here because it is the rule, though the repair below would also
      // drop it: an overlay starting past the end cannot be lengthened into
      // the edit, so the `to > total` check catches it too.
      if (from >= total) continue;
      to = Math.min(to, total);
    }
    if (!shownLongEnough(from, to)) {
      to = secs(from + MIN_SHOWN);
      if (total > 0 && to > total + EPS) continue;   // no room left to show it
    }
    out.push({
      id: String(raw?.id || `o${out.length}`),
      text,
      from,
      to,
      x: frac(raw?.x, 0.5),
      y: frac(raw?.y, 0.18),
      size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, num(raw?.size, DEFAULT_SIZE))),
    });
  }
  return out;
}

/** ASS's own timestamp: h:mm:ss.cc, centiseconds. */
export function assTime(seconds) {
  const s = Math.max(0, num(seconds, 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

/**
 * The ASS file for a set of overlays, at a given frame size.
 *
 * One style, and `\pos` plus `\fs` per event, so each overlay carries its own
 * place and size without a style row each. `\an5` centres the text on its
 * point, which is what dragging it somewhere means.
 *
 * Returns null for nothing to draw, so the caller leaves the pass out rather
 * than re-encoding a video to add no text.
 */
export function overlayAss(overlays, { width, height }) {
  const list = Array.isArray(overlays) ? overlays : [];
  const W = Math.max(1, Math.round(num(width, 1080)));
  const H = Math.max(1, Math.round(num(height, 1920)));
  if (!list.length) return null;

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    // 0 is smart wrapping: an overlay is a hand-typed line and may be long
    // enough to need breaking, unlike a three-word caption.
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,'
      + 'Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,'
      + 'Alignment,MarginL,MarginR,MarginV,Encoding',
    // White with a black outline and a soft shadow: the one combination that
    // stays readable over footage of any brightness without a box behind it.
    'Style: Over,DejaVu Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,'
      + '-1,0,0,0,100,100,0,0,1,3,1,5,40,40,40,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  const events = list.map((o) => {
    const x = Math.round(frac(o.x, 0.5) * W);
    const y = Math.round(frac(o.y, 0.18) * H);
    const fs = Math.max(8, Math.round(o.size * H));
    // The override block is ours, built from numbers, and the text that
    // follows it has had its braces replaced, so it cannot open another.
    return `Dialogue: 0,${assTime(o.from)},${assTime(o.to)},Over,,0,0,0,,`
      + `{\\an5\\pos(${x},${y})\\fs${fs}}${o.text}`;
  });

  return `${head.join('\n')}\n${events.join('\n')}\n`;
}
