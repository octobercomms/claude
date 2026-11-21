import { json } from '../_lib/auth.js';
import { SLUG_RE, randomToken, readManifest } from '../_lib/store.js';

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

// Cloudflare caps a request body at 100MB on the free plan. Stay clear of the edge.
const MAX_BYTES = 95 * 1024 * 1024;

// The browser checks this too and says it better, with a link. This is the
// backstop for anything that gets past it.
const OVER_LIMIT = 'That file is over 95MB, which is Cloudflare\'s cap on a single '
  + 'upload. Compress it with HandBrake (handbrake.fr) and try again.';

export async function onRequestPost({ request, env }) {
  const slug = new URL(request.url).searchParams.get('slug') || '';
  if (!SLUG_RE.test(slug)) return json({ error: 'Bad slug' }, { status: 400 });
  if (!(await readManifest(env, slug))) return json({ error: 'Review not found' }, { status: 404 });

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) {
    return json({ error: OVER_LIMIT }, { status: 413 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload failed to parse' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file' }, { status: 400 });

  const mime = file.type || '';
  const ext = EXT[mime];
  if (!ext) {
    return json({ error: `${mime || 'That file type'} is not supported. Use JPG, PNG, WebP or MP4.` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return json({ error: OVER_LIMIT }, { status: 413 });
  }

  const key = `media/${slug}/${randomToken(14)}.${ext}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  });

  return json({
    key,
    mime,
    name: String(file.name || '').slice(0, 120),
    size: file.size,
    url: `/m/${slug}/${key.split('/').pop()}`,
  }, { status: 201 });
}
