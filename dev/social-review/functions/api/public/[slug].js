import { json } from '../../_lib/auth.js';
import { SLUG_RE, readManifest } from '../../_lib/store.js';

// What a client with the share link sees. No internal fields.
export async function onRequestGet({ params, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });

  const toUrl = (key) => `/m/${key.slice('media/'.length)}`;

  return json({
    brand: env.BRAND_NAME || 'Content Review',
    title: manifest.title,
    handle: manifest.handle,
    avatar: manifest.avatarKey ? toUrl(manifest.avatarKey) : null,
    posts: manifest.posts.map((p) => ({
      id: p.id,
      type: p.type,
      archived: Boolean(p.archived),
      media: p.media.map((m) => ({ url: toUrl(m.key), mime: m.mime, w: m.w, h: m.h })),
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
