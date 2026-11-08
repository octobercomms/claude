/**
 * Composition renderer service tests.
 *
 * These test the orchestration layer that loads a composition, resolves
 * assets to disk paths, builds the filter graph, spawns ffmpeg and
 * parses its progress output. ffmpeg itself is mocked — no binary
 * needed.
 *
 *   node --test tests/composition-render-service.test.js
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// ── Helpers ─────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

/**
 * Build a minimal composition row as the DB would return it.
 */
function fakeCompRow(overrides = {}) {
  const comp = {
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      s1: { kind: 'clip', asset: 'asset-1', duration: 10, width: 1920, height: 1080, fps: 30 },
    },
    tracks: [
      {
        id: 't1',
        kind: 'video',
        items: [
          { id: 'i1', at: 0, len: 10, source: 's1', in: 0 },
        ],
      },
    ],
    ...(overrides.data || {}),
  };
  return {
    id: 42,
    client_id: 7,
    data: comp,
    source_assets: { s1: 'asset-1' },
    transcripts: {},
    ...(overrides.row || {}),
  };
}

/**
 * Create a mock child process that behaves like ffmpeg.
 */
function mockFfmpegProc({ exitCode = 0, progressLines = [], errorOnSpawn = false } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = null;
  proc.stdout = null;

  // Schedule the emissions after the caller has attached listeners
  process.nextTick(() => {
    if (errorOnSpawn) {
      proc.emit('error', new Error('spawn ENOENT'));
      return;
    }
    for (const line of progressLines) {
      proc.stderr.emit('data', Buffer.from(line + '\n'));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

// ── Test suite ───────────────────────────────────────────────────────

describe('compositionRenderer', () => {
  let compositionRenderer;
  let mockCompositions;
  let mockAssets;
  let spawnCalls;
  let existsSyncOriginal;

  beforeEach(() => {
    spawnCalls = [];

    // Mock require cache for dependencies
    // We need to mock child_process.spawn, compositions.get, assets.get,
    // and fs.existsSync (for asset path validation).

    // Clear the module from cache so each test gets fresh mocks
    delete require.cache[require.resolve('../src/services/compositionRenderer')];

    // Mock compositions service
    mockCompositions = {
      get: mock.fn(async () => fakeCompRow()),
    };

    // Mock assets service
    mockAssets = {
      get: mock.fn(async (id) => ({
        id,
        url: `/api/brand/file/7/clip-${id}.mp4`,
        mime: 'video/mp4',
      })),
    };
  });

  /**
   * Load the service with mocked dependencies injected via a wrapper.
   * Since the module uses require() internally, we intercept via the
   * require cache.
   */
  function loadService({ spawnBehaviour = {}, existsOverride = true } = {}) {
    // Patch compositions mock into the require cache
    const compositionsPath = require.resolve('../src/services/compositions');
    const assetsPath = require.resolve('../src/services/assets');
    const origCompositions = require.cache[compositionsPath];
    const origAssets = require.cache[assetsPath];

    require.cache[compositionsPath] = { id: compositionsPath, filename: compositionsPath, loaded: true, exports: mockCompositions };
    require.cache[assetsPath] = { id: assetsPath, filename: assetsPath, loaded: true, exports: mockAssets };

    // Patch child_process.spawn
    const childProcess = require('child_process');
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function mockedSpawn(cmd, args, opts) {
      spawnCalls.push({ cmd, args, opts });
      return mockFfmpegProc(spawnBehaviour);
    };

    // Patch fs.existsSync so asset path resolution succeeds
    existsSyncOriginal = fs.existsSync;
    if (existsOverride === true) {
      fs.existsSync = (p) => {
        if (typeof p === 'string' && p.startsWith(UPLOAD_ROOT)) return true;
        return existsSyncOriginal(p);
      };
    } else if (typeof existsOverride === 'function') {
      fs.existsSync = existsOverride;
    }

    // Now load the service
    delete require.cache[require.resolve('../src/services/compositionRenderer')];
    compositionRenderer = require('../src/services/compositionRenderer');

    // Return a cleanup function
    return () => {
      childProcess.spawn = originalSpawn;
      fs.existsSync = existsSyncOriginal;
      if (origCompositions) require.cache[compositionsPath] = origCompositions;
      else delete require.cache[compositionsPath];
      if (origAssets) require.cache[assetsPath] = origAssets;
      else delete require.cache[assetsPath];
      delete require.cache[require.resolve('../src/services/compositionRenderer')];
    };
  }

  // ── parseProgress ────────────────────────────────────────────────

  describe('parseProgress', () => {
    it('extracts percentage from a standard ffmpeg progress line', () => {
      // Load with defaults — parseProgress does not need mocked deps
      const cleanup = loadService();
      try {
        const { parseProgress } = compositionRenderer;
        const pct = parseProgress(
          'frame=  120 fps= 30 q=28.0 size=     256kB time=00:00:04.00 bitrate= 524.3kbits/s',
          10,
        );
        assert.ok(pct != null);
        assert.equal(Math.round(pct), 40);
      } finally {
        cleanup();
      }
    });

    it('returns null when the line has no time field', () => {
      const cleanup = loadService();
      try {
        const { parseProgress } = compositionRenderer;
        assert.equal(parseProgress('some random ffmpeg output', 10), null);
      } finally {
        cleanup();
      }
    });

    it('returns null when totalDuration is zero', () => {
      const cleanup = loadService();
      try {
        const { parseProgress } = compositionRenderer;
        assert.equal(
          parseProgress('time=00:00:05.00', 0),
          null,
        );
      } finally {
        cleanup();
      }
    });

    it('clamps percentage to 100', () => {
      const cleanup = loadService();
      try {
        const { parseProgress } = compositionRenderer;
        const pct = parseProgress('time=00:00:15.00', 10);
        assert.equal(pct, 100);
      } finally {
        cleanup();
      }
    });

    it('parses hours and minutes correctly', () => {
      const cleanup = loadService();
      try {
        const { parseProgress } = compositionRenderer;
        // 01:02:03.50 = 3723.5 seconds
        const pct = parseProgress('time=01:02:03.50', 7447);
        assert.ok(pct != null);
        // Should be ~50%
        assert.ok(Math.abs(pct - 50) < 1);
      } finally {
        cleanup();
      }
    });
  });

  // ── Asset resolution ─────────────────────────────────────────────

  describe('assetFilePath', () => {
    // A CLIENT ID IS A UUID. These tests used to resolve
    // '/api/brand/file/7/my-clip.mp4', and passed, while the function's
    // pattern was `(\d+)` for the client segment — so it matched that
    // fixture and matched nothing a real asset has ever carried. It returned
    // null for every asset in the system, every composition render answered
    // `Source "sX" has no file on disk.`, and the editor's Export could never
    // have worked. The fixture was the bug's hiding place, which is why the
    // UUID case is first now.
    const UUID = '44444444-4444-4444-8444-444444444444';

    it('resolves a real client id, which is a UUID', () => {
      const cleanup = loadService();
      try {
        const { assetFilePath } = compositionRenderer;
        const p = assetFilePath({ url: `/api/brand/file/${UUID}/my-clip.mp4` });
        assert.equal(p, path.join(UPLOAD_ROOT, UUID, 'my-clip.mp4'));
      } finally {
        cleanup();
      }
    });

    it('resolves a numeric segment too, since the pattern is opaque', () => {
      const cleanup = loadService();
      try {
        const { assetFilePath } = compositionRenderer;
        const p = assetFilePath({ url: '/api/brand/file/7/my-clip.mp4' });
        assert.equal(p, path.join(UPLOAD_ROOT, '7', 'my-clip.mp4'));
      } finally {
        cleanup();
      }
    });

    it('refuses a path that climbs out of the client\'s own folder', () => {
      // The guard used to check UPLOAD_ROOT rather than the client folder, so
      // a path that escaped one client and landed inside another passed it.
      // That is the one direction that matters: these files are one client's
      // work and another client's render must not be able to read them.
      // EVERY path exists, so a refusal has to come from the guard rather
       // than from the file simply not being there. With the default
       // override only paths inside uploads exist, which means an escaped
       // path returns null for the wrong reason and the guard is untested:
       // removing it left this passing.
      const cleanup = loadService({ existsOverride: () => true });
      try {
        const { assetFilePath } = compositionRenderer;
        for (const url of [
          // The filename climbing out of the client's folder.
          `/api/brand/file/${UUID}/../other/secret.mp4`,
          `/api/brand/file/${UUID}/..`,
          `/api/brand/file/${UUID}/sub/dir/clip.mp4`,
          // And the CLIENT segment climbing out of uploads, which the
          // client-folder check alone does NOT catch: the base lands outside
          // uploads and the filename then sits happily inside it. Two guards,
          // because swapping one for the other is a trade rather than a fix.
          '/api/brand/file/../x',
          '/api/brand/file/../../etc/passwd',
        ]) {
          assert.equal(assetFilePath({ url }), null, `resolved "${url}"`);
        }
      } finally {
        cleanup();
      }
    });

    it('returns null for a non-matching URL', () => {
      const cleanup = loadService();
      try {
        const { assetFilePath } = compositionRenderer;
        assert.equal(assetFilePath({ url: 'https://example.com/video.mp4' }), null);
      } finally {
        cleanup();
      }
    });

    it('returns null when asset has no url', () => {
      const cleanup = loadService();
      try {
        const { assetFilePath } = compositionRenderer;
        assert.equal(assetFilePath({}), null);
        assert.equal(assetFilePath(null), null);
      } finally {
        cleanup();
      }
    });

    it('returns null when the file does not exist on disk', () => {
      const cleanup = loadService({
        existsOverride: (p) => {
          if (p.startsWith(UPLOAD_ROOT)) return false;
          return existsSyncOriginal(p);
        },
      });
      try {
        const { assetFilePath } = compositionRenderer;
        assert.equal(assetFilePath({ url: '/api/brand/file/7/missing.mp4' }), null);
      } finally {
        cleanup();
      }
    });
  });

  // ── renderComposition ────────────────────────────────────────────

  describe('renderComposition', () => {
    it('throws when the composition is not found', async () => {
      mockCompositions.get = mock.fn(async () => null);
      const cleanup = loadService();
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(999),
          /not found/i,
        );
      } finally {
        cleanup();
      }
    });

    it('throws when the composition has no data', async () => {
      mockCompositions.get = mock.fn(async () => ({ id: 1, data: null, source_assets: {} }));
      const cleanup = loadService();
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(1),
          /no data/i,
        );
      } finally {
        cleanup();
      }
    });

    it('throws when an asset is not found in the library', async () => {
      mockAssets.get = mock.fn(async () => null);
      const cleanup = loadService();
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(42),
          /not found/i,
        );
      } finally {
        cleanup();
      }
    });

    it('throws when the asset file is missing from disk', async () => {
      const cleanup = loadService({
        existsOverride: (p) => {
          if (p.startsWith(UPLOAD_ROOT)) return false;
          return existsSyncOriginal(p);
        },
      });
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(42),
          /not found on disk/i,
        );
      } finally {
        cleanup();
      }
    });

    it('spawns ffmpeg with correct arguments for a single-clip composition', async () => {
      const cleanup = loadService();
      try {
        const result = await compositionRenderer.renderComposition(42);

        assert.equal(spawnCalls.length, 1);
        const { cmd, args } = spawnCalls[0];

        // Should use the FFMPEG binary
        assert.ok(typeof cmd === 'string');

        // Should have -y (overwrite)
        assert.ok(args.includes('-y'));

        // Should have at least one -i input
        assert.ok(args.includes('-i'));

        // Should have -filter_complex
        assert.ok(args.includes('-filter_complex'));

        // Should have the output codec
        assert.ok(args.includes('-c:v'));
        assert.ok(args.includes('libx264'));

        // Should output to a temp path
        const outPath = args[args.length - 1];
        assert.ok(outPath.includes('comp-render-42-'));
        assert.ok(outPath.endsWith('.mp4'));

        // Result should have outputPath and duration
        assert.ok(result.outputPath.endsWith('.mp4'));
        assert.equal(result.duration, 10);
      } finally {
        cleanup();
      }
    });

    it('calls onProgress with parsed percentage values', async () => {
      const progressValues = [];
      const progressLines = [
        'frame=   30 fps= 30 q=28.0 size=     128kB time=00:00:01.00 bitrate= 524.3kbits/s',
        'frame=  150 fps= 30 q=28.0 size=     640kB time=00:00:05.00 bitrate= 524.3kbits/s',
        'frame=  300 fps= 30 q=28.0 size=    1280kB time=00:00:10.00 bitrate= 524.3kbits/s',
      ];

      const cleanup = loadService({ spawnBehaviour: { progressLines } });
      try {
        await compositionRenderer.renderComposition(42, {
          onProgress: (pct) => progressValues.push(pct),
        });

        // Should have received progress updates
        assert.ok(progressValues.length >= 3);

        // Values should be increasing
        for (let i = 1; i < progressValues.length; i++) {
          assert.ok(progressValues[i] >= progressValues[i - 1]);
        }

        // First should be ~10%, last should be ~100%
        assert.ok(Math.abs(progressValues[0] - 10) < 1);
        assert.ok(Math.abs(progressValues[progressValues.length - 1] - 100) < 1);
      } finally {
        cleanup();
      }
    });

    it('throws when ffmpeg exits with a non-zero code', async () => {
      const cleanup = loadService({
        spawnBehaviour: {
          exitCode: 1,
          progressLines: ['Error: something went wrong'],
        },
      });
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(42),
          /ffmpeg exited with code 1/,
        );
      } finally {
        cleanup();
      }
    });

    it('throws when ffmpeg fails to spawn', async () => {
      const cleanup = loadService({
        spawnBehaviour: { errorOnSpawn: true },
      });
      try {
        await assert.rejects(
          () => compositionRenderer.renderComposition(42),
          /Failed to spawn ffmpeg/,
        );
      } finally {
        cleanup();
      }
    });

    it('resolves assets via source_assets map then assets.get()', async () => {
      const cleanup = loadService();
      try {
        await compositionRenderer.renderComposition(42);

        // compositions.get should have been called with the id
        assert.equal(mockCompositions.get.mock.calls.length, 1);
        assert.deepEqual(mockCompositions.get.mock.calls[0].arguments, [42]);

        // assets.get should have been called with the asset id from source_assets
        assert.equal(mockAssets.get.mock.calls.length, 1);
        assert.deepEqual(mockAssets.get.mock.calls[0].arguments, ['asset-1']);
      } finally {
        cleanup();
      }
    });

    it('passes encoding options through to ffmpeg arguments', async () => {
      const cleanup = loadService();
      try {
        await compositionRenderer.renderComposition(42, {
          preset: 'slow',
          crf: 18,
          audioBitrate: '256k',
        });

        assert.equal(spawnCalls.length, 1);
        const { args } = spawnCalls[0];
        assert.ok(args.includes('slow'));
        assert.ok(args.includes('18'));
      } finally {
        cleanup();
      }
    });

    it('handles a composition with two sources', async () => {
      const twoSourceRow = fakeCompRow({
        data: {
          sources: {
            s1: { kind: 'clip', asset: 'asset-1', duration: 5, width: 1920, height: 1080, fps: 30 },
            s2: { kind: 'clip', asset: 'asset-2', duration: 5, width: 1920, height: 1080, fps: 30 },
          },
          tracks: [
            {
              id: 't1',
              kind: 'video',
              items: [
                { id: 'i1', at: 0, len: 5, source: 's1', in: 0 },
                { id: 'i2', at: 5, len: 5, source: 's2', in: 0 },
              ],
            },
          ],
        },
        row: {
          source_assets: { s1: 'asset-1', s2: 'asset-2' },
        },
      });

      mockCompositions.get = mock.fn(async () => twoSourceRow);
      const cleanup = loadService();
      try {
        const result = await compositionRenderer.renderComposition(42);

        // Should have resolved both assets
        assert.equal(mockAssets.get.mock.calls.length, 2);

        // ffmpeg should have two -i inputs
        const { args } = spawnCalls[0];
        const inputCount = args.filter(a => a === '-i').length;
        assert.equal(inputCount, 2);

        assert.equal(result.duration, 10);
      } finally {
        cleanup();
      }
    });
  });
});
