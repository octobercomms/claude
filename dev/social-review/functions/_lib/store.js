// Review manifests and media both live in R2. No database.
//   reviews/<slug>.json          the manifest
//   media/<slug>/<id>.<ext>      the uploaded files
//   index.json                   list of slugs, newest first

const MANIFEST = (slug) => `reviews/${slug}.json`;
const INDEX = 'index.json';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Short unguessable suffix so a client link cannot be found by trying client names.
export function randomToken(length = 10) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function readManifest(env, slug) {
  const obj = await env.MEDIA.get(MANIFEST(slug));
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

export async function writeManifest(env, manifest) {
  manifest.updated = new Date().toISOString();
  await env.MEDIA.put(MANIFEST(manifest.slug), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return manifest;
}

export async function readIndex(env) {
  const obj = await env.MEDIA.get(INDEX);
  if (!obj) return [];
  try {
    const list = await obj.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeIndex(env, list) {
  await env.MEDIA.put(INDEX, JSON.stringify(list, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function addToIndex(env, entry) {
  const list = (await readIndex(env)).filter((r) => r.slug !== entry.slug);
  list.unshift(entry);
  await writeIndex(env, list);
}

export async function removeFromIndex(env, slug) {
  await writeIndex(env, (await readIndex(env)).filter((r) => r.slug !== slug));
}

export async function touchIndex(env, slug, patch) {
  const list = await readIndex(env);
  const row = list.find((r) => r.slug === slug);
  if (row) {
    Object.assign(row, patch);
    await writeIndex(env, list);
  }
}

// Deletes every media object under a review prefix, honouring R2 list pagination.
export async function deleteMedia(env, slug) {
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix: `media/${slug}/`, cursor });
    if (page.objects.length) {
      await env.MEDIA.delete(page.objects.map((o) => o.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
