/**
 * Where each still sits on a block. Pure, and deliberately in its own file
 * with no imports, so it can be unit-tested without a browser or React: this
 * is the arithmetic that decides whether a frame is drawn where it was taken
 * from, and a bug in it misplaces every frame on the timeline without
 * throwing anything.
 *
 * One strip per source clip serves any number of blocks over that clip. A
 * trim changes which stills are in range; a split changes which block each
 * one belongs to; a reorder changes nothing about either. Nothing is
 * re-extracted for any of them.
 */

/**
 * @param strip    `{ thumbs: [{ t, src }] }` for the whole source clip
 * @param inPoint  the block's in point, in source seconds
 * @param outPoint the block's out point, in source seconds
 * @returns the stills inside the block, each with `at`: its position as a
 *          fraction of the block's width, so the caller needs no pixel scale
 */
export function thumbsForBlock(strip, inPoint, outPoint) {
  const thumbs = Array.isArray(strip?.thumbs) ? strip.thumbs : [];
  // An absent in point means the start of the clip, matching the EDL's own
  // `num(raw?.in, 0)`: a block always has a start, and the two must agree or
  // the frames sit at different times from the cut they describe. An absent
  // OUT point is different: that means a length nobody knows yet.
  const a = inPoint == null ? 0 : Number(inPoint);
  const b = Number(outPoint);
  if (!thumbs.length) return [];
  // An out point that is absent, not a number, or not after the in point
  // gives no block to place anything in. Guessing a width here would draw
  // frames at the wrong times on a clip whose duration has not arrived yet.
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return [];
  const span = b - a;
  const out = [];
  for (const th of thumbs) {
    // `Number(null)` is 0 and 0 is finite, so a still that lost its
    // timestamp would be placed at the left edge of every block it touched
    // and read as a frozen clip. Absent is absent.
    if (th?.t == null) continue;
    const t = Number(th.t);
    if (!Number.isFinite(t)) continue;
    // Half-open: a still at exactly the out point belongs to the next block,
    // the same rule the timeline uses for the playhead at a boundary. Without
    // it a split draws one frame twice, once on each side of the cut.
    if (t < a || t >= b) continue;
    out.push({ ...th, t, at: (t - a) / span });
  }
  return out;
}
