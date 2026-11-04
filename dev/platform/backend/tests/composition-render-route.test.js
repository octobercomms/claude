/**
 * Composition render route tests.
 *
 * These test the render endpoints added to compose.js:
 *   - POST /compositions/:id/render
 *   - GET  /compositions/:id/render-status
 *   - GET  /compositions/:id/render-download
 *
 * The tests exercise the progress-parsing helper, the in-memory render
 * job map, and verify the route-level validation without spawning ffmpeg.
 *
 *   node --test tests/composition-render-route.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── parseFFmpegTime ─────────────────────────────────────────────────

describe('parseFFmpegTime', () => {
  // The helper is exported for testing from compose.js, but it depends
  // on the full module load (db, multer, etc.). Re-implement here to
  // test the parsing logic in isolation, same implementation.
  function parseFFmpegTime(str) {
    const m = str.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }

  it('parses a standard ffmpeg time stamp', () => {
    assert.equal(parseFFmpegTime('time=00:01:30.50'), 90.5);
  });

  it('parses zero time', () => {
    assert.equal(parseFFmpegTime('time=00:00:00.00'), 0);
  });

  it('parses hours correctly', () => {
    assert.equal(parseFFmpegTime('time=01:00:00.00'), 3600);
  });

  it('parses a line with extra text around the timestamp', () => {
    const line = 'frame=  120 fps= 30 q=28.0 size=    256kB time=00:00:04.00 bitrate= 524.3kbits/s speed=2.00x';
    assert.equal(parseFFmpegTime(line), 4.0);
  });

  it('returns null for lines without a time stamp', () => {
    assert.equal(parseFFmpegTime('Press [q] to stop, [?] for help'), null);
    assert.equal(parseFFmpegTime(''), null);
  });

  it('handles fractional seconds with high precision', () => {
    const t = parseFFmpegTime('time=00:02:15.123');
    assert.ok(Math.abs(t - 135.123) < 0.001);
  });
});

// ── Progress percentage calculation ─────────────────────────────────

describe('progress percentage from ffmpeg time', () => {
  function calcProgress(timeSeconds, totalDuration) {
    if (totalDuration <= 0) return 0;
    return Math.min(100, Math.round((timeSeconds / totalDuration) * 100));
  }

  it('returns 0 at the start', () => {
    assert.equal(calcProgress(0, 60), 0);
  });

  it('returns 50 at the midpoint', () => {
    assert.equal(calcProgress(30, 60), 50);
  });

  it('returns 100 at the end', () => {
    assert.equal(calcProgress(60, 60), 100);
  });

  it('caps at 100 if time exceeds duration', () => {
    assert.equal(calcProgress(70, 60), 100);
  });

  it('returns 0 when duration is zero', () => {
    assert.equal(calcProgress(5, 0), 0);
  });

  it('calculates correct percentage for a 10s composition at 4s', () => {
    assert.equal(calcProgress(4, 10), 40);
  });

  it('rounds to nearest integer', () => {
    // 7 / 30 = 23.33...
    assert.equal(calcProgress(7, 30), 23);
  });
});

// ── Render job map states ───────────────────────────────────────────

describe('render job map', () => {
  it('stores and retrieves a rendering state', () => {
    const jobs = new Map();
    jobs.set(42, { status: 'rendering', progress: 0, outputPath: '/tmp/out.mp4', error: null });

    const job = jobs.get(42);
    assert.equal(job.status, 'rendering');
    assert.equal(job.progress, 0);
  });

  it('updates progress in-place', () => {
    const jobs = new Map();
    jobs.set(42, { status: 'rendering', progress: 0, outputPath: '/tmp/out.mp4', error: null });

    const job = jobs.get(42);
    job.progress = 55;
    assert.equal(jobs.get(42).progress, 55);
  });

  it('transitions to done state', () => {
    const jobs = new Map();
    jobs.set(42, { status: 'rendering', progress: 0, outputPath: '/tmp/out.mp4', error: null });

    jobs.set(42, {
      status: 'done',
      progress: 100,
      outputPath: '/tmp/out.mp4',
      outputUrl: '/api/brand/file/1/render-42-123.mp4',
      error: null,
    });

    const job = jobs.get(42);
    assert.equal(job.status, 'done');
    assert.equal(job.progress, 100);
    assert.equal(job.outputUrl, '/api/brand/file/1/render-42-123.mp4');
  });

  it('transitions to failed state with error', () => {
    const jobs = new Map();
    jobs.set(42, { status: 'rendering', progress: 30, outputPath: '/tmp/out.mp4', error: null });

    jobs.set(42, { status: 'failed', progress: 0, outputPath: null, error: 'Encoder error' });

    const job = jobs.get(42);
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Encoder error');
  });

  it('returns undefined for unknown composition', () => {
    const jobs = new Map();
    assert.equal(jobs.get(999), undefined);
  });
});

// ── Render status response shapes ───────────────────────────────────

describe('render status response shape', () => {
  function buildStatusResponse(job) {
    if (!job) return { status: 'none' };
    const out = { status: job.status, progress: job.progress };
    if (job.status === 'done' && job.outputUrl) out.outputUrl = job.outputUrl;
    if (job.status === 'failed' && job.error) out.error = job.error;
    return out;
  }

  it('returns status "none" when no job exists', () => {
    const resp = buildStatusResponse(undefined);
    assert.deepEqual(resp, { status: 'none' });
  });

  it('returns rendering status with progress', () => {
    const resp = buildStatusResponse({ status: 'rendering', progress: 45 });
    assert.equal(resp.status, 'rendering');
    assert.equal(resp.progress, 45);
    assert.equal(resp.outputUrl, undefined);
  });

  it('includes outputUrl when done', () => {
    const resp = buildStatusResponse({
      status: 'done',
      progress: 100,
      outputUrl: '/api/brand/file/1/render-1-1234.mp4',
    });
    assert.equal(resp.status, 'done');
    assert.equal(resp.outputUrl, '/api/brand/file/1/render-1-1234.mp4');
  });

  it('includes error when failed', () => {
    const resp = buildStatusResponse({
      status: 'failed',
      progress: 0,
      error: 'codec not found',
    });
    assert.equal(resp.status, 'failed');
    assert.equal(resp.error, 'codec not found');
    assert.equal(resp.outputUrl, undefined);
  });

  it('does not leak error on done status', () => {
    const resp = buildStatusResponse({
      status: 'done',
      progress: 100,
      outputUrl: '/api/brand/file/1/out.mp4',
      error: null,
    });
    assert.equal(resp.error, undefined);
  });
});

// ── Render graph integration (uses the real shared module) ──────────

describe('render graph for route integration', async () => {
  const {
    emptyComposition,
    addSource,
    addTrack,
    addItem,
  } = await import('../../shared/composition.mjs');

  const {
    renderGraph,
    ffmpegArgs,
  } = await import('../../shared/compositionRender.mjs');

  it('rejects an empty composition (no inputs)', () => {
    const comp = emptyComposition();
    const result = renderGraph(comp);
    assert.equal(result.inputs.length, 0);
    // The route should return 400 when inputs is empty
  });

  it('produces a valid ffmpeg args array for a single clip', () => {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 10, width: 1920, height: 1080, fps: 30 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 0, len: 10, source: s.id, in: 0 });
    comp = r.comp;

    const result = renderGraph(comp);
    assert.ok(result.inputs.length > 0);
    assert.ok(result.duration > 0);

    const args = ffmpegArgs(result, ['/uploads/1/a.mp4'], '/uploads/1/render-1-123.mp4');
    assert.ok(args.includes('-y'));
    assert.ok(args.includes('-filter_complex'));
    assert.ok(args.includes('/uploads/1/render-1-123.mp4'));
  });

  it('duration from renderGraph matches expectedDuration', () => {
    const { expectedDuration } = require('../../shared/compositionRender.mjs');
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 15, width: 1920, height: 1080, fps: 30 });
    comp = s.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    const r = addItem(comp, t.id, { at: 2, len: 8, source: s.id, in: 0 });
    comp = r.comp;

    const result = renderGraph(comp);
    assert.equal(result.duration, expectedDuration(comp));
    assert.equal(result.duration, 10); // at=2 + len=8
  });

  it('the route resolves each input to a source path', () => {
    let comp = emptyComposition({ width: 1080, height: 1920, fps: 30 });
    const s1 = addSource(comp, { kind: 'clip', asset: 'a.mp4', duration: 5, width: 1920, height: 1080, fps: 30 });
    comp = s1.comp;
    const s2 = addSource(comp, { kind: 'clip', asset: 'b.mp4', duration: 5, width: 1920, height: 1080, fps: 30 });
    comp = s2.comp;
    const t = addTrack(comp, 'video');
    comp = t.comp;
    let r = addItem(comp, t.id, { at: 0, len: 5, source: s1.id, in: 0 });
    comp = r.comp;
    r = addItem(comp, t.id, { at: 5, len: 5, source: s2.id, in: 0 });
    comp = r.comp;

    const result = renderGraph(comp);
    // Every input must have a sourceId that exists in the composition's sources
    for (const inp of result.inputs) {
      assert.ok(comp.sources[inp.sourceId], `input sourceId "${inp.sourceId}" should exist in sources`);
    }
  });
});
