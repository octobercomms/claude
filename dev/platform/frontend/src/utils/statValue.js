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

// One size for a whole row, chosen by its longest value.
//
// Sizing each tile on its own length stops the clipping and breaks the row:
// Measure shows £70,271 at 30px beside 332, 30,791 and 1.08% at 40px, and six
// numbers at three sizes read as a rendering fault rather than as a design.
// Daniel: *"can you make the font size the same across them all?"*
//
// The longest value is what the row has to fit, so it is what the row is
// sized to. Every tile then matches, and nothing clips — the property the
// per-tile version existed for is kept, since the widest string still gets a
// bucket wide enough for it.
export function rowSizeClass(values = []) {
  const longest = values.reduce((a, v) => {
    const s = String(v ?? '');
    return s.length > a.length ? s : a;
  }, '');
  return valueSizeClass(longest);
}
