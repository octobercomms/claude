// Whether a "Combined · Google + Meta" strip is telling you anything.
//
// It is only a combined total if both networks contributed. Falcon has a Meta
// ad account connected that spent £0.00 in the period, and the page used to
// test "is Meta connected" rather than "did Meta spend", so it printed
// Combined £2,853.94 directly above Google £2,853.94: the same figure twice,
// the second one wearing a different label. A sum of one number is that
// number, and showing it as a blend invites someone to read the pair as
// agreement between two sources.
//
// Lives here rather than inline in the page so the rule can be tested. The
// whole class of currency and totals bugs on this page has been arithmetic
// that was only ever checked by looking at it.
export function showCombined(googleTotal, metaTotal) {
  return (googleTotal?.spend || 0) > 0 && (metaTotal?.spend || 0) > 0;
}
