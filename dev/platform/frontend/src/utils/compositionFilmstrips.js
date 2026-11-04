import { useMemo } from 'react';
import { useFilmstrips, THUMB_COUNT, THUMB_HEIGHT } from './filmstrip';
import { thumbsForBlock } from './filmstripPlace';

/**
 * Filmstrips for a composition's clip sources, keyed by sourceId.
 *
 * Thin adapter: builds the clips-like array the existing hook expects from
 * the composition's sources map and the live sourceUrls, then delegates.
 * Multiple items sharing one source get one filmstrip between them.
 */
export function useCompositionFilmstrips(composition, sourceUrls) {
  const clips = useMemo(() => {
    const sources = composition?.sources;
    const urls = sourceUrls || {};
    if (!sources) return [];
    return Object.entries(sources)
      .filter(([, src]) => src.kind === 'clip')
      .map(([id]) => ({ id, url: urls[id] }))
      .filter((c) => c.url);
  }, [composition?.sources, sourceUrls]);

  return useFilmstrips(clips);
}

export { THUMB_COUNT, THUMB_HEIGHT, thumbsForBlock };
