// Which posts in a batch the next step should act on.
//
// `null` means every post, which is what a fresh batch starts as and is
// not the same as a set holding every current id: a batch loads its posts
// after its id, and seeding a set from an empty list would tick nothing.
// Unticking everything gives an empty set, which is a real answer — the
// next step then has nothing to do and says so.
//
// A set can also outlive the posts in it (one gets deleted while ticked),
// so every read is intersected with the posts actually in hand.

export function tickedIds(ticked, posts) {
  const ids = (posts || []).map(p => p.id);
  if (ticked === null || ticked === undefined) return new Set(ids);
  return new Set(ids.filter(id => ticked.has(id)));
}

export function toggleTick(ticked, posts, id) {
  const next = new Set(tickedIds(ticked, posts));
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function tickSummary(ticked, posts) {
  const total = (posts || []).length;
  const count = tickedIds(ticked, posts).size;
  return { count, total, all: total > 0 && count === total, none: count === 0 };
}
