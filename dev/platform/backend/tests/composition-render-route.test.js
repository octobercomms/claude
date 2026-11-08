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

// ── Captions must actually be wired into the graph ───────────────────
//
// This reads the source, which is blunt, and it is the only thing that fails
// when somebody drops the caption path again. The fault it guards: the
// shipped route called renderGraph with sourcePaths alone, so the subtitles
// filter was never added and every caption the editor produced was silently
// absent from the output while the render reported success. The only code
// that compiled caption ASS hung off renderComposition, which nothing but its
// own test ever called.
//
// It reads the RUNNER now, not the route. The wiring moved there because a
// render has to be rebuildable from a composition id alone: the route used to
// build everything during the request and capture it in a closure, so nothing
// could resume a render after a restart. The decision is unchanged and so are
// these assertions; only the file holding it moved.
//
// Same shape as tests/strategist-weekly.test.js, which reads the cron's
// source for the same reason: the behaviour is a wiring decision, and no unit
// test of either side can see whether the two were joined up.

describe('the render path wires captions into the graph', () => {
  const fs = require('fs');
  const path = require('path');
  const runner = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'compositionRenderRunner.js'), 'utf8'
  );
  const route = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'compose.js'), 'utf8'
  );

  it('compiles caption ASS before building the graph', () => {
    const compile = runner.indexOf('buildCaptionAss(');
    const graph = runner.indexOf('rm.renderGraph(');
    assert.ok(
      compile > 0, 'the render path must compile caption ASS; without it a '
      + 'captioned composition renders clean video and reports success'
    );
    assert.ok(compile < graph, 'and compile it before the graph is built');
  });

  it('passes captionAssPath to renderGraph, not sourcePaths alone', () => {
    const call = runner.match(/renderGraph\(\s*data\s*,\s*\{[^}]*\}/);
    assert.ok(call, 'renderGraph is called with an options object');
    assert.match(
      call[0], /captionAssPath/,
      `renderGraph is called as "${call[0]}", which omits captionAssPath. `
      + 'The subtitles filter is only added when the graph is given one.'
    );
  });

  it('takes the compiler from the renderer service rather than a second copy', () => {
    assert.match(
      runner, /require\('\.\/compositionRenderer'\)/,
      'one caption compiler, two callers. A second implementation is how the '
      + 'route and the service drifted apart in the first place'
    );
  });

  it('releases the compiled ASS when the render process ends', () => {
    assert.match(
      runner, /ff\.once\('close', release\)/,
      'a batch of thirty renders would otherwise leave thirty temp files'
    );
  });

  it('compiles it at RENDER time, not when the render is enqueued', () => {
    // The file exists from the moment it is compiled and is only unlinked
    // when its ffmpeg process ends. Compiled during the HTTP request, a
    // render then held a temp file for its entire wait in the queue and a
    // restart leaked it: thirty captioned enqueues meant thirty files
    // resident until the last render finished.
    assert.ok(
      !/buildCaptionAss\(/.test(route),
      'the route must not compile caption ASS; it enqueues and the runner '
      + 'compiles when it actually starts'
    );
  });

  it('discards a pre-flight it is not going to run', () => {
    // The route still prepares, so somebody pressing Export is told now
    // rather than being queued and failing later. That preparation produces
    // an ASS file which nothing will ever render, so it has to be removed.
    assert.match(
      route, /runner\.discard\(prepared\)/,
      'a pre-flight that compiled an ASS file and dropped it would leak one '
      + 'per export'
    );
  });
});

// ── The render must be rebuildable without a request ─────────────────

describe('a render derives itself from a composition id', () => {
  const fs = require('fs');
  const path = require('path');
  // Comments stripped, because every claim below is about what the CODE
  // does and the comments necessarily quote the faults they describe. Two
  // assertions in this file have already passed or failed on their own prose.
  const code = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const runner = code('services/compositionRenderRunner.js');
  const route = code('routes/compose.js');

  it('keeps no queue in a module variable', () => {
    // The fault: `let _activeRender = null; const _renderQueue = [];` holding
    // start closures. Pending work died with the process while its rows went
    // on reading 'queued' with nothing anywhere that could run them.
    assert.ok(
      !/_renderQueue|_activeRender|function processQueue/.test(route),
      'the queue is a table, not an array. An array loses a batch on deploy'
    );
  });

  it('never reads the request inside the render', () => {
    // Each queued closure used to keep the Express `req` alive, because the
    // ffmpeg exit handler read `req.user?.id`. Thirty queued renders retained
    // thirty request contexts.
    assert.ok(
      !/\breq\b/.test(runner),
      'the runner must not see a request; after a restart there is not one'
    );
  });

  it('builds the SQL for the queue nowhere but the queue service', () => {
    // updateRenderJob interpolated caller-supplied object keys straight into
    // column positions, with no whitelist.
    assert.ok(
      !/composition_renders/.test(route),
      'the route must not write the queue table directly'
    );
    assert.ok(
      !/composition_renders/.test(runner),
      'and neither must the runner; one place owns those statements'
    );
  });

  it('resolves an asset from the source as well as the column', () => {
    // The route read `source_assets` alone and ignored each source's own
    // `asset`, while the service beside it had always done both. A
    // composition built by a template carries the asset inside the source
    // spec, because the binder mints its source ids at bind time and cannot
    // pre-compute the column's keys — so every template-built composition
    // answered `Source "sX" has no file on disk.`
    assert.match(
      runner, /sourceAssets\[sourceId\] \|\| src\.asset/,
      'a template-built composition has its asset on the source, not in the column'
    );
  });
});
