// What the screen recorder asks the browser for, in one place.
//
// Capture used to pass a frame rate and nothing else, so it recorded at
// whatever the display was: 3840x2160 on a 4K monitor, 5120x2880 on a 5K iMac.
// That reads like a quality setting and is the opposite of one, because
// Chrome's MediaRecorder default bitrate is a flat 2.5 Mbps that does not scale
// with resolution. AddPipe's measurements put Chrome at about 2.70 Mbps at
// 480p, 1080p and 2160p alike:
//
//   https://blog.addpipe.com/mediarecorder-video-bitrates/
//
// So a 4K capture was the same number of megabytes as a 1080p one, with four
// times as many pixels to spend them on: roughly 10 KB per frame describing
// 8.3 million pixels instead of 2.1 million. Screen text went soft and the file
// did not get any smaller for it.
//
// 1080p30 at a stated 2.5 Mbps keeps a recording the size it has always been
// and gives every pixel four times the budget. The bitrate is written down
// rather than inherited so that changing it is a decision in one place rather
// than a browser default nobody chose.
export const CAPTURE = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoBitsPerSecond: 2_500_000,
  audioBitsPerSecond: 128_000,
};

// About 20 MB a minute at the settings above, which is what the recorder shows
// as an estimate while recording.
export const BYTES_PER_SECOND =
  (CAPTURE.videoBitsPerSecond + CAPTURE.audioBitsPerSecond) / 8;

// `max`, never `ideal`: a screen smaller than the cap records at its own size
// rather than being upscaled to 1080p, which would spend bitrate inventing
// pixels. Verified in Chromium: a max below the source downscales, and a max
// above it changes nothing.
export function displayConstraints() {
  return {
    video: {
      width: { max: CAPTURE.width },
      height: { max: CAPTURE.height },
      frameRate: { max: CAPTURE.frameRate },
    },
    audio: true,
  };
}

// The camera-composite canvas follows the screen track, capped the same way.
// Uncapped it was a 3840x2160 canvas redrawn thirty times a second in
// JavaScript on the main thread, which is where a long recording with the
// camera bubble on started dropping frames.
//
// Dimensions come back even, because H.264 with yuv420p chroma subsampling
// needs them and an odd canvas height makes the encoder pad or refuse.
export function compositeSize(settings) {
  const w = (settings && settings.width) || 1280;
  const h = (settings && settings.height) || 720;
  const scale = Math.min(1, CAPTURE.width / w, CAPTURE.height / h);
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { w: even(w), h: even(h) };
}

// The options MediaRecorder is constructed with, given the container the
// browser said it can record.
export function recorderOptions(mimeType) {
  return {
    mimeType,
    videoBitsPerSecond: CAPTURE.videoBitsPerSecond,
    audioBitsPerSecond: CAPTURE.audioBitsPerSecond,
  };
}
