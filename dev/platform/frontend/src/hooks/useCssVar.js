// Read a CSS variable from the live DOM. Recharts (and any other
// chart library that takes a stroke / fill colour as a JS string)
// can't read CSS vars directly, so wrap getComputedStyle in a small
// hook the components mount → grab → cache the value.
//
// Pass scopeRef to resolve the var inside a specific element (so a
// .suite-paid child reads the Paid blue rather than the page's
// inherited default). Without a ref the lookup walks the
// documentElement, which uses the :root values.

import { useEffect, useState } from 'react';

export function useCssVar(name, fallback = '#1a1a1a', scopeRef = null) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const el = scopeRef?.current || document.documentElement;
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    if (v) setValue(v);
  }, [name, scopeRef]);
  return value;
}
