// Who wins when two things edit one field.
//
// Shared's Review screen puts a post's fields on the left and a Claude refine
// chat on the right, and both write the same hook and caption. So "somebody
// changed this underneath me" is the ordinary case on that screen, not a rare
// one, and the old edit mode resolved it by silently discarding whichever
// change was not yours.
//
// The decision lives here rather than inside the component because it is the
// part that is easy to get subtly wrong and impossible to test through a
// browser: reproducing "Claude applied a revision while the caret was in the
// textarea" from outside the page is not something a drive can arrange.
//
//   draft    — what is in the box
//   current  — what the record says now
//   atFocus  — what the record said when this field was focused
//   focused  — whether the caret is in it
//
// dirty: there is something typed that the record does not have yet.
// clash: the record changed after you started typing something of your own,
//        so neither value can be chosen without losing the other.
export function fieldState({ draft, current, atFocus, focused }) {
  const d = draft ?? '';
  const c = current ?? '';
  const f = atFocus ?? '';
  const dirty = d !== c;
  return { dirty, clash: !!focused && dirty && c !== f };
}

// Whether leaving the field should write anything. A blur with nothing typed
// must not PATCH: this field blurs on every click elsewhere on the screen, and
// a write per click would be a write per glance.
export function shouldCommit({ draft, current }) {
  return (draft ?? '') !== (current ?? '');
}
