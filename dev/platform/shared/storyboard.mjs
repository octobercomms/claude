/**
 * A social post's storyboard, and the refine round trip that was eating it.
 *
 * ── The fault this module exists to remove ───────────────────────────
 *
 * A storyboard frame is an object: `{ style, description, on_screen_text,
 * duration_sec, voiceover }`. `style` is the A-to-G grammar the renderer
 * dispatches on, and it is the field everything downstream needs:
 * `renderStoryboardReel` keeps only the frames whose style is A, C or G, and
 * `resolveFrame` throws on anything else.
 *
 * The refine chat sent Claude the frame DESCRIPTIONS as numbered lines, read
 * the revision back as an array of plain strings, and PUT that array into the
 * same JSONB column. Every other field on every frame went with it. The post
 * then had a storyboard of strings, so the A/C/G filter matched nothing and
 * "Stitch reel" answered `No A/C/G frames to stitch` — on a post that had
 * been renderable five seconds earlier. Not a cosmetic fallback: the feature
 * is gone for that post and the only way back is to regenerate it.
 *
 * So the merge happens HERE, against the frames that are already there, and
 * the round trip can only change the text it was shown.
 *
 * ── Why a shared module ──────────────────────────────────────────────
 *
 * Because it is the kind of thing that has to be tested without a browser.
 * The fault was in a 20-line function inside a 2,700-line page component, and
 * nothing in the suite could reach it.
 *
 * Pure. No I/O, no DOM, no side effects.
 */

/** The styles the renderer can produce without filming anything. */
export const RENDERABLE_STYLES = ['A', 'C', 'G'];

/** Every field a frame carries, so losing one is a visible change. */
export const FRAME_FIELDS = [
  'style', 'description', 'shot', 'on_screen_text', 'duration_sec', 'voiceover',
];

/**
 * A frame as the rest of the system expects it.
 *
 * A plain string is what a damaged storyboard holds, and it is read as the
 * description — which is what the render path already does, one `typeof`
 * check at a time, in four places.
 */
export function normaliseFrame(frame) {
  if (typeof frame === 'string') return { description: frame };
  if (!frame || typeof frame !== 'object') return null;
  return frame;
}

/** Every frame, as objects, with anything unreadable dropped. */
export function normalise(storyboard) {
  if (!Array.isArray(storyboard)) return [];
  return storyboard.map(normaliseFrame).filter(Boolean);
}

/**
 * Whether a storyboard has lost its frame detail.
 *
 * A storyboard whose frames carry no `style` cannot be rendered, and there is
 * no recovering the lost fields: `style`, `on_screen_text`, `duration_sec`
 * and `voiceover` are not derivable from a description. So the only honest
 * thing to do with an already-damaged post is to SAY SO and offer to
 * regenerate it, which is what the UI does with this.
 *
 * `null` for a storyboard that is absent or empty: nothing to judge.
 */
export function isDegraded(storyboard) {
  const frames = normalise(storyboard);
  if (!frames.length) return null;
  const withStyle = frames.filter((f) => typeof f.style === 'string' && f.style);
  if (withStyle.length === frames.length) return false;
  return true;
}

/** How many frames a reel could render from this storyboard. */
export function renderableCount(storyboard) {
  return normalise(storyboard).filter((f) => RENDERABLE_STYLES.includes(f.style)).length;
}

/**
 * One frame as a line for the refine prompt.
 *
 * The style and the on-screen text are included because leaving them out is
 * what made the round trip lossy BY DESIGN: Claude could not revise what it
 * was never shown, and the AM had no way to change the words that actually
 * appear on screen through the one chat that exists for revising the post.
 */
export function frameToLine(frame, index) {
  const f = normaliseFrame(frame) || {};
  const bits = [`${index + 1}.`];
  if (f.style) bits.push(`[${f.style}]`);
  bits.push((f.description || f.shot || '').trim() || '(no description)');
  if (f.on_screen_text) bits.push(`— on screen: "${f.on_screen_text}"`);
  return bits.join(' ');
}

/** The storyboard as the prompt shows it. */
export function toLines(storyboard) {
  return normalise(storyboard).map(frameToLine).join('\n');
}

const LINE = /^\s*(\d+)[.)]\s*(?:\[([A-G])\]\s*)?([\s\S]*)$/;
const ON_SCREEN = /\s*[—-]\s*on\s*screen:\s*"([^"]*)"\s*$/i;

/**
 * Read one revised line back into the parts it can change.
 *
 * Deliberately narrow. A line gives at most a description, a style and an
 * on-screen text, and anything it does not carry is left alone rather than
 * cleared — which is the whole difference between this and what it replaced.
 */
export function parseLine(line) {
  const m = String(line || '').match(LINE);
  if (!m) return null;
  let rest = m[3].trim();
  const onScreen = rest.match(ON_SCREEN);
  const patch = {};
  if (onScreen) {
    patch.on_screen_text = onScreen[1];
    rest = rest.slice(0, onScreen.index).trim();
  }
  if (m[2]) patch.style = m[2];
  if (rest && rest !== '(no description)') patch.description = rest;
  return { index: Number(m[1]) - 1, patch };
}

/**
 * Merge a revision onto the frames that are already there.
 *
 * Returns `{ storyboard, changed, notes }`. `storyboard` is null when there
 * is nothing to apply, so a caller can tell "no change" from "change to
 * nothing" — the second is what used to be written.
 *
 * Matching is by the NUMBER on the line, not by position in the list, so a
 * revision that returns three of five frames revises those three and leaves
 * the other two exactly as they were. A number past the end of the
 * storyboard adds a frame and says so; a frame nobody mentioned is kept.
 */
export function mergeRevision(existing, text) {
  const frames = normalise(existing).map((f) => ({ ...f }));
  const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const notes = [];
  let changed = 0;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      notes.push(`ignored a line with no frame number: ${trim(line)}`);
      continue;
    }
    const { index, patch } = parsed;
    if (index < 0) {
      notes.push(`ignored frame ${index + 1}`);
      continue;
    }
    if (!Object.keys(patch).length) continue;
    if (index >= frames.length) {
      // A new frame, with only what the line carried. It has no style, so
      // the renderer will skip it — said out loud rather than left to be
      // discovered when a reel comes out short.
      frames[index] = { ...patch };
      notes.push(
        `frame ${index + 1} is new, so it has no style and no reel will render it`
      );
      changed += 1;
      continue;
    }
    const before = frames[index];
    const after = { ...before, ...patch };
    if (FRAME_FIELDS.some((k) => before[k] !== after[k])) changed += 1;
    frames[index] = after;
  }

  // A hole is possible if a revision numbers frame 7 of a 4-frame board and
  // skips 5 and 6. Filled rather than left sparse, because a sparse array
  // serialises to JSON with nulls in it and every reader would need a guard.
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i]) {
      frames[i] = { description: '' };
      notes.push(`frame ${i + 1} was skipped and is empty`);
    }
  }

  if (!changed) return { storyboard: null, changed: 0, notes };
  return { storyboard: frames, changed, notes };
}

function trim(s) {
  const t = String(s);
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
