import { json } from '../../_lib/auth.js';
import {
  SLUG_RE, deleteMedia, readManifest, removeFromIndex, touchIndex, writeManifest,
} from '../../_lib/store.js';

export async function onRequestGet({ params, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });
  return json({ review: manifest });
}

export async function onRequestPatch({ params, request, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  if (typeof body.title === 'string' && body.title.trim()) {
    manifest.title = body.title.trim().slice(0, 80);
  }
  if (typeof body.handle === 'string') {
    manifest.handle = body.handle.trim().replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
  }
  if (typeof body.avatarKey === 'string' && body.avatarKey.startsWith(`media/${params.slug}/`)) {
    manifest.avatarKey = body.avatarKey;
  }

  // Reorder by a list of post ids. Ids not in the list keep their relative order at the end.
  if (Array.isArray(body.order)) {
    const byId = new Map(manifest.posts.map((p) => [p.id, p]));
    const reordered = body.order.map((id) => byId.get(id)).filter(Boolean);
    const seen = new Set(reordered.map((p) => p.id));
    manifest.posts = [...reordered, ...manifest.posts.filter((p) => !seen.has(p.id))];
  }

  if (typeof body.removePostId === 'string') {
    const post = manifest.posts.find((p) => p.id === body.removePostId);
    manifest.posts = manifest.posts.filter((p) => p.id !== body.removePostId);
    if (post) {
      // Media no longer referenced by any post is removed from the bucket.
      const stillUsed = new Set(manifest.posts.flatMap((p) => p.media.map((m) => m.key)));
      const orphans = post.media.map((m) => m.key).filter((k) => !stillUsed.has(k));
      if (orphans.length) await env.MEDIA.delete(orphans);
    }
  }

  await writeManifest(env, manifest);
  await touchIndex(env, params.slug, { title: manifest.title, postCount: manifest.posts.length });
  return json({ review: manifest });
}

export async function onRequestDelete({ params, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  await deleteMedia(env, params.slug);
  await env.MEDIA.delete(`reviews/${params.slug}.json`);
  await removeFromIndex(env, params.slug);
  return json({ ok: true });
}
