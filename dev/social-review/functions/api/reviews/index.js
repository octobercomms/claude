import { json } from '../../_lib/auth.js';
import { addToIndex, readIndex, randomToken, slugify, writeManifest } from '../../_lib/store.js';

export async function onRequestGet({ env }) {
  return json({ reviews: await readIndex(env) });
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }

  const title = String(body.title || '').trim().slice(0, 80);
  if (!title) return json({ error: 'Give the review a name' }, { status: 400 });

  const base = slugify(title) || 'review';
  const slug = `${base}-${randomToken(6)}`;

  const manifest = {
    slug,
    title,
    // Usually the brand name sits at the front of the title; the team edits it if not.
    handle: base.split('-').slice(0, 2).join(''),
    avatarKey: null,
    created: new Date().toISOString(),
    posts: [],
  };

  await writeManifest(env, manifest);
  await addToIndex(env, { slug, title, created: manifest.created, postCount: 0 });

  return json({ review: manifest }, { status: 201 });
}
