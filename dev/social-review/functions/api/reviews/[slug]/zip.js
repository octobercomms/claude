import { json } from '../../../_lib/auth.js';
import { SLUG_RE, readManifest } from '../../../_lib/store.js';
import { zipStream } from '../../../_lib/zip.js';

const SETS = new Set(['live', 'archived', 'all']);

const pad = (n) => String(n).padStart(2, '0');

// Keeps the client's own filename where there is one, since that is what the
// designer will recognise, and falls back to the key's extension.
function safeName(media, index) {
  const fromKey = (media.key.split('.').pop() || 'bin').toLowerCase();
  const original = (media.name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim();
  return original || `${pad(index + 1)}.${fromKey}`;
}

export async function onRequestGet({ params, request, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });

  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });

  const asked = new URL(request.url).searchParams.get('set') || 'live';
  const set = SETS.has(asked) ? asked : 'live';
  const posts = manifest.posts.filter((p) =>
    set === 'all' ? true : set === 'archived' ? p.archived : !p.archived);

  if (!posts.length) {
    return json({ error: `No ${set === 'archived' ? 'archived ' : ''}posts to download` }, { status: 404 });
  }

  // Each post gets a numbered folder, so a carousel's order survives the
  // round trip and two files of the same name cannot collide.
  const entries = (async function* build() {
    const used = new Set();
    let n = 0;
    for (const post of posts) {
      n += 1;
      const folder = `${pad(n)}-${post.type}`;
      for (const [i, media] of post.media.entries()) {
        const object = await env.MEDIA.get(media.key);
        if (!object) continue; // deleted under us; the rest of the archive still stands
        let name = `${folder}/${safeName(media, i)}`;
        for (let dup = 2; used.has(name); dup += 1) {
          name = `${folder}/${dup}-${safeName(media, i)}`;
        }
        used.add(name);
        yield { name, stream: object.body, modified: object.uploaded || new Date() };
      }
    }
  })();

  const label = (manifest.title || params.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'review';
  const filename = `${label}${set === 'archived' ? '-archived' : ''}-originals.zip`;

  return new Response(zipStream(entries), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
