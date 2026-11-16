// Streams media out of R2. Range support matters: Safari and iOS refuse to play
// a video served without 206 responses, and without it nobody can scrub a reel.

export async function onRequest({ request, params, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const path = parts.filter(Boolean).join('/');
  if (!path || path.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9\-/._]*$/.test(path)) {
    return new Response('Bad request', { status: 400 });
  }

  const key = `media/${path}`;
  const wantsRange = request.headers.has('Range');
  const object = await env.MEDIA.get(key, wantsRange ? { range: request.headers } : undefined);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  // Keys are random and never reused, so these are safe to cache hard.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Robots-Tag', 'noindex, nofollow');

  if (wantsRange && object.range) {
    const { offset = 0, length, suffix } = object.range;
    const start = suffix != null ? object.size - suffix : offset;
    const count = suffix != null ? suffix : length ?? object.size - start;
    headers.set('Content-Range', `bytes ${start}-${start + count - 1}/${object.size}`);
    headers.set('Content-Length', String(count));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}
