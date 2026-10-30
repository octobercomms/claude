// How large a stat tile's value is allowed to be.
//
// The value renders at 40px with no overflow handling, in a grid column that
// can be as narrow as 150px. "£4,800.00" is nine characters, roughly 216px at
// that size, so it was clipped mid-number: £4,800 with the pence sliced off by
// the tile edge. A clipped figure is worse than a small one, because it reads
// as a different, smaller number, and nothing on the page says it was cut.
//
// It went unnoticed while spend led every strip. Putting revenue first made
// the largest number the headline and the clipping impossible to miss.
//
// CSS cannot measure the string, so the bucket is chosen here. A plain module
// rather than a closure in the component, because this now governs every stat
// tile in the platform and a bucket that drifts reintroduces the bug
// somewhere nobody is looking.
export function valueSizeClass(value) {
  const n = String(value ?? '').length;
  if (n <= 6) return '';
  if (n <= 9) return 'ds-stat__value--md';
  if (n <= 12) return 'ds-stat__value--sm';
  return 'ds-stat__value--xs';
}
