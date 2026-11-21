# Reel Cutter

A single-file browser video editor for short-form social cuts. Open
`dev/reel-cutter/index.html` directly from disk, no server, no install, no
build step, no network.

Built because the Instagram Edits MCP route needs a running desktop app, an
automation server and a rotating bearer token before it does anything. This
needs a double-click.

## What it does

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
- Non-real-time export (see below)
- Anything server-side. No upload, no account, no telemetry

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
