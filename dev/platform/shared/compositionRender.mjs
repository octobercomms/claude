/**
 * Composition render graph: one Composition in, one ffmpeg filter_complex out.
 *
 * Replaces the five-pass pipeline (cut each block, concat/xfade, trim+clean,
 * burn captions, burn overlays) with a single filter graph and one encode.
 *
 * The graph is built here, in shared/, because it is pure string arithmetic
 * over the same model the browser edits. No I/O, no ffmpeg invocation, no
 * side effects. The backend calls it and passes the result to ffmpeg; the
 * test suite asserts on the string without needing a binary.
 *
 * Each video item becomes:
 *   [n:v] trim=start:duration, setpts=PTS-STARTPTS, scale/crop per fit,
 *         setpts=PTS+at/TB  -> placed at absolute time on the timeline
 *
 * Video tracks composite in order: track 0 is the base, higher tracks overlay.
 * Same-track overlaps are transitions (xfade).
 *
 * Audio items become:
 *   [n:a] atrim=start:duration, asetpts=PTS-STARTPTS, volume=gain,
 *         adelay=at*1000  -> placed at absolute time
 *
 * Audio tracks are mixed with amix. Ducking uses sidechaincompress keyed
 * on the speech track.
 *
 * Captions: a single `subtitles=` filter from the ASS string the shared
 * compiler produces, applied last.
 */

import {
  secs, EPS, itemEnd, overlaps as findOverlaps, TRANSITION_TYPES,
  isAnim,
} from './composition.mjs';

const XFADE_NAME = {
  fade: 'fade',
  fadeblack: 'fadeblack',
  wipeleft: 'wipeleft',
  dissolve: 'dissolve',
};

/**
 * Build the input list and the filter graph for a composition.
 *
 * Returns {
 *   inputs:    [{ sourceId, kind, path? }]   -- ordered, one per ffmpeg -i
 *   graph:     string                         -- the filter_complex value
 *   videoOut:  string                         -- the final video pad name
 *   audioOut:  string | null                  -- the final audio pad name
 *   duration:  number                         -- expected output duration in seconds
 *   needsCaptions: boolean                    -- whether a subtitles filter was added
 * }
 *
 * The caller is responsible for:
 *   - resolving source paths (asset id -> disk path)
 *   - providing the ASS file path for captions
 *   - passing the result to ffmpeg as -filter_complex
 */
export function renderGraph(comp, opts = {}) {
  const {
    sourcePaths = {},     // { [sourceId]: diskPath }
    captionAssPath = null, // disk path to the compiled .ass file
  } = opts;

  const W = comp.size?.width || 1080;
  const H = comp.size?.height || 1920;
  const fps = comp.fps || 30;

  // Collect all items that reference a resolvable source, grouped by track.
  // Each item gets an input index for ffmpeg.
  const inputs = [];
  const inputIndex = new Map(); // item.id -> input index

  for (const track of comp.tracks) {
    for (const item of track.items) {
      const src = comp.sources[item.source];
      if (!src) continue;
      const idx = inputs.length;
      inputs.push({ sourceId: item.source, kind: src.kind, itemId: item.id });
      inputIndex.set(item.id, idx);
    }
  }

  if (!inputs.length) {
    return { inputs: [], graph: '', videoOut: '', audioOut: null, duration: 0, needsCaptions: false };
  }

  const filters = [];
  const videoTracks = comp.tracks.filter(t => t.kind === 'video');
  const audioTracks = comp.tracks.filter(t => t.kind === 'audio');

  // Total composition duration for padding
  let compDuration = 0;
  for (const track of comp.tracks) {
    for (const item of track.items) {
      const end = secs(item.at + item.len);
      if (end > compDuration) compDuration = end;
    }
  }

  // ── Video items: trim, scale, place in time ─────────────────────────

  const videoItemPads = new Map(); // item.id -> pad name after prep

  for (const track of videoTracks) {
    for (const item of track.items) {
      const idx = inputIndex.get(item.id);
      if (idx == null) continue;
      const src = comp.sources[item.source];
      const inPt = item.in || 0;
      const padName = `vi${idx}`;

      const parts = [];

      // Trim to the source region
      if (src.kind === 'clip') {
        parts.push(`trim=start=${f(inPt)}:duration=${f(item.len)}`);
        parts.push('setpts=PTS-STARTPTS');
      } else if (src.kind === 'design') {
        // Design sources are still images with alpha; no trim needed
        parts.push(`loop=loop=-1:size=1:start=0`);
        parts.push(`trim=duration=${f(item.len)}`);
        parts.push('setpts=PTS-STARTPTS');
      }

      // Scale/crop to the composition frame
      const fit = item.fit || 'cover';
      if (fit === 'cover') {
        parts.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`);
        parts.push(`crop=${W}:${H}`);
      } else {
        parts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
        parts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
      }
      parts.push('setsar=1');
      parts.push(`fps=${fps}`);

      // Opacity for graphics
      if (item.opacity != null && item.opacity < 1) {
        const alpha = Math.max(0, Math.min(1, item.opacity));
        parts.push(`colorchannelmixer=aa=${f(alpha)}`);
      }

      // A transform cannot live in this chain, because animating the size
      // changes the stream's dimensions and the flatten back onto a fixed
      // canvas needs a second input. So the prep chain lands on its own pad
      // and the transform stage produces the one the rest of the graph uses.
      if (hasTransform(item)) {
        const prePad = `${padName}pre`;
        filters.push(`[${idx}:v]${parts.join(',')}[${prePad}]`);
        emitTransform(item, prePad, padName, W, H, fps, filters);
      } else {
        filters.push(`[${idx}:v]${parts.join(',')}[${padName}]`);
      }
      videoItemPads.set(item.id, padName);
    }
  }

  // ── Per-track video compositing ─────────────────────────────────────
  //
  // Within a track: items are laid out in time. Overlapping items on the
  // same track are transitions (xfade). Non-overlapping items on the same
  // track are placed side by side using overlay on a blank base.
  //
  // Between tracks: each track's output is overlaid on the track below.

  const trackOutputs = []; // one pad name per video track

  for (const track of videoTracks) {
    const items = track.items.filter(it => videoItemPads.has(it.id));
    if (!items.length) continue;

    const sorted = [...items].sort((a, b) => a.at - b.at);
    const trackOverlaps = findOverlaps({ ...track, items: sorted });

    if (sorted.length === 1) {
      // Single item on this track: place it at its absolute time
      const item = sorted[0];
      const pad = videoItemPads.get(item.id);
      const outPad = `vt${trackOutputs.length}`;
      // Shift to absolute position
      filters.push(`[${pad}]setpts=PTS+${f(item.at)}/TB[${outPad}]`);
      trackOutputs.push(outPad);
    } else if (trackOverlaps.length > 0) {
      // Track has transitions: build an xfade chain
      const chainPad = buildXfadeChain(sorted, trackOverlaps, videoItemPads,
        filters, `vt${trackOutputs.length}`);
      trackOutputs.push(chainPad);
    } else {
      // Multiple items, no overlaps: place each at its absolute time on a
      // transparent canvas.
      //
      // Two faults lived here and together they broke the most ordinary
      // edit there is. Both were reproduced against real footage before
      // this fix, and both are now covered by render tests that sample
      // pixels rather than reading the graph string, because the graph
      // string looked right in each case.
      //
      // 1. THE ITEMS WERE NEVER SHIFTED. Each item pad comes out of the
      //    prep loop starting at PTS 0, and only the single-item branch and
      //    the xfade branch shifted them. Here they were overlaid with
      //    `enable='between(t,at,end)'`, gating on the CANVAS's clock. So
      //    for an item at 3s the overlay input had already ended by the
      //    time the window opened, `eof_action=pass` passed the canvas
      //    through, and the item never appeared. Two clips with a hard cut
      //    rendered the first clip and then black, while the audio side
      //    shifted correctly with `adelay` and played over it.
      //
      // 2. THE CANVAS WAS OPAQUE. `color=c=black` has alpha 255, so a
      //    track's output covered everything below it for its whole
      //    duration, not just where its items sat. Any second video track
      //    with two or more items hid the base track completely.
      //
      // The canvas is transparent now. On the base track the final flatten
      // to yuv420p turns that into black, which is the same picture; on a
      // higher track it is what lets the track below show through.
      const basePad = `vtblank${trackOutputs.length}`;
      filters.push(
        `color=c=black@0.0:s=${W}x${H}:r=${fps}:d=${f(compDuration)},format=yuva420p[${basePad}]`
      );
      let current = basePad;
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const pad = videoItemPads.get(item.id);
        const end = secs(item.at + item.len);
        const placedPad = `vt${trackOutputs.length}p${i}`;
        const outPad = `vt${trackOutputs.length}s${i}`;
        // Carry alpha, then move the item to where it belongs in time.
        filters.push(
          `[${pad}]format=yuva420p,setpts=PTS+${f(item.at)}/TB[${placedPad}]`
        );
        filters.push(
          `[${current}][${placedPad}]overlay=`
          + `enable='between(t,${f(item.at)},${f(end)})':eof_action=pass[${outPad}]`
        );
        current = outPad;
      }
      trackOutputs.push(current);
    }
  }

  // ── Composite video tracks together ─────────────────────────────────

  let videoOut = trackOutputs[0] || null;

  if (trackOutputs.length > 1) {
    // Track 0 is the base. Each subsequent track overlays on top.
    // Each higher track needs its items to be transparent where there is
    // no content. We overlay each track's output on the accumulated result.
    let current = trackOutputs[0];
    for (let i = 1; i < trackOutputs.length; i++) {
      const outPad = `vcomp${i}`;
      filters.push(
        `[${current}][${trackOutputs[i]}]overlay=eof_action=pass:format=auto[${outPad}]`
      );
      current = outPad;
    }
    videoOut = current;
  }

  // ── Captions ────────────────────────────────────────────────────────

  let needsCaptions = false;
  if (captionAssPath) {
    const escaped = captionAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const outPad = 'vcap';
    filters.push(`[${videoOut}]subtitles=${escaped}[${outPad}]`);
    videoOut = outPad;
    needsCaptions = true;
  }

  // ── Audio items: trim, gain, place in time ──────────────────────────

  const audioItemPads = []; // { pad, trackIdx, item }

  for (let ti = 0; ti < comp.tracks.length; ti++) {
    const track = comp.tracks[ti];
    for (const item of track.items) {
      const idx = inputIndex.get(item.id);
      if (idx == null) continue;
      const src = comp.sources[item.source];
      if (!src) continue;

      // Audio comes from clip sources (their audio stream) and audio sources
      const hasAudio = src.kind === 'clip' || src.kind === 'audio';
      if (!hasAudio) continue;

      const inPt = item.in || 0;
      const gain = item.gain != null ? item.gain : 1;
      const padName = `ai${idx}`;
      const parts = [];

      parts.push(`atrim=start=${f(inPt)}:duration=${f(item.len)}`);
      parts.push('asetpts=PTS-STARTPTS');

      if (Math.abs(gain - 1) > 0.001) {
        parts.push(`volume=${f(gain)}`);
      }

      // Place at absolute time using adelay (milliseconds)
      const delayMs = Math.round(item.at * 1000);
      if (delayMs > 0) {
        parts.push(`adelay=${delayMs}|${delayMs}`);
      }

      // Pad to the full composition duration so amix inputs are equal length
      parts.push(`apad=whole_dur=${f(compDuration)}`);

      filters.push(`[${idx}:a]${parts.join(',')}[${padName}]`);
      audioItemPads.push({ pad: padName, trackIdx: ti, item });
    }
  }

  // ── Mix audio (with optional ducking) ────────────────────────────────
  //
  // Speech = audio from clip sources (typically on video tracks).
  // Music  = audio from audio-kind sources (typically on audio tracks).
  // When any audio track has duckUnder set (or comp.ducking / opts.ducking
  // is truthy), sidechaincompress lowers the music when speech is present.

  const hasDuckUnder = comp.tracks.some(t => t.duckUnder);
  const ducking = hasDuckUnder || comp.ducking || opts.ducking || null;

  const speechPads = audioItemPads.filter(a => {
    const src = comp.sources[a.item.source];
    return src?.kind === 'clip';
  });
  const musicPads = audioItemPads.filter(a => {
    const src = comp.sources[a.item.source];
    return src?.kind === 'audio';
  });

  let audioOut = null;

  if (audioItemPads.length === 0) {
    // No audio at all
  } else if (!ducking || !speechPads.length || !musicPads.length) {
    // No ducking, or only one kind of audio: plain mix
    if (audioItemPads.length === 1) {
      const outPad = 'aout';
      filters.push(`[${audioItemPads[0].pad}]atrim=0:${f(compDuration)}[${outPad}]`);
      audioOut = outPad;
    } else {
      const mixPads = audioItemPads.map(a => `[${a.pad}]`).join('');
      const outPad = 'aout';
      filters.push(
        `${mixPads}amix=inputs=${audioItemPads.length}:duration=longest:normalize=0,`
        + `atrim=0:${f(compDuration)}[${outPad}]`
      );
      audioOut = outPad;
    }
  } else {
    // Ducking: mix speech, mix music, sidechain compress music, then combine
    const threshold = ducking.threshold || 0.02;
    const ratio = ducking.ratio || 8;
    const attack = ducking.attack || 200;
    const release = ducking.release || 1000;

    let speechMix;
    if (speechPads.length === 1) {
      speechMix = speechPads[0].pad;
    } else {
      speechMix = 'aspeech';
      const pads = speechPads.map(a => `[${a.pad}]`).join('');
      filters.push(`${pads}amix=inputs=${speechPads.length}:duration=longest:normalize=0[${speechMix}]`);
    }

    let musicMix;
    if (musicPads.length === 1) {
      musicMix = musicPads[0].pad;
    } else {
      musicMix = 'amusic';
      const pads = musicPads.map(a => `[${a.pad}]`).join('');
      filters.push(`${pads}amix=inputs=${musicPads.length}:duration=longest:normalize=0[${musicMix}]`);
    }

    // sidechaincompress: music is the main input, speech is the sidechain
    const duckedPad = 'aducked';
    filters.push(
      `[${musicMix}][${speechMix}]sidechaincompress=`
      + `threshold=${f(threshold)}:ratio=${ratio}:`
      + `attack=${attack}:release=${release}[${duckedPad}]`
    );

    // Split the speech signal (consumed by sidechain) and mix with ducked music
    const speechSplit = 'aspsplit';
    // sidechaincompress consumes the sidechain, so we need a copy of speech
    // Actually, sidechaincompress does NOT consume the sidechain in ffmpeg,
    // but we already used it as a filter input. We need to split it before.
    // Let's restructure: split speech first, then use one copy for sidechain
    // and the other for the final mix.

    // Remove the last two filters and rebuild with asplit
    filters.pop(); // remove sidechaincompress
    if (speechPads.length > 1) filters.pop(); // remove speech amix

    // Rebuild: mix speech, split it, sidechain one copy, mix the other with ducked music
    if (speechPads.length === 1) {
      speechMix = speechPads[0].pad;
    } else {
      speechMix = 'aspeech';
      const pads = speechPads.map(a => `[${a.pad}]`).join('');
      filters.push(`${pads}amix=inputs=${speechPads.length}:duration=longest:normalize=0[${speechMix}]`);
    }

    const splitA = 'aspA';
    const splitB = 'aspB';
    filters.push(`[${speechMix}]asplit=2[${splitA}][${splitB}]`);

    filters.push(
      `[${musicMix}][${splitB}]sidechaincompress=`
      + `threshold=${f(threshold)}:ratio=${ratio}:`
      + `attack=${attack}:release=${release}[${duckedPad}]`
    );

    const outPad = 'aout';
    filters.push(
      `[${splitA}][${duckedPad}]amix=inputs=2:duration=longest:normalize=0,`
      + `atrim=0:${f(compDuration)}[${outPad}]`
    );
    audioOut = outPad;
  }

  return {
    inputs,
    graph: filters.join(';'),
    videoOut: videoOut ? `[${videoOut}]` : '',
    audioOut: audioOut ? `[${audioOut}]` : null,
    duration: compDuration,
    needsCaptions,
  };
}

/**
 * Build the ffmpeg arguments array from a render graph result.
 *
 * The caller provides the resolved disk paths in the same order as
 * result.inputs. Returns the full argv for ffmpeg (without the binary path).
 */
export function ffmpegArgs(result, resolvedPaths, outPath, opts = {}) {
  const {
    preset = 'veryfast',
    crf = 20,
    audioBitrate = '160k',
  } = opts;

  const args = ['-y'];
  for (const p of resolvedPaths) {
    args.push('-i', p);
  }

  if (result.graph) {
    args.push('-filter_complex', result.graph);
  }
  if (result.videoOut) {
    args.push('-map', result.videoOut);
  }
  if (result.audioOut) {
    args.push('-map', result.audioOut);
  }

  args.push(
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
  );

  if (result.audioOut) {
    args.push('-c:a', 'aac', '-ar', '48000', '-b:a', audioBitrate);
  }

  args.push('-movflags', '+faststart', outPath);
  return args;
}

// ── Internal helpers ──────────────────────────────────────────────────

function f(n) {
  return secs(n).toFixed(6);
}

/**
 * Build an xfade chain for items on a single track that have overlaps.
 *
 * Items are sorted by `at`. Where two consecutive items overlap, an xfade
 * transition joins them. Where they do not overlap, the gap is handled by
 * placing each item at its absolute time.
 *
 * For a track with transitions, the approach is:
 *   1. Each item is shifted to its absolute position first
 *   2. Consecutive items with overlaps get chained with xfade
 *   3. Non-overlapping segments get overlaid onto a blank canvas
 *
 * This is the most complex part of the graph builder. The xfade filter
 * requires both inputs to be the same resolution and frame rate (guaranteed
 * by the per-item prep above) and outputs a single stream whose duration
 * is input1 + input2 - overlap.
 */
function buildXfadeChain(sorted, trackOverlaps, videoItemPads, filters, prefix) {
  // Build a map of which item pairs have overlaps
  const overlapMap = new Map(); // `${item1.id}-${item2.id}` -> overlap info
  for (const ov of trackOverlaps) {
    const key = `${ov.items[0].id}-${ov.items[1].id}`;
    overlapMap.set(key, ov);
  }

  // Group consecutive items into runs connected by overlaps
  const runs = [];
  let currentRun = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const key = `${prev.id}-${curr.id}`;
    if (overlapMap.has(key)) {
      currentRun.push(curr);
    } else {
      runs.push(currentRun);
      currentRun = [curr];
    }
  }
  runs.push(currentRun);

  // Build each run as an xfade chain (or single item)
  const runOutputs = []; // { pad, startTime, endTime }

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    if (run.length === 1) {
      const item = run[0];
      const pad = videoItemPads.get(item.id);
      const outPad = `${prefix}r${ri}`;
      filters.push(`[${pad}]setpts=PTS+${f(item.at)}/TB[${outPad}]`);
      runOutputs.push({ pad: outPad, startTime: item.at, endTime: itemEnd(item) });
      continue;
    }

    // Multi-item run with xfade transitions
    // First, shift each item to start at 0 (xfade expects inputs starting at 0)
    const shiftedPads = [];
    for (let i = 0; i < run.length; i++) {
      const item = run[i];
      const pad = videoItemPads.get(item.id);
      const sPad = `${prefix}r${ri}s${i}`;
      // Items for xfade need to start at PTS=0
      filters.push(`[${pad}]setpts=PTS-STARTPTS[${sPad}]`);
      shiftedPads.push(sPad);
    }

    // Chain xfades
    let v = shiftedPads[0];
    let chainLen = run[0].len;

    for (let i = 1; i < run.length; i++) {
      const prev = run[i - 1];
      const curr = run[i];
      const key = `${prev.id}-${curr.id}`;
      const ov = overlapMap.get(key);
      const dur = ov ? ov.duration : secs(1 / 30);
      const transType = curr.trans?.type || 'fade';
      const xfadeName = XFADE_NAME[transType] || 'fade';

      const offset = secs(chainLen - dur);
      const outPad = `${prefix}r${ri}x${i}`;
      filters.push(
        `[${v}][${shiftedPads[i]}]xfade=transition=${xfadeName}:duration=${f(dur)}:offset=${f(offset)}[${outPad}]`
      );
      v = outPad;
      chainLen = secs(chainLen + curr.len - dur);
    }

    // Shift the entire chain to the run's start time
    const runStart = run[0].at;
    const finalPad = `${prefix}r${ri}f`;
    filters.push(`[${v}]setpts=PTS+${f(runStart)}/TB[${finalPad}]`);

    const runEnd = secs(runStart + chainLen);
    runOutputs.push({ pad: finalPad, startTime: runStart, endTime: runEnd });
  }

  // If there is only one run, it is the track output
  if (runOutputs.length === 1) {
    return runOutputs[0].pad;
  }

  // Multiple runs: the first run is the base, held to the track's full
  // length, and every later run is overlaid in its own time window.
  //
  // Two faults lived here and both were silent in different ways, so read
  // this before changing it.
  //
  // There used to be a `color=c=black:s=1x1...[<prefix>base]` filter above
  // this, left behind from an abandoned attempt to composite onto a real
  // canvas. Nothing ever consumed it, and ffmpeg refuses an ENTIRE
  // filter_complex that has an unconnected output ("Filter format:default
  // has an unconnected output"). So any track carrying BOTH a transition
  // and a gap produced a graph that could not run at all, in the only video
  // editor there is, and no test covered the multi-run path. Do not
  // reintroduce a producer without a consumer: `graphOrphans()` below is
  // exported so the tests can assert the whole class rather than this case.
  //
  // And `tpad`'s `stop_duration` is the padding ADDED, not the length to
  // reach. Passing the track's end time padded a 7s run out to 19s on a 12s
  // timeline, which the audio side then did not match, so the render came
  // back with video and audio of different lengths. The QC gate this plan
  // adds would have reported it as duration drift and sent the next person
  // looking at the wrong file.
  const maxEnd = Math.max(...runOutputs.map(r => r.endTime));
  let current = runOutputs[0].pad;
  const padNeeded = secs(maxEnd - runOutputs[0].endTime);
  if (padNeeded > EPS) {
    const padded0 = `${prefix}p0`;
    filters.push(`[${current}]tpad=stop_mode=clone:stop_duration=${f(padNeeded)}[${padded0}]`);
    current = padded0;
  }

  for (let i = 1; i < runOutputs.length; i++) {
    const outPad = `${prefix}m${i}`;
    const ro = runOutputs[i];
    filters.push(
      `[${current}][${ro.pad}]overlay=`
      + `enable='between(t,${f(ro.startTime)},${f(ro.endTime)})':eof_action=pass[${outPad}]`
    );
    current = outPad;
  }

  return current;
}

/**
 * Calculate expected output duration from a composition.
 */
// ── Animated transforms ───────────────────────────────────────────────

/**
 * An ffmpeg expression for an animatable value over an item's length.
 *
 * The emitted form is fixed and deliberately dull:
 *
 *   (A+(B-A)*min(max(t/L\,0)\,1))
 *
 * It is the same linear interpolation `animAt` computes in the model, with
 * the same clamp at both ends, which is what lets the agreement test read
 * A, B and L back out and check them against `itemTransformAt` rather than
 * trusting that two implementations drifted the same way.
 *
 * Commas are escaped because ffmpeg splits filter arguments on them.
 */
function animExpr(value, len) {
  if (!isAnim(value)) return null;
  const a = Number(value.from);
  const b = Number(value.to);
  const L = Math.max(len, 1e-6);
  return `(${f(a)}+(${f(b)}-${f(a)})*min(max(t/${f(L)}\\,0)\\,1))`;
}

/** A transform value as a constant, for the static case. */
function animConst(value) {
  return isAnim(value) ? null : value;
}

/**
 * Whether an item asks for anything the transform stage has to draw.
 */
function hasTransform(item) {
  return item.scale != null || item.pos != null || item.rot != null;
}

/**
 * The transform stage: animate the item's size and position inside the frame.
 *
 * The construction is measured rather than reasoned about, and the obvious
 * approach does not work. `scale` cannot animate without `eval=frame`, and
 * once it does the item's own frame size changes per frame, which x264 will
 * not encode and `xfade` will not accept as an input. The fix is to flatten
 * the animated item onto a FIXED-SIZE transparent canvas with `overlay`,
 * which is what hands a constant-dimension stream downstream.
 *
 * Verified on a 100x100 source scaled 1.0x to 2.0x over 4s: 101, 150 and 198
 * pixels a side at t=0.04, 2.0 and 3.9, against 101, 150 and 197.5 predicted
 * by `animAt`. Two such items then xfaded produced a correct output, so it
 * composes with the transition chain rather than fighting it.
 *
 * `pos` is a fraction of the frame, so the same move survives a reframe,
 * which is the rule `overlays.mjs` already held for positioned text.
 *
 * Returns the pad holding the transformed item.
 */
function emitTransform(item, inPad, outPad, W, H, fps, filters) {
  if (item.rot != null) {
    // Honest refusal rather than a silent drop. `rotate`'s output box is
    // init-only (no `T` flag on ow/oh), so an animated rotation needs a
    // constant box sized for the maximum angle, which is a different
    // construction from this one. Until that is built, a composition
    // carrying `rot` must fail loudly: a transform the renderer ignores
    // would be the page claiming output it cannot produce.
    throw new Error(
      `item "${item.id}" sets rot, which the render graph cannot draw yet. `
      + `An animated rotation needs a constant output box sized for the `
      + `maximum angle, because rotate's ow/oh are init-only. Remove rot or `
      + `implement that construction; do not let it render silently without it.`
    );
  }

  const canvas = `${outPad}cv`;
  const scaled = `${outPad}sc`;

  // A transparent canvas at the composition frame. Transparent rather than
  // black so a scaled-down item on a higher track does not blank the track
  // below it; on the base track the final flatten makes it black anyway.
  filters.push(
    `color=c=black@0.0:s=${W}x${H}:r=${fps}:d=${f(item.len)},format=yuva420p[${canvas}]`
  );

  // Size. Both dimensions are rounded to even numbers: an odd intermediate
  // breaks yuv420p downstream, and `-2` alone would let the aspect drift.
  const sExpr = animExpr(item.scale, item.len);
  const sConst = animConst(item.scale);
  const sizeParts = [];
  if (sExpr) {
    sizeParts.push(
      `scale=w='round(${W}*${sExpr}/2)*2':h='round(${H}*${sExpr}/2)*2':eval=frame`
    );
  } else if (sConst != null && sConst !== 1) {
    const w = Math.max(2, Math.round((W * sConst) / 2) * 2);
    const h = Math.max(2, Math.round((H * sConst) / 2) * 2);
    sizeParts.push(`scale=${w}:${h}`);
  }
  sizeParts.push('format=yuva420p');
  filters.push(`[${inPad}]${sizeParts.join(',')}[${scaled}]`);

  // Position. Centred, then offset by the fraction of the frame asked for.
  const posX = item.pos == null ? null
    : isAnim(item.pos) ? animExpr({ from: item.pos.from?.x || 0, to: item.pos.to?.x || 0 }, item.len)
      : item.pos.x || 0;
  const posY = item.pos == null ? null
    : isAnim(item.pos) ? animExpr({ from: item.pos.from?.y || 0, to: item.pos.to?.y || 0 }, item.len)
      : item.pos.y || 0;

  const xTerm = posX == null ? '0'
    : typeof posX === 'number' ? f(W * posX) : `(${W}*${posX})`;
  const yTerm = posY == null ? '0'
    : typeof posY === 'number' ? f(H * posY) : `(${H}*${posY})`;

  filters.push(
    `[${canvas}][${scaled}]overlay=`
    + `x='(main_w-overlay_w)/2+${xTerm}':y='(main_h-overlay_h)/2+${yTerm}'`
    + `:eval=frame:format=auto[${outPad}]`
  );
}

/**
 * Labels the graph produces that nothing consumes.
 *
 * ffmpeg refuses an entire `filter_complex` containing an unconnected
 * output, so an orphan is not untidiness: it is a render that cannot run at
 * all. `declaredOutputs` are the pads the caller maps out of the graph
 * (videoOut, audioOut); they are consumed outside it and are not orphans.
 *
 * Exported so a test can assert the whole class on any composition rather
 * than pinning the one case that was found. A guard that names the incident
 * instead of the decision is the failure this repo keeps re-learning.
 */
export function graphOrphans(graph, declaredOutputs = []) {
  // renderGraph reports its outputs bracketed ("[vt0m1]"), because that is
  // what ffmpegArgs maps. Accept either spelling rather than making every
  // caller remember which one this wants.
  const declared = new Set(
    (declaredOutputs || [])
      .filter(Boolean)
      .map((o) => String(o).replace(/^\[|\]$/g, ''))
  );
  const produced = new Set();
  const consumed = new Set();
  const labelsIn = (m) =>
    m ? [...m[0].matchAll(/\[([A-Za-z0-9_:]+)\]/g)].map((x) => x[1]) : [];

  for (const raw of String(graph || '').split(';')) {
    const chain = raw.trim();
    if (!chain) continue;
    // Leading bracket groups are a filter's inputs; trailing ones its outputs.
    for (const l of labelsIn(chain.match(/^(\[[A-Za-z0-9_:]+\])+/))) consumed.add(l);
    for (const l of labelsIn(chain.match(/(\[[A-Za-z0-9_:]+\])+$/))) produced.add(l);
  }
  return [...produced].filter((p) => !consumed.has(p) && !declared.has(p)).sort();
}

export function expectedDuration(comp) {
  let end = 0;
  for (const track of comp.tracks) {
    for (const item of track.items) {
      const ie = secs(item.at + item.len);
      if (ie > end) end = ie;
    }
  }
  return end;
}
