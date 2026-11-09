/**
 * What actually renders a composition, and the loop that keeps doing it.
 *
 * The important property here is that this takes a COMPOSITION ID and nothing
 * else. Everything a render needs — the timeline, the asset paths, which
 * sources are photographs, the compiled caption file, the ffmpeg arguments —
 * is derived here, at the moment of rendering.
 *
 * That is the whole difference from what it replaces. The route used to build
 * all of it during the HTTP request and capture it in a closure pushed onto an
 * array, which had four consequences:
 *
 *   - the work existed only in memory, so a restart lost it while its row
 *     still read 'queued' with nothing anywhere that could run it;
 *   - each queued closure kept the Express `req` alive, because the ffmpeg
 *     exit handler read `req.user?.id`, so thirty queued renders retained
 *     thirty request contexts;
 *   - the caption ASS was compiled at enqueue time and only unlinked when its
 *     ffmpeg process ended, so a queued job held a temp file for its whole
 *     wait and a restart leaked it. Thirty captioned enqueues meant thirty
 *     files resident until the last render finished;
 *   - and a render could not be resumed by anything, because resuming would
 *     have meant reconstructing a closure.
 *
 * Deriving it here fixes all four at once: a claimed row carries enough to
 * rebuild the job from scratch, so a fresh process can pick up where a dead
 * one stopped.
 *
 * ONE RENDER AT A TIME, still. ffmpeg on the app box is the constraint, not
 * the queue, and this is honest about it: thirty renders take thirty renders'
 * worth of wall clock. What has changed is that they no longer vanish. Moving
 * the encode to the worker box is a separate piece of work — the box has no
 * shared disk and pulls its inputs over HTTPS, so it is a file-transfer
 * project rather than a flag.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const compositions = require('./compositions');
const assets = require('./assets');
const queue = require('./compositionRenderQueue');
const { buildCaptionAss, assetFilePath } = require('./compositionRenderer');
const renderQc = require('./renderQc');
// ONE ffmpeg for the whole backend. Reading FFMPEG_PATH here instead would
// put a second answer to "which ffmpeg" in the tree, which is the exact state
// services/ffmpegBin.js exists to have ended: pointing FFMPEG_PATH at a
// candidate build would then upgrade the editor's export and not a batch's,
// and two versions in one request path fail only in the half nobody is
// looking at. tests/ffmpeg-bin.test.js caught this import missing.
const { FFMPEG } = require('./ffmpegBin');
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const RENDER_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'compositionRender.mjs');

/**
 * Who this process is, in the queue.
 *
 * It has to be stable across a restart of THIS instance and distinct from any
 * other instance, because `releaseClaimsBy` uses it to hand back only its own
 * work. pm2 sets NODE_APP_INSTANCE per instance; the hostname separates boxes.
 */
const WORKER = process.env.RENDER_WORKER_ID
  || `app-${process.env.NODE_APP_INSTANCE || '0'}@${require('os').hostname()}`;

let _renderMod = null;
async function renderMod() {
  if (!_renderMod) _renderMod = await import(pathToFileURL(RENDER_PATH).href);
  return _renderMod;
}

function parseFFmpegTime(str) {
  const m = str.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

/**
 * Everything a render needs, from a composition id.
 *
 * Throws with a message meant for a person when the composition cannot be
 * rendered at all. The caller decides whether that is a 400 to somebody
 * waiting or a failed row in a batch; either way the reason is the same
 * sentence, which is why it is produced in one place.
 */
async function prepare(compositionId, options = {}) {
  const comp = await compositions.get(compositionId);
  if (!comp) throw new Error(`Composition ${compositionId} no longer exists.`);

  const data = comp.data;
  if (!data || !data.tracks || !data.sources) {
    throw new Error('This composition has no timeline yet.');
  }

  // Resolve each source to a file, and learn which are photographs.
  //
  // `source_assets[id] || src.asset` rather than the column alone. The column
  // is what the editor writes; a composition built by a template carries the
  // asset inside the source spec, because the binder mints its source ids at
  // bind time and cannot pre-compute the column's keys. The route resolved
  // only the column, so every template-built composition answered
  // `Source "sX" has no file on disk.` while the service path beside it had
  // always done both.
  const sourceAssets = comp.source_assets || {};
  const sourcePaths = {};
  const stillSources = new Set();
  for (const [sourceId, src] of Object.entries(data.sources || {})) {
    const assetId = sourceAssets[sourceId] || src.asset;
    if (assetId) {
      const asset = await assets.get(assetId);
      if (asset) {
        const fp = assetFilePath(asset);
        if (fp) sourcePaths[sourceId] = fp;
        // The asset row is where a hand-built composition learns that its
        // source is a photograph rather than footage: `kind` is 'image' for
        // anything with an image/* mime.
        if (asset.kind === 'image') stillSources.add(sourceId);
      }
    }
    // A source may carry a usable path of its own (a template bound to files
    // on disk, a fixture). Never overwrite an asset-resolved path with it.
    if (!sourcePaths[sourceId] && typeof src.url === 'string' && src.url.startsWith('/')
        && fs.existsSync(src.url)) {
      sourcePaths[sourceId] = src.url;
    }
    if (src.kind === 'clip' && src.still === true) stillSources.add(sourceId);
  }

  // Captions, compiled HERE rather than at enqueue time, so a render waiting
  // in the queue holds no temp file and a restart leaks none.
  const captionAssPath = await buildCaptionAss(data, compositionId, comp.transcripts || {});

  const rm = await renderMod();
  const graph = rm.renderGraph(data, { sourcePaths, captionAssPath, stillSources });

  if (!graph.inputs.length) {
    throw new Error('This composition has nothing to render.');
  }

  const resolved = [];
  for (const inp of graph.inputs) {
    // An fx layer is generated by ffmpeg and has no file. Its slot is kept
    // rather than skipped: inputs are numbered by position, so dropping one
    // would point every later `[n:v]` at the wrong file.
    if (inp.generated) {
      resolved.push(null);
      continue;
    }
    const p = sourcePaths[inp.sourceId];
    if (!p) {
      throw new Error(
        `Source "${inp.sourceId}" has no file on disk, so this cannot be rendered.`
      );
    }
    resolved.push(p);
  }

  const outDir = path.join(UPLOAD_ROOT, String(comp.client_id));
  fs.mkdirSync(outDir, { recursive: true });

  return { comp, graph, resolved, captionAssPath, outDir, options };
}

/**
 * Clean up a prepared render that is not going to run.
 *
 * The ASS file exists the moment `prepare` returns, so every path that does
 * not reach ffmpeg has to remove it. Attached here rather than at each caller
 * so a path added later cannot leak one.
 */
function discard(prepared) {
  if (prepared?.captionAssPath) {
    fs.promises.unlink(prepared.captionAssPath).catch(() => {});
  }
}

/**
 * Run one claimed render to completion.
 *
 * Resolves when the render has finished, one way or the other. It does not
 * throw for a failed render: a failure is recorded on the row, because the
 * drainer's job is to keep going and a batch's job is to report per item.
 */
async function renderOne(job) {
  let prepared;
  try {
    prepared = await prepare(job.composition_id);
  } catch (err) {
    // A composition that cannot be prepared will not prepare on a retry
    // either: a missing asset, an empty timeline and an unresolvable caption
    // are all states of the data rather than circumstance.
    await queue.fail(job.id, err.message, { retry: false });
    return { ok: false, error: err.message };
  }

  const { comp, graph, resolved, captionAssPath, outDir } = prepared;
  const outputPath = path.join(outDir, `render-${comp.id}-${job.id}.mp4`);
  const rm = await renderMod();
  const args = rm.ffmpegArgs(graph, resolved, outputPath, prepared.options || {});

  return new Promise((resolve) => {
    const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    if (captionAssPath) {
      const release = () => { fs.promises.unlink(captionAssPath).catch(() => {}); };
      ff.once('close', release);
      ff.once('error', release);
    }

    let stderr = '';
    let lastWrite = 0;

    ff.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
      if (!graph.duration) return;
      const lines = stderr.split('\r');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const t = parseFFmpegTime(lines[i]);
        if (t == null) continue;
        const now = Date.now();
        // Every five seconds, which is also what refreshes the lease. A
        // render that reports nothing for the lease is taken to be dead, so
        // this write is load-bearing rather than cosmetic.
        if (now - lastWrite > 5000) {
          lastWrite = now;
          queue.setProgress(job.id, (t / graph.duration) * 100).catch(() => {});
        }
        break;
      }
    });

    ff.on('error', async (err) => {
      // The binary is missing or could not be executed. Worth one retry: a
      // box mid-deploy can fail to spawn and be fine a minute later.
      await queue.fail(job.id, `Could not start ffmpeg: ${err.message}`, { retry: true })
        .catch(() => {});
      resolve({ ok: false, error: err.message });
    });

    ff.on('close', async (code) => {
      if (code !== 0) {
        const tail = stderr.split('\n').slice(-6).join('\n').trim();
        // ffmpeg refusing a graph is not circumstance; it will refuse the
        // same graph next time.
        await queue.fail(job.id, tail || `ffmpeg exited ${code}`, { retry: false })
          .catch(() => {});
        resolve({ ok: false, error: tail || `ffmpeg exited ${code}` });
        return;
      }

      let bytes = null;
      try { bytes = fs.statSync(outputPath).size; } catch { /* reported below */ }
      const outputUrl = `/api/brand/file/${comp.client_id}/${path.basename(outputPath)}`;

      // Measure it before calling it done.
      //
      // A batch of thirty is only useful if the review sheet can say which
      // two to watch first; otherwise "a batch saved me an afternoon" becomes
      // "a batch gave me thirty videos to watch". This is where the one
      // measurement pass happens, on a file that is finished and about to be
      // handed to a person.
      //
      // It never throws and never blocks the completion: `check` returns an
      // 'unmeasured' verdict rather than failing, because the video exists
      // either way and losing a good render over a QC pass would be the
      // worst possible trade.
      const qc = await renderQc.check(outputPath, comp.data)
        .catch((err) => ({
          verdict: 'unmeasured',
          checks: [{ id: 'measure', level: 'skipped', says: err.message }],
          says: `Could not be measured: ${err.message}`,
          rank: -1,
        }));

      // `source_id` keyed on the JOB id, not a timestamp. It was
      // `render-${compId}-${Date.now()}`, and assets.record upserts on
      // (source, source_id), so two renders of one composition started in the
      // same millisecond collapsed onto a single library row.
      await assets.record({
        client_id: comp.client_id,
        // `composition`, not `scene_render`. They shared a source until
        // migration 251, so the Library called every one of these a "Scene
        // template" and the disk sweep could not be pointed at them without
        // archiving the scene-template feature's rows too.
        source: 'composition',
        source_id: `render-${comp.id}-${job.id}`,
        title: `${comp.title || 'Composition'} (render)`,
        url: outputUrl,
        mime: 'video/mp4',
        bytes,
        created_by: comp.created_by || null,
        duration_s: graph.duration || null,
        metadata: {
          composition_id: comp.id,
          render_id: job.id,
          rendered_at: new Date().toISOString(),
          qc_verdict: qc?.verdict || null,
        },
      }).catch(() => {});

      await queue.complete(job.id, { outputPath, outputUrl, qc }).catch(() => {});
      resolve({ ok: true, outputPath, outputUrl, qc });
    });
  });
}

// ── the drainer ──────────────────────────────────────────────────────

let _draining = false;

/**
 * Claim and render until there is nothing left.
 *
 * Re-entrant by design: anything that enqueues work calls this, and a second
 * call while one is already running returns at once rather than starting a
 * parallel encode. The single `_draining` flag is what keeps it to one ffmpeg
 * in this process; the database claim is what keeps it to one renderer per
 * row across every process.
 */
async function drain() {
  if (_draining) return 0;
  _draining = true;
  let done = 0;
  try {
    for (;;) {
      let job;
      try {
        job = await queue.claimNext(WORKER);
      } catch (err) {
        console.error('[render] claim failed:', err.message);
        break;
      }
      if (!job) break;
      try {
        await renderOne(job);
      } catch (err) {
        // renderOne records its own failures; this is for a fault in the
        // recording itself, which must not stop the drain.
        console.error(`[render] job ${job.id} threw outside the render:`, err.message);
        await queue.fail(job.id, err.message, { retry: false }).catch(() => {});
      }
      done += 1;
    }
  } finally {
    _draining = false;
  }
  return done;
}

/** Kick the drain without waiting for it, for a route that has replied. */
function kick() {
  drain().catch((err) => console.error('[render] drain failed:', err.message));
}

let _reaper = null;

/**
 * Start rendering: hand back what this instance was holding, then keep the
 * queue moving.
 *
 * The release is the part that matters on a deploy. Rows this instance had at
 * 'rendering' name a process that no longer exists, and waiting out the
 * fifteen-minute lease would stall a batch for a quarter of an hour for no
 * reason. Scoped to this worker's own name, so another instance's live
 * renders are untouched.
 */
async function start({ reapEveryMs = 5 * 60 * 1000 } = {}) {
  try {
    const released = await queue.releaseClaimsBy(WORKER);
    if (released.length) {
      console.log(
        `[render] ${WORKER} restarted holding ${released.length} render(s); `
        + `${released.filter((r) => r.status === 'queued').length} requeued`
      );
    }
  } catch (err) {
    console.error('[render] could not release claims at startup:', err.message);
  }

  if (!_reaper) {
    _reaper = setInterval(() => {
      queue.reapStale()
        .then((rows) => {
          if (rows.length) {
            console.warn(
              `[render] reaped ${rows.length} stale render(s): `
              + rows.map((r) => `${r.id}→${r.status}`).join(', ')
            );
          }
        })
        .catch((err) => console.error('[render] reaper failed:', err.message));
    }, reapEveryMs);
    // Never hold the process open for the reaper.
    if (_reaper.unref) _reaper.unref();
  }

  kick();
}

function stop() {
  if (_reaper) { clearInterval(_reaper); _reaper = null; }
}

module.exports = {
  WORKER,
  prepare,
  discard,
  renderOne,
  drain,
  kick,
  start,
  stop,
};
