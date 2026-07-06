import { useState, useEffect } from 'react';

// Returns true on narrow (phone-width) viewports so inline-styled grids can
// collapse to a single column. Inline styles can't hold @media queries, so
// components that lay out with `style={{ gridTemplateColumns: … }}` use this
// to swap in a stacked layout on small screens. Updates live on resize/rotate.
export function useIsMobile(breakpoint = 720) {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}
