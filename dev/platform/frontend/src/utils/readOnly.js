// Read-only (client login) button treatment. Client-role users see the whole
// tool but can't trigger anything that produces/edits/spends — those buttons
// render disabled with a tooltip pointing them at their account manager.
// Downloads and view/navigation stay active (they're not passed through here).

export const READ_ONLY_MSG = 'Read-only access — ask your account manager to generate this for you.';

// Spread onto a write button when read-only. Blocks the click, disables it, and
// swaps in the explanatory tooltip. Pass the original disabled/title so a
// normally-disabled or titled button keeps its state when NOT read-only.
//   <button {...roWrite(readOnly, { onClick: doThing, disabled: busy, title: 'Foo' })}>
export function roWrite(readOnly, { onClick, disabled = false, title } = {}) {
  if (readOnly) {
    return { onClick: undefined, disabled: true, title: READ_ONLY_MSG, 'aria-disabled': true };
  }
  return { onClick, disabled, title };
}
