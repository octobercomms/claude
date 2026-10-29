// The Strategist's queue: parsing it out of the model's markdown, and threading
// it to the previous briefing's open items.
//
// This is the fragile seam. Everything else in a briefing is prose that can be
// a bit wrong without consequence; the queue is the part the account lead acts
// on, and the part that has to keep its identity from one week to the next. If
// a carried item loses its thread it silently becomes a new item, its age
// resets to zero, and the pressure that makes a three-week-old failure
// uncomfortable disappears. Nothing on screen would say so. Hence a module with
// tests rather than a regex buried in the generator.
//
// The line shape we ask the model for:
//
//   - [CRUCIAL][A1] Fix the Meta Pixel on Summer Sale :: 4,360 clicks at zero
//     conversions is a tracking failure, not a performance result.
//
// `[A1]` is the tag of an open item this continues, and is absent on anything
// newly raised. ` :: ` splits the action from the reasoning. Both are optional
// so an older briefing, or a pass where the model ignores the format, still
// yields usable items rather than nothing.

// `[A1]`-style tags handed to the model for the items already open. Letter
// plus number so they cannot be confused with the [CRUCIAL]/[NICE] tags, and
// are short enough that the model reliably copies them verbatim.
function tagFor(index) {
  return `A${index + 1}`;
}

// Open items, in the order the model will see them, each with its tag.
function tagOpenItems(openItems) {
  return (openItems || []).map((item, i) => ({ ...item, tag: tagFor(i) }));
}

const LINE = /^\s*(?:[-*]|\d+[.)])?\s*\[(CRUCIAL|NICE)\]\s*(?:\[([A-Za-z]\d{1,3})\])?\s*(.+?)\s*$/i;

// Pull the queue out of a markdown block. Returns
// [{ priority, carryTag, text, rationale }] in the order written, which is the
// order the model was asked to prioritise in.
function parseQueue(markdown) {
  if (!markdown) return [];
  const out = [];
  for (const raw of String(markdown).split('\n')) {
    const m = raw.match(LINE);
    if (!m) continue;
    const [, priority, carryTag, rest] = m;

    // ` :: ` splits action from reasoning. Split once: a rationale is free to
    // contain anything, including another colon pair.
    const at = rest.indexOf(' :: ');
    const text = (at === -1 ? rest : rest.slice(0, at)).replace(/\*\*/g, '').trim();
    const rationale = at === -1 ? null : rest.slice(at + 4).replace(/\*\*/g, '').trim() || null;

    // A line that is all tag and no action is not an item.
    if (!text) continue;

    out.push({
      priority: priority.toLowerCase() === 'crucial' ? 'crucial' : 'nice',
      carryTag: carryTag ? carryTag.toUpperCase() : null,
      text,
      rationale,
    });
  }
  return out;
}

// Thread the parsed queue back to what was already open.
//
// Returns { items, dropped }:
//   items    one row per queue entry, in order, each carrying first_raised_at
//            and carried_from when it continues an open item, and nulls when it
//            is newly raised (the caller defaults those to now).
//   dropped  the open items the model did not re-emit. Not an error: it is the
//            model saying these are resolved or no longer worth the queue. The
//            caller decides whether to say so out loud.
//
// A tag the model invented, or re-used twice, must not corrupt the thread: an
// unknown tag is treated as a new item, and the second use of a tag is too.
// Both are quieter failures than attaching one item's history to another's.
function reconcile(parsed, openItems) {
  const tagged = tagOpenItems(openItems);
  const byTag = new Map(tagged.map(i => [i.tag, i]));
  const claimed = new Set();
  const items = [];

  for (const p of parsed || []) {
    const match = p.carryTag && !claimed.has(p.carryTag) ? byTag.get(p.carryTag) : null;
    if (match) claimed.add(p.carryTag);
    items.push({
      priority: p.priority,
      text: p.text,
      rationale: p.rationale,
      first_raised_at: match ? match.first_raised_at : null,
      carried_from: match ? match.id : null,
      // The pillar of the item it continues, so a carried item does not drift
      // between pillars and lose its filter. The caller overrides for new ones.
      pillar: match ? match.pillar : null,
    });
  }

  const dropped = tagged.filter(i => !claimed.has(i.tag));
  return { items, dropped };
}

// The block of open items handed to the model, oldest first so the age is
// visible in the ordering as well as the text.
function openItemsBlock(openItems, now = new Date()) {
  const tagged = tagOpenItems(openItems);
  if (!tagged.length) return '_Nothing is currently open — every item from the last briefing was ticked off or dropped._';
  return tagged.map(i => {
    const days = ageInDays(i.first_raised_at, now);
    const age = days == null ? 'age unknown' : days === 0 ? 'raised today' : `open ${days} day${days === 1 ? '' : 's'}`;
    return `- [${i.tag}] (${i.priority}, ${age}) ${i.text}`;
  }).join('\n');
}

// Whole days between then and now, floored, never negative. Null for anything
// unparseable, so a bad timestamp reads as "age unknown" rather than a wrong
// number of days, which would be worse than none.
function ageInDays(since, now = new Date()) {
  if (!since) return null;
  const t = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000);
}

module.exports = { parseQueue, reconcile, openItemsBlock, ageInDays, tagOpenItems };
