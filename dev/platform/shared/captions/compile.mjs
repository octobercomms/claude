/**
 * Word-timed captions: a template, a client, and a transcript, into one ASS file.
 *
 * Shared between the backend renderer and the editor preview on purpose. The
 * two drifting apart is the failure this file exists to prevent: a preview that
 * is close but not identical is worse than no preview, because the operator
 * stops believing it and renders twice to check.
 *
 * ASS rather than a React composition, for three reasons that each cost money:
 *
 *   1. ffmpeg with libass burns a 3.5 second 1080x1920 clip in under two
 *      seconds. A Remotion render launches headless Chromium first.
 *   2. Remotion's free licence covers organisations up to three people; past
 *      that a tool that renders video sits in their Automators tier at $100 a
 *      month minimum. libass has no licence and no meter.
 *   3. A template becomes DATA. Twenty-seven of them live in presets.json and
 *      the twenty-eighth is a row, not a component.
 *
 * What a template owns: the typeface, the size, the motion, the weights.
 * What a client owns: the typeface and the four colours, from brand_assets.
 * Those are separate arguments here so one click is template × client.
 */

/** ASS wants &HAABBGGRR, which is backwards from every colour anyone writes. */
export function toAss(hex, alpha = 0) {
  const h = String(hex || '#000000').replace('#', '').trim();
  const six = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const r = parseInt(six.slice(0, 2), 16) || 0;
  const g = parseInt(six.slice(2, 4), 16) || 0;
  const b = parseInt(six.slice(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(255, Number(alpha) || 0));
  const hx = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return `&H${hx(a)}${hx(b)}${hx(g)}${hx(r)}`;
}

/** h:mm:ss.cc, centiseconds, which is all the format carries. */
export function stamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

/**
 * Lay a client's brand kit over a template.
 *
 * Only the fields a brand owns are taken. A skin that could change the font
 * size or the outline weight would let one client's kit turn a template into a
 * different template, and then "the Nordic one" means something different on
 * every account.
 */
export function skin(preset, kit) {
  const p = { ...preset };
  if (!kit) return p;
  if (kit.font) p.fontName = kit.font;
  if (kit.fontFallback) p.fontNameFallback = kit.fontFallback;
  if (kit.ink) p.primaryColor = kit.ink;
  if (kit.accent) p.highlightColor = kit.accent;
  if (kit.outline) p.outlineColor = kit.outline;
  if (kit.shadow) p.shadowColor = kit.shadow;
  return p;
}

/**
 * The eight motion engines, as override tags applied to one word.
 *
 * `active` is the word being spoken. Everything here animates from the start of
 * that word's own Dialogue line, so timing is the transcript's job and motion is
 * this file's, and neither has to know about the other.
 */
const ENGINES = {
  // The default and the most legible: the spoken word changes colour.
  highlight: (p) => `\\c${toAss(p.highlightColor)}`,
  // A filled block behind the word. BorderStyle 3 draws the box from the
  // outline, so the outline colour becomes the fill and the text reverses out.
  box: (p) => `\\c${toAss(p.primaryColor)}\\3c${toAss(p.highlightColor,
    p.boxAlpha != null ? Math.round(255 * (1 - p.boxAlpha)) : 0)}`,
  // A colour wipe across the word rather than a jump. \kf needs the duration in
  // centiseconds, which the caller passes in.
  karaoke: (p, ms) => `\\c${toAss(p.primaryColor)}\\2c${toAss(p.highlightColor)}\\kf${Math.max(1, Math.round(ms / 10))}`,
  // Grows into place. Restrained enough for a client that would not wear a pop.
  scale: (p) => `\\c${toAss(p.highlightColor)}\\fscx112\\fscy112\\t(0,120,\\fscx100\\fscy100)`,
  // Faster and larger than scale. The one most short-form uses.
  pop: (p) => `\\c${toAss(p.highlightColor)}\\fscx128\\fscy128\\t(0,90,\\fscx100\\fscy100)`,
  // Overshoots, then settles. Two transitions, so it reads as a spring.
  bounce: (p) => `\\c${toAss(p.highlightColor)}\\fscx135\\fscy135`
    + `\\t(0,70,\\fscx94\\fscy94)\\t(70,140,\\fscx100\\fscy100)`,
  // Colour plus a bloom on the outline. Carries the neon templates.
  glow: (p) => `\\c${toAss(p.highlightColor)}\\3c${toAss(p.highlightColor)}\\bord${(Number(p.outlineSize) || 3) * 2}`
    + `\\t(0,160,\\bord${Number(p.outlineSize) || 3})`,
  none: () => '',
};

export const ENGINE_NAMES = Object.keys(ENGINES);

/**
 * Group words into lines of at most `perLine`, so a long sentence does not run
 * off the frame. Each line is shown for as long as its own words last, and the
 * word being spoken inside it is the one that animates.
 */
export function group(words, perLine = 3) {
  const out = [];
  for (let i = 0; i < words.length; i += perLine) out.push(words.slice(i, i + perLine));
  return out;
}

/**
 * Build the ASS document.
 *
 * `words` is what Whisper returns with timestamp_granularities: ["word"]:
 * `[{ word, start, end }]`, seconds. `format` is one of presets.json's
 * outputFormats. `kit` is the client's brand kit, or null for the template as
 * its author drew it.
 */
export function compile({ words, preset, kit = null, format, perLine = 3, marginV = 320 }) {
  const p = skin(preset, kit);
  const engine = ENGINES[p.animationType] || ENGINES.highlight;
  const { width: W, height: H } = format;

  // ScaledBorderAndShadow keeps outlines proportional when the same template is
  // rendered at 1080x1920 and 1080x1080 — without it, square output gets a
  // visibly heavier outline from the identical style row.
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    // 2 is "never wrap", which is right for a word-at-a-time template where
    // each line is three short words by construction. A phrase template needs
    // 0, smart wrapping with balanced lines: the reels this was measured from
    // all break a long caption across two lines, and a seven-word caption set
    // on one line runs the width of the frame at a size nobody reads.
    `WrapStyle: ${p.wordsPerLine && p.wordsPerLine > 4 ? 0 : 2}`,
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,'
      + 'Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,'
      + 'Alignment,MarginL,MarginR,MarginV,Encoding',
    [
      'Style: Cap',
      p.fontName,
      p.fontSize,
      toAss(p.primaryColor),
      toAss(p.highlightColor),
      // A translucent box, when the template asks for one. Measured off the
      // reels this library was extended from: the institutions sit their
      // captions in black at 50 to 65 percent, never solid, so the shot stays
      // readable behind the words.
      toAss(p.outlineColor, p.animationType === 'box' || p.boxAlpha != null
        ? Math.round(255 * (1 - (p.boxAlpha ?? 1)))
        : 0),
      toAss(p.shadowColor, p.shadowAlpha ?? 0),
      p.bold ? -1 : 0,
      p.italic ? -1 : 0,
      0, 0, 100, 100,
      p.letterSpacing ?? 0,
      0,
      p.animationType === 'box' ? 3 : 1,
      p.outlineSize ?? 0,
      p.shadowDepth ?? 0,
      2,                      // bottom centre; MarginV lifts it off the edge
      // Phrase captions are kept well inside the frame so they break onto a
      // second line rather than running edge to edge.
      Math.round(W * (p.sideMarginPct ?? (p.wordsPerLine > 4 ? 0.17 : 0.08))),
      Math.round(W * (p.sideMarginPct ?? (p.wordsPerLine > 4 ? 0.17 : 0.08))), marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ].join('\n');

  const lines = [];
  for (const line of group(words, perLine)) {
    const to = line[line.length - 1].end;
    // One Dialogue per spoken word, each showing the whole line, so the words
    // around the active one stay on screen and only the active one moves.
    for (const w of line) {
      const text = line.map((x) => {
        const body = String(x.word).trim();
        if (x !== w) return `{\\r}${body}`;
        const ms = Math.max(0, (x.end - x.start) * 1000);
        return `{${engine(p, ms)}}${body}{\\r}`;
      }).join(' ');
      lines.push(`Dialogue: 0,${stamp(w.start)},${stamp(Math.min(w.end, to))},Cap,,0,0,0,,${text}`);
    }
  }
  return `${head}\n${lines.join('\n')}\n`;
}
