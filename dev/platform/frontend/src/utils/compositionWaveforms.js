import { useMemo } from 'react';
import { useWaveforms } from './waveform';
import { peaksForBlock, peaksPath, heightOf, CLIP_BUCKETS, FLOOR_DB } from './waveformPeaks';

/**
 * Audio peaks for a composition's sources, keyed by sourceId.
 *
 * Thin adapter over the existing useWaveforms hook. Includes both clip and
 * audio sources since both carry audio that needs a waveform in the timeline.
 */
export function useCompositionWaveforms(composition, sourceUrls) {
  const clips = useMemo(() => {
    const sources = composition?.sources;
    const urls = sourceUrls || {};
    if (!sources) return [];
    return Object.entries(sources)
      .filter(([, src]) => src.kind === 'clip' || src.kind === 'audio')
      .map(([id]) => ({ id, url: urls[id] }))
      .filter((c) => c.url);
  }, [composition?.sources, sourceUrls]);

  return useWaveforms(clips);
}

export { peaksForBlock, peaksPath, heightOf, CLIP_BUCKETS, FLOOR_DB };
