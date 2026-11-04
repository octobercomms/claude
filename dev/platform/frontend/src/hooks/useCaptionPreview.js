/**
 * Caption preview via JASSUB (libass compiled to WASM).
 *
 * Renders ASS subtitles in real-time over the compositor canvas, matching what
 * the ffmpeg render graph produces with its `subtitles=` filter. The same
 * shared/captions/compile.mjs drives both, so the preview and the render agree
 * by construction.
 *
 * JASSUB renders onto a transparent overlay canvas that the hook creates and
 * manages inside a container element the caller provides. It operates in
 * canvas-only mode (no video element) and we drive frames manually via
 * `manualRender()`.
 *
 * The canvas is created and destroyed by the hook rather than by React, because
 * JASSUB calls `transferControlToOffscreen()` on init (which is one-shot per
 * element) and `canvas.remove()` on destroy. Letting JASSUB own the element's
 * lifecycle avoids conflicts with React's DOM management.
 */
import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { compile } from '@shared/captions/compile.mjs';
import presets from '@shared/captions/presets.json';

/**
 * Pick the output format matching the composition's frame size, or synthesise
 * one. The compile function uses PlayResX / PlayResY from the format, so the
 * caption positioning scales correctly.
 */
function formatForSize(w, h) {
  for (const fmt of Object.values(presets.outputFormats)) {
    if (fmt.width === w && fmt.height === h) return fmt;
  }
  return { id: 'custom', name: 'Custom', width: w, height: h };
}

/**
 * Build the timeline-mapped word list and compile an ASS string.
 *
 * Each caption source references a transcript (the clip it belongs to) and a
 * template. Caption *items* on the timeline have `at` and `in` that place the
 * source words at their composited position, exactly as the render graph does.
 *
 * Returns `{ ass, templateId, fontName }` or null when no captions are active.
 */
export function buildCaptionAss(composition, transcripts) {
  if (!composition?.sources || !composition?.tracks) return null;

  const captionSources = Object.entries(composition.sources)
    .filter(([, s]) => s.kind === 'captions');

  if (!captionSources.length) return null;

  // Use the first caption source's template for the whole ASS. Multiple
  // templates in one composition is theoretically possible but rare; the
  // preview chooses one and the render burns them all with the same filter.
  const [, firstCaptionSrc] = captionSources[0];
  const templateId = firstCaptionSrc.template;
  const preset = presets.styles[templateId];
  if (!preset) return null;

  // Collect words from every caption item, mapped to timeline time.
  const allWords = [];

  for (const [captionSrcId, captionSrc] of captionSources) {
    const words = transcripts?.[captionSrc.transcript];
    if (!Array.isArray(words) || !words.length) continue;

    for (const track of composition.tracks) {
      for (const item of track.items) {
        if (item.source !== captionSrcId) continue;

        const inPt = item.in || 0;
        const itemEndTime = item.at + item.len;

        for (const w of words) {
          // Word must overlap the item's source window
          if (w.end <= inPt || w.start >= inPt + item.len) continue;

          const start = item.at + Math.max(0, w.start - inPt);
          const end = Math.min(item.at + (w.end - inPt), itemEndTime);
          if (end <= start) continue;

          allWords.push({ word: w.word, start, end });
        }
      }
    }
  }

  if (!allWords.length) return null;

  allWords.sort((a, b) => a.start - b.start);

  const W = composition.size?.width || 1080;
  const H = composition.size?.height || 1920;
  const format = formatForSize(W, H);

  const ass = compile({
    words: allWords,
    preset,
    format,
    perLine: preset.wordsPerLine || 3,
    marginV: firstCaptionSrc.marginV ?? Math.round(format.height * 0.17),
  });

  return { ass, templateId, fontName: preset.fontName };
}

/**
 * Map of font filename stems (lowercase) to their filenames on disk.
 *
 * JASSUB's `availableFonts` takes a map from family name (lowercase) to a URL.
 * The captions font directory is inside `shared/captions/fonts/` and Vite's dev
 * server serves it because `fs.allow` includes the platform root. In production
 * builds, fonts would need to be copied to dist/; for now the preview is a dev
 * tool and dev-server access is sufficient.
 *
 * If the fonts cannot be loaded, JASSUB falls back to its bundled default (a
 * Liberation Sans subset). Timing and positioning stay correct; only the
 * typeface changes.
 */
const FONT_FILES = {
  'montserrat':        'Montserrat[wght].ttf',
  'bebas neue':        'BebasNeue-Regular.ttf',
  'bangers':           'Bangers-Regular.ttf',
  'cinzel':            'Cinzel[wght].ttf',
  'inter':             'Inter[opsz,wght].ttf',
  'jetbrains mono':    'JetBrainsMono[wght].ttf',
  'orbitron':          'Orbitron[wght].ttf',
  'outfit':            'Outfit[wght].ttf',
  'permanent marker':  'PermanentMarker-Regular.ttf',
  'playfair display':  'PlayfairDisplay[wght].ttf',
  'plus jakarta sans': 'PlusJakartaSans[wght].ttf',
  'poppins':           'Poppins-Bold.ttf',
  'syne':              'Syne[wght].ttf',
};

function buildFontMap() {
  const map = {};
  for (const [family, file] of Object.entries(FONT_FILES)) {
    // Build a URL that Vite can resolve. In dev mode this goes through the dev
    // server's fs.allow; in production the fonts would need to be in dist/.
    try {
      map[family] = new URL(
        `../../../shared/captions/fonts/${file}`,
        import.meta.url
      ).href;
    } catch { /* skip unresolvable fonts */ }
  }
  return map;
}

let _fontMap = null;
function fontMap() {
  if (!_fontMap) {
    try { _fontMap = buildFontMap(); }
    catch { _fontMap = {}; }
  }
  return _fontMap;
}

/**
 * Hook: manages a JASSUB instance that renders captions onto an overlay canvas.
 *
 * The hook creates and owns the overlay canvas element, appending it to the
 * container element referenced by `containerRef`. JASSUB calls
 * `transferControlToOffscreen()` on init and `canvas.remove()` on destroy, so
 * the canvas must not be managed by React.
 *
 * @param {Object}  composition   - the composition model
 * @param {Object}  transcripts   - { [sourceId]: [{ word, start, end }] }
 * @param {number}  playhead      - current timeline time in seconds
 * @param {Object}  containerRef  - React ref to a container div for the overlay
 * @param {number}  canvasWidth   - the composition's pixel width
 * @param {number}  canvasHeight  - the composition's pixel height
 *
 * Returns { hasCaptions, error, render }.
 */
export default function useCaptionPreview(
  composition, transcripts, playhead, containerRef, canvasWidth, canvasHeight
) {
  const jassubRef = useRef(null);
  const assRef = useRef(null);
  const [error, setError] = useState(null);
  const destroyedRef = useRef(false);

  // Compile the ASS string whenever the composition or transcripts change.
  const captionData = useMemo(
    () => buildCaptionAss(composition, transcripts),
    [composition, transcripts]
  );

  const hasCaptions = captionData !== null;

  // Create / update the JASSUB instance.
  useEffect(() => {
    const container = containerRef?.current;
    if (!container || !captionData) {
      // No captions or no container: tear down any existing instance
      if (jassubRef.current) {
        jassubRef.current.destroy().catch(() => {});
        jassubRef.current = null;
        assRef.current = null;
      }
      setError(null);
      return;
    }

    const { ass } = captionData;
    destroyedRef.current = false;

    // If JASSUB is running and only the ASS changed, swap the track.
    if (jassubRef.current && !jassubRef.current._destroyed) {
      if (assRef.current !== ass) {
        assRef.current = ass;
        jassubRef.current.renderer.setTrack(ass).catch((err) => {
          console.warn('[CaptionPreview] setTrack failed:', err);
        });
      }
      return;
    }

    // Fresh initialisation: dynamic-import JASSUB so the WASM is only loaded
    // when captions actually exist.
    let cancelled = false;

    (async () => {
      try {
        const { default: JASSUB } = await import('jassub');
        if (cancelled || destroyedRef.current) return;

        const fonts = fontMap();

        // Create a canvas for JASSUB to own. It will call
        // transferControlToOffscreen() on it and remove() it on destroy.
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        Object.assign(canvas.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        });
        container.appendChild(canvas);

        if (cancelled || destroyedRef.current) {
          canvas.remove();
          return;
        }

        const instance = new JASSUB({
          canvas,
          subContent: ass,
          availableFonts: fonts,
          prescaleFactor: 1,
          prescaleHeightLimit: canvasHeight,
        });

        if (cancelled || destroyedRef.current) {
          instance.destroy().catch(() => {});
          return;
        }

        jassubRef.current = instance;
        assRef.current = ass;
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.warn('[CaptionPreview] JASSUB failed to initialise:', err);
          setError('Caption preview unavailable');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (jassubRef.current) {
        jassubRef.current.destroy().catch(() => {});
        jassubRef.current = null;
        assRef.current = null;
      }
    };
  }, [captionData, containerRef, canvasWidth, canvasHeight]);

  // Manual render on each playhead change.
  const render = useCallback((time) => {
    const jassub = jassubRef.current;
    if (!jassub || jassub._destroyed) return;
    jassub.manualRender({
      mediaTime: time,
      width: canvasWidth,
      height: canvasHeight,
      expectedDisplayTime: performance.now(),
    });
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    render(playhead);
  }, [playhead, render]);

  // Cleanup on unmount.
  useEffect(() => () => {
    destroyedRef.current = true;
    if (jassubRef.current) {
      jassubRef.current.destroy().catch(() => {});
      jassubRef.current = null;
      assRef.current = null;
    }
  }, []);

  return { hasCaptions, error, render };
}
