// The recorder's capture settings.
//
// Capture used to pass a frame rate and nothing else, so it recorded at the
// display's native resolution. That reads like a quality setting and is the
// opposite of one: Chrome's MediaRecorder default bitrate is a flat 2.5 Mbps
// that does not scale with resolution (AddPipe measured ~2.70 Mbps at 480p,
// 1080p and 2160p alike), so a 4K capture was the same number of megabytes as
// a 1080p one with four times as many pixels to spend them on.
//
// The things worth holding onto:
//   - the cap is a `max`, so a small screen is never upscaled;
//   - the bitrate is stated rather than inherited from a browser default;
//   - the composite canvas never exceeds the cap, and comes back even, because
//     yuv420p needs even dimensions.
//
//   node --test tests/captureSettings.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { CAPTURE, displayConstraints, compositeSize, recorderOptions } from '../src/utils/captureSettings.js';

test('display capture is capped with max, never ideal or exact', () => {
  const { video } = displayConstraints();
  assert.deepStrictEqual(video.width, { max: 1920 });
  assert.deepStrictEqual(video.height, { max: 1080 });
  assert.deepStrictEqual(video.frameRate, { max: 30 });
  // `ideal` would upscale a smaller screen to 1080p, spending bitrate on
  // invented pixels; `exact` would make capture fail outright on a screen that
  // cannot hit the number.
  const json = JSON.stringify(video);
  assert.ok(!json.includes('ideal'), 'ideal upscales a small screen');
  assert.ok(!json.includes('exact'), 'exact makes capture fail on an odd screen size');
});

test('the recorder states its bitrate rather than inheriting one', () => {
  const opts = recorderOptions('video/mp4');
  assert.strictEqual(opts.mimeType, 'video/mp4');
  assert.strictEqual(opts.videoBitsPerSecond, 2_500_000,
    'without this MediaRecorder picks its own default and the figure is nobody\'s decision');
  assert.ok(opts.audioBitsPerSecond > 0, 'audio needs a stated bitrate too');
});

test('audio capture is requested, or a walkthrough has no voice on it', () => {
  assert.strictEqual(displayConstraints().audio, true);
});

test('a screen larger than the cap is scaled down to it', () => {
  for (const [w, h, wantW, wantH] of [
    [3840, 2160, 1920, 1080],   // 4K
    [5120, 2880, 1920, 1080],   // 5K iMac
    [2560, 1440, 1920, 1080],   // QHD
    [3440, 1440, 1920, 804],    // ultrawide: width binds, height follows
  ]) {
    const got = compositeSize({ width: w, height: h });
    assert.deepStrictEqual(got, { w: wantW, h: wantH },
      `${w}x${h} should composite at ${wantW}x${wantH}, got ${got.w}x${got.h}`);
    assert.ok(got.w <= CAPTURE.width && got.h <= CAPTURE.height, 'the cap was exceeded');
  }
});

test('a screen at or below the cap is left alone, never upscaled', () => {
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 640]]) {
    assert.deepStrictEqual(compositeSize({ width: w, height: h }), { w, h },
      `${w}x${h} is within the cap and must be recorded as-is`);
  }
});

test('composite dimensions are always even', () => {
  // H.264 with yuv420p chroma subsampling needs even dimensions; an odd canvas
  // height makes the encoder pad or refuse.
  for (const [w, h] of [[3841, 2161], [1365, 767], [999, 333], [2049, 1153], [1920, 1081]]) {
    const { w: gw, h: gh } = compositeSize({ width: w, height: h });
    assert.strictEqual(gw % 2, 0, `width ${gw} is odd (from ${w}x${h})`);
    assert.strictEqual(gh % 2, 0, `height ${gh} is odd (from ${w}x${h})`);
    assert.ok(gw >= 2 && gh >= 2, 'dimensions must stay positive');
  }
});

test('aspect ratio survives the scaling', () => {
  for (const [w, h] of [[3840, 2160], [3440, 1440], [2560, 1600]]) {
    const got = compositeSize({ width: w, height: h });
    const before = w / h, after = got.w / got.h;
    assert.ok(Math.abs(before - after) / before < 0.01,
      `${w}x${h} (${before.toFixed(3)}) came out as ${got.w}x${got.h} (${after.toFixed(3)}) — the picture is stretched`);
  }
});

test('a track with no reported size falls back rather than throwing', () => {
  // getSettings() can come back without width or height on some platforms, and
  // a canvas of NaN by NaN records nothing at all.
  for (const settings of [undefined, null, {}, { width: 0, height: 0 }]) {
    const got = compositeSize(settings);
    assert.ok(Number.isFinite(got.w) && got.w >= 2, `bad size from ${JSON.stringify(settings)}: ${got.w}`);
    assert.ok(Number.isFinite(got.h) && got.h >= 2, `bad size from ${JSON.stringify(settings)}: ${got.h}`);
  }
});

test('the stated bitrate matches what the UI tells you to expect', () => {
  // About 20 MB a minute. If the bitrate changes and this figure does not, the
  // recorder starts quoting a size it is not producing.
  const perMinute = (CAPTURE.videoBitsPerSecond + CAPTURE.audioBitsPerSecond) / 8 * 60;
  assert.ok(perMinute > 18e6 && perMinute < 22e6,
    `${(perMinute / 1e6).toFixed(1)} MB per minute; the 20 MB figure in the docs and comments is now wrong`);
});
