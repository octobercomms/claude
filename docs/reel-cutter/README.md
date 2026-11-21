# Reel Cutter

A single-file browser video editor for short-form social cuts. Open
`dev/reel-cutter/index.html` directly from disk, no server, no install, no
build step, no network.

Built because the Instagram Edits MCP route needs a running desktop app, an
automation server and a rotating bearer token before it does anything. This
needs a double-click.

## What it does

- **Auto-cut silence**: analyse one long take, find the gaps, split what is left
  into reviewable segments
- Drop in multiple video clips, reorder them, set in/out points per clip
- Per-clip fit: fill frame, fit with black bars, or fit over a blurred copy of
  itself (for landscape footage in a 9:16 frame)
- Per-clip audio level
- Text overlays with timing and position, plus bulk import from pasted SRT
- A music bed with its own level, looped if shorter than the cut
- Canvas presets: 9:16, 4:5, 1:1, 16:9 at 720 or 1080, 24/25/30 fps
- Preview the whole sequence, then export to a downloadable file

## What it does not do

- Transitions, speed ramps, colour grading, keyframes
- Transcription, and therefore any content-aware cutting (see below)
- Non-real-time export (see below)
- Anything server-side. No upload, no account, no telemetry

## Auto-cut, and what it can honestly promise

Point it at one long take and it decodes the audio, builds a 20ms RMS envelope,
and marks everything below a threshold relative to the recording's own peak as
silence. Runs of silence longer than the minimum gap become cuts. What is left
is padded by the breath-room value, merged where padding overlaps, and handed
back as segments. The waveform strip shows kept in accent, cut in grey, and
updates live as you move the three controls.

Splitting turns each segment into an ordinary clip, so trimming, reordering,
captions and export all work on them unchanged.

**Removing silence is automatic. Removing bad takes is not.** There is no
audio-level signal that distinguishes a flubbed line from a good one. Doing it
properly needs transcription, which means pulling a speech model into the page
and losing the offline single-file property. The design decision here is to make
the human pass fast rather than to fake the automatic one: segments are a few
seconds each, with a Play button, so a five minute take is a short click-through.

The **possible retake** tag is a duration heuristic, not a judgement: a segment
within 18% of the length of the next one, with under 1.2s between them, which is
the shape a flubbed line and its second attempt tend to make. It over-flags, and
the UI says so. On the synthetic test clip it tagged two segments where one was a
genuine repeat. It is a pointer to where to look first.

### Threshold behaviour

The threshold is relative to the take's own peak, so it travels between
recordings of different levels. On material with a wide gap between speech and
room tone, a broad span of threshold values gives identical results; the control
only bites near the noise floor. Verified by sweep on the test clip, whose 56 dB
dynamic range produced the same six segments anywhere from −55 to −15 dB, one
segment at −58, and correct sensitivity throughout the minimum-gap control.

### Two ways of reading the audio

**One-pass decode.** `decodeAudioData` on the whole track. Fast, accurate, used
whenever it works.

**Playback measurement.** Safari routinely refuses the one-pass decode for `.MOV`
even while playing the file perfectly well, so the fallback plays the media
through an `AnalyserNode` at zero gain, faster than real time, and samples the
level as it goes. It uses the decoder the browser already proved it has by
rendering the picture. No conversion, no terminal.

The fallback is automatic. The button becomes Stop while it runs, and the
progress readout shows percentage and speed. Speed targets about 45 seconds of
analysis and is capped at 4x, because past that the sampler's spacing gets coarse
enough to miss short gaps. A three minute take takes roughly 45 seconds.

It is slightly coarser than a direct decode. Bins follow the sampler's measured
median spacing, and unmeasured bins are filled by interpolating between
neighbours rather than carrying the last level forward, which would bridge short
silences. The analyser smears each boundary by about one window, so the minimum
gap is relaxed by one bin on this path.

That compensation matters. Before it, a 0.5s silence against a 400ms minimum gap
was found in 2 runs out of 5. After it, 5 out of 5, with segment starts within
0.1s of truth. Expect reliable detection of gaps comfortably above the minimum
and marginal behaviour within about 100ms of it. Lower the minimum gap if short
pauses are being missed.

If a browser stops feeding audio to Web Audio at speed, which some do, the pass
reads as silent and it retries once at 2x before giving up.

### When both fail

The page says so and gives the conversion:

```
ffmpeg -i source.mov -c:v copy -c:a aac converted.mp4
```

## Running it

Open the file in a browser on the machine holding the footage:

```
open dev/reel-cutter/index.html
```

**Use Safari on macOS.** Safari's MediaRecorder writes H.264 video with AAC
audio into an MP4, which Instagram accepts without modification. Chrome will
also produce an MP4 but sometimes writes Opus audio into it, which Instagram
can reject. If that happens, remux without touching the picture:

```
ffmpeg -i reel.mp4 -c:v copy -c:a aac reel-fixed.mp4
```

A browser that only offers WebM (older Chrome, Firefox) will export WebM.
Instagram does not take WebM, so convert:

```
ffmpeg -i reel.webm -c:v libx264 -crf 20 -c:a aac reel.mp4
```

The page detects what the browser supports on load and says so in the pill at
the top right and in the Notes panel.

## Export is real time

Export works by drawing each frame to a canvas, capturing that canvas as a
media stream, mixing the audio through a Web Audio graph, and recording the
result with `MediaRecorder`. That means:

- A 30 second reel takes 30 seconds to export
- The tab must stay in the foreground. Browsers throttle `requestAnimationFrame`
  in background tabs, which drops frames and corrupts the output
- Stopping early still produces a usable file, truncated at the stop point

This is the trade-off for having no dependencies. A WebCodecs implementation
would export faster than real time but needs an MP4 muxer library and loses the
offline, single-file property.

## Verified behaviour

Tested headless with Playwright against generated clips:

| Check | Result |
|---|---|
| Encoder detection | `video/mp4;codecs=avc1` selected in Chromium |
| Clip ingest, trim, reorder | 2 clips, trimmed 5.0s and 4.0s sources to 2.0s and 2.5s |
| Timeline total | 4.5s, matching the sum of trimmed lengths |
| SRT import | 2 cues parsed and added alongside 1 manual overlay |
| Export container | H.264, 1080x1920, 30 fps, valid MP4 |
| Export duration | 4.5s, matching the timeline |
| Composition | Blurred fill and stroked text confirmed by frame extraction |
| Console errors | None |
| Layout at 400px | No horizontal scroll |

The audio track came back as Opus in Chromium, hence the remux note above.

Auto-cut was tested against a generated 14.2s take holding six speech bursts,
five silences and a deliberate flubbed-line-then-retake pair:

| Check | Result |
|---|---|
| Segments found | 6, matching the six bursts |
| Segment starts | 0.0, 1.9, 4.8, 6.9, 8.8, 11.2s against sources at 0.0, 2.0, 4.9, 7.0, 8.9, 11.3s |
| Silence removed | 3.2s of 14.2s, leaving 11.0s |
| Threshold sweep | −58 to −15 dB behaved as expected for the clip's dynamic range |
| Min-gap sweep | 6 segments at 200/400ms, 3 at 900ms, 1 at 2000ms |
| Retake flag | Caught the planted pair, plus one false positive |
| Segment removal then export | 5 segments, 9.3s, valid MP4 at the expected duration |
| Thumbnails | All six segments decode a frame at their in-point |
| Console errors | None |

One bug found and fixed during this pass: `#wave` is an ID selector, so it
outranked the browser's default `[hidden]` rule and the waveform would not hide
after a split. The stylesheet now restates `#wave[hidden] { display: none }`.

The playback-measurement fallback was tested by stubbing `decodeAudioData` to
reject, reproducing Safari's `.MOV` behaviour:

| Check | Result |
|---|---|
| Fallback engages | Automatically, with the button switching to Stop |
| Segments found | 6, matching the direct-decode path |
| Segment starts | Within 0.1s of the direct-decode path on all six |
| Stability | 5 runs of 5 found all six segments |
| Stop mid-analysis | Clean, state unchanged, split stays disabled |
| Direct-decode regression | Unchanged, 6 segments, export valid |
| Multi-clip regression | Unchanged, export valid |
| Console errors | None |

## Known limits

- Clip boundaries can drop a frame or two while the next video element seeks.
  Each clip is pre-seeked during the previous one to reduce it
- `ctx.filter` drives the blurred fill. Where it is unsupported the mode falls
  back to fill frame
- Very large source files are held as object URLs in memory. Several 4K clips
  at once may exhaust a tab
- Source clip frame rates are not conformed. Mixing 24 and 60 fps sources is
  fine but motion will not be identical to a conforming NLE

## Files

Single file, no dependencies: `dev/reel-cutter/index.html`.
