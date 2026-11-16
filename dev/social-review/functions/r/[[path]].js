// Serves the client view at /r/<slug> and at /r/<slug>/<postId> for a single post.
//
// Two things to know if you touch this. Pages `_redirects` cannot do the job:
// a `/r/* /review.html 200` line comes back as a 308 to /review and drops the
// slug, so every share link breaks. And Pages serves HTML at its extensionless
// URL, redirecting /review.html to /review, so fetch the clean path first.
export async function onRequestGet(context) {
  const base = new URL(context.request.url);

  const load = async (pathname) => {
    const url = new URL(base);
    url.pathname = pathname;
    url.search = '';
    const request = new Request(url, { headers: context.request.headers, redirect: 'follow' });
    return context.env.ASSETS ? context.env.ASSETS.fetch(request) : fetch(request);
  };

  let asset = await load('/review');
  if (!asset.ok) asset = await load('/review.html');

  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(asset.body, { status: asset.status, headers });
}
