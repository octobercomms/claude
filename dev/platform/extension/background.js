// OMI Xero Brain background service worker.
// Proxies fetch requests from the content script so they use the extension's
// own origin (with host_permissions) instead of the page's origin, which is
// subject to CORS and blocks cross-origin requests to the OMI backend.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'brain-fetch') {
    handleFetch(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: 'network', message: err.message }));
    return true; // keep the message channel open for async response
  }
});

async function handleFetch({ url, method, headers, body }) {
  const opts = { method: method || 'GET', headers: headers || {} };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, ok: res.ok, data };
}
