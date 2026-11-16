import { isSignedIn, json } from './_lib/auth.js';

// Endpoints a client with a share link must reach without signing in.
const PUBLIC_API = [/^\/api\/login$/, /^\/api\/logout$/, /^\/api\/session$/, /^\/api\/public\//];

export async function onRequest(context) {
  const { request, next } = context;
  const { pathname } = new URL(request.url);

  if (pathname.startsWith('/api/') && !PUBLIC_API.some((re) => re.test(pathname))) {
    if (!(await isSignedIn(request, context.env))) {
      return json({ error: 'Not signed in' }, { status: 401 });
    }
  }

  const response = await next();
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  // Share links should not sit in Google's index.
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, headers });
}
