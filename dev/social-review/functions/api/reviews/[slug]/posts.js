import { json } from '../../../_lib/auth.js';
import {
  SLUG_RE, deriveType, randomToken, readManifest, touchIndex, writeManifest,
} from '../../../_lib/store.js';

const TYPES = new Set(['reel', 'story', 'carousel', 'post']);

export async function onRequestPost({ params, request, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  const media = Array.isArray(body.media) ? body.media : [];
  if (!media.length) return json({ error: 'No media on that post' }, { status: 400 });

  // Only keys this upload endpoint produced for this review are accepted.
  const prefix = `media/${params.slug}/`;
  const clean = media
    .filter((m) => m && typeof m.key === 'string' && m.key.startsWith(prefix))
    .map((m) => ({
      key: m.key,
      mime: String(m.mime || '').slice(0, 60),
      name: String(m.name || '').slice(0, 120),
      w: Number.isFinite(m.w) ? Math.round(m.w) : null,
      h: Number.isFinite(m.h) ? Math.round(m.h) : null,
    }));
  if (clean.length !== media.length) return json({ error: 'Media rejected' }, { status: 400 });

  const type = deriveType(clean, TYPES.has(body.type) ? body.type : null);

  const post = { id: `p_${randomToken(8)}`, type, media: clean, added: new Date().toISOString() };
  manifest.posts.push(post);

  await writeManifest(env, manifest);
  await touchIndex(env, params.slug, { postCount: manifest.posts.length });
  return json({ post, review: manifest }, { status: 201 });
}
