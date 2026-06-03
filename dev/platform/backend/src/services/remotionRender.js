// Remotion render orchestration — bundles the compositions once at
// first use, caches the bundle, then renders A/C/G clips on demand.
//
// Bundling pulls Webpack + the React tree into memory; doing it once
// and caching saves ~10s on every render after the first. Rendering
// itself spins up a headless Chromium (already bundled by Remotion)
// and writes an MP4 to disk.
//
// We deliberately don't pre-warm at server boot — the platform doesn't
// need Remotion if no AM is rendering A/C/G. First-render cost is the
// price of admission, then it stays fast.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REMOTION_ENTRY = path.join(__dirname, '../../remotion/index.jsx');
const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

let bundlePromise = null;

async function ensureBundle() {
  if (bundlePromise) return bundlePromise;
  // Lazy import — pulls in 100MB of deps; we only do this on the first
  // render so a backend that never touches Remotion stays light.
  const { bundle } = require('@remotion/bundler');
  bundlePromise = bundle({
    entryPoint: REMOTION_ENTRY,
    webpackOverride: (config) => config,
  });
  return bundlePromise;
}

async function renderComposition({ compositionId, inputProps, clientId, durationFrames }) {
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const serveUrl = await ensureBundle();

  const composition = await selectComposition({
    serveUrl, id: compositionId, inputProps,
  });

  // Override duration when the AM gave us a non-default — e.g. a longer
  // A hook for a 4s read, or a shorter C card for a punchy beat.
  const finalComposition = durationFrames
    ? { ...composition, durationInFrames: durationFrames }
    : composition;

  const dir = path.join(UPLOAD_ROOT, clientId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${compositionId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`;
  const outputLocation = path.join(dir, filename);

  await renderMedia({
    serveUrl,
    composition: finalComposition,
    codec: 'h264',
    outputLocation,
    inputProps,
    imageFormat: 'jpeg',
    concurrency: 1,           // single-core safe default
  });

  return {
    url: `/api/brand/file/${clientId}/${filename}`,
    duration_sec: finalComposition.durationInFrames / finalComposition.fps,
    width: finalComposition.width,
    height: finalComposition.height,
  };
}

// Higher-level convenience — pull style + text from a storyboard frame
// and a client's brand assets, render the right composition.
async function renderFrameForPost(post, frame, brandAssets) {
  if (!['A', 'C', 'G'].includes(frame.style)) {
    throw new Error(`Cannot auto-render style ${frame.style} — only A, C, G are no-film styles.`);
  }
  const palette = brandAssets.find(a => a.kind === 'palette');
  const colours = palette?.metadata?.colors || [];
  const brandColour = colours[0] || '#E7CD41';

  let inputProps, compositionId;
  const fps = 30;
  const durationFrames = Math.max(1, Math.round((frame.duration_sec || defaultDuration(frame.style)) * fps));

  if (frame.style === 'A') {
    compositionId = 'styleA';
    inputProps = {
      text: frame.on_screen_text || frame.shot || 'Your hook here.',
      brandColour,
      textColour: '#ffffff',
      background: '#000000',
    };
  } else if (frame.style === 'C') {
    compositionId = 'styleC';
    inputProps = {
      text: frame.on_screen_text || frame.shot || 'word.',
      textColour: '#ffffff',
      background: '#000000',
    };
  } else {
    compositionId = 'styleG';
    inputProps = {
      cta: frame.on_screen_text || 'octobercomms.com',
      secondary: frame.voiceover || 'Book a call',
      brandColour,
      textColour: '#ffffff',
      background: '#000000',
    };
  }
  return renderComposition({
    compositionId, inputProps,
    clientId: post.client_id,
    durationFrames,
  });
}

function defaultDuration(style) {
  return ({ A: 3, C: 1.5, G: 4 }[style] || 3);
}

module.exports = { renderComposition, renderFrameForPost, ensureBundle };
