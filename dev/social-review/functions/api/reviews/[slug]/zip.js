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

// A filename safe to put in a header, with the UTF-8 form alongside it so
// accents survive in browsers that read it.
function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '-');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function onRequestGet({ params, request, env }) {
  if (!SLUG_RE.test(params.slug)) return json({ error: 'Bad slug' }, { status: 400 });

  const manifest = await readManifest(env, params.slug);
  if (!manifest) return json({ error: 'Not found' }, { status: 404 });

  const query = new URL(request.url).searchParams;

  // One post, which is the common case once something is signed off and
  // ready to go out. A single file comes down as itself rather than wrapped
  // in a zip nobody wanted to unpack.
  const postId = query.get('post');
  if (postId) {
    const index = manifest.posts.findIndex((p) => p.id === postId);
    if (index === -1) return json({ error: 'Not found' }, { status: 404 });
    const post = manifest.posts[index];
    const position = pad(index + 1);

    if (post.media.length === 1) {
      const media = post.media[0];
      const object = await env.MEDIA.get(media.key);
      if (!object) return json({ error: 'That file is no longer in storage' }, { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Content-Length', String(object.size));
      headers.set('Content-Disposition', disposition(`${position}-${safeName(media, 0)}`));
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(object.body, { headers });
    }

    const slides = (async function* one() {
      const used = new Set();
      for (const [i, media] of post.media.entries()) {
        const object = await env.MEDIA.get(media.key);
        if (!object) continue;
        let name = safeName(media, i);
        for (let dup = 2; used.has(name); dup += 1) name = `${dup}-${safeName(media, i)}`;
        used.add(name);
        yield { name, stream: object.body, modified: object.uploaded || new Date() };
      }
    })();

    return new Response(zipStream(slides), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': disposition(`${position}-${post.type}.zip`),
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const asked = query.get('set') || 'live';
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
