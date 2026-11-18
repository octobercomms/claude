import { json } from '../../_lib/auth.js';
import {
  SLUG_RE, deleteMedia, deriveType, readManifest, removeFromIndex, touchIndex, writeManifest,
} from '../../_lib/store.js';

const TYPES = new Set(['reel', 'story', 'carousel', 'post']);

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

  // Slide-level editing. The client sends the post's complete new media list,
  // which covers reordering, removing, adding and replacing in one operation.
  if (typeof body.postId === 'string' && Array.isArray(body.media)) {
    const post = manifest.posts.find((p) => p.id === body.postId);
    if (!post) return json({ error: 'That post is no longer in this review' }, { status: 404 });

    const prefix = `media/${params.slug}/`;
    const clean = body.media
      .filter((m) => m && typeof m.key === 'string' && m.key.startsWith(prefix))
      .map((m) => ({
        key: m.key,
        mime: String(m.mime || '').slice(0, 60),
        name: String(m.name || '').slice(0, 120),
        w: Number.isFinite(m.w) ? Math.round(m.w) : null,
        h: Number.isFinite(m.h) ? Math.round(m.h) : null,
      }));
    if (clean.length !== body.media.length) return json({ error: 'Media rejected' }, { status: 400 });
    if (!clean.length) {
      return json({ error: 'A post needs at least one slide. Remove the post instead.' }, { status: 400 });
    }

    const before = post.media.map((m) => m.key);
    post.media = clean;
    // A carousel that drops to one slide is a single post, and vice versa,
    // while a story stays a story.
    post.type = deriveType(clean, post.type);

    const stillUsed = new Set(manifest.posts.flatMap((p) => p.media.map((m) => m.key)));
    const orphans = before.filter((k) => !stillUsed.has(k));
    if (orphans.length) await env.MEDIA.delete(orphans);
  }

  // Choosing between the formats a single file could be: a 9:16 image is
  // either a story or a feed post Instagram will crop, and only a person knows.
  if (typeof body.postId === 'string' && typeof body.setType === 'string') {
    const post = manifest.posts.find((p) => p.id === body.postId);
    if (!post) return json({ error: 'That post is no longer in this review' }, { status: 404 });
    if (!TYPES.has(body.setType)) return json({ error: 'Unknown format' }, { status: 400 });
    if (body.setType === 'story' && post.media.length !== 1) {
      return json({ error: 'A story holds one image or video, not a set.' }, { status: 400 });
    }
    post.type = deriveType(post.media, body.setType);
  }

  // Signed off. Kept rather than deleted: the link may already be out, and
  // a client following it should still find the post they approved.
  if (typeof body.postId === 'string' && typeof body.archived === 'boolean') {
    const post = manifest.posts.find((p) => p.id === body.postId);
    if (!post) return json({ error: 'That post is no longer in this review' }, { status: 404 });
    if (body.archived) post.archived = true; else delete post.archived;
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
  await touchIndex(env, params.slug, {
    title: manifest.title,
    postCount: manifest.posts.length,
    archivedCount: manifest.posts.filter((p) => p.archived).length,
  });
  return json({ review: manifest });
}

export async function onRequestDelete({ params, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });
  await deleteMedia(env, params.slug);
  await env.MEDIA.delete(`reviews/${params.slug}.json`);
  await removeFromIndex(env, params.slug);
  return json({ ok: true });
}
