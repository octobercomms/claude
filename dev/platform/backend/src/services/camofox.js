// Camofox — stealth headless browser (Camoufox/Firefox with C++-level
// fingerprint spoofing) exposed over a REST API. We run it as a sibling
// PM2 process on the platform box (see docs/nvelope/external-integrations-plan.md)
// bound to localhost, and use it as the FALLBACK scraping path for the
// pages our plain axios+cheerio scrapers can't reach: competitor landing
// pages, SERPs, and AI-visibility checks that sit behind Cloudflare/Sucuri
// bot challenges or render their content with JavaScript.
//
// This module is the thin REST client only. The fetch-with-fallback wrapper
// that decides WHEN to reach for Camofox (utils/fetchHtml.js) lands in a
// later slice; this slice ships the client + health ping + settings so the
// sidecar can be stood up and verified in isolation.
//
// API model (camofox-browser): tabs are addressable resources.
//   POST   /tabs                 create a tab               { userId, url }
//   POST   /tabs/:id/navigate    point a tab at a URL       { userId, url }
//   GET    /tabs/:id/snapshot    token-efficient a11y text  ?userId=
//   DELETE /tabs/:id             close the tab              ?userId=
//   GET    /health               liveness                   (no auth)
// Auth is an optional bearer token (CAMOFOX_API_KEY) when the server is
// started with one.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

// A stable userId namespaces this client's tabs/sessions on the server so
// concurrent callers don't trample each other's cookies/storage.
const DEFAULT_USER = 'october-platform';

// Generous default — a stealth navigation through a challenge can take a few
// seconds. Health pings override this with a short timeout.
const REQUEST_TIMEOUT_MS = 45000;

async function config() {
  const rawUrl = await getSetting('CAMOFOX_URL');
  const key = await getSetting('CAMOFOX_API_KEY');
  return {
    url: rawUrl ? String(rawUrl).replace(/\/+$/, '') : null,
    key: key || null,
  };
}

// True when an operator has set CAMOFOX_URL in Settings. Callers (the
// fallback wrapper, the health check) use this to no-op cleanly when the
// sidecar isn't deployed — the platform must degrade to today's axios-only
// behaviour, never hard-fail, when Camofox is absent.
async function isConfigured() {
  const { url } = await config();
  return Boolean(url);
}

async function client() {
  const { url, key } = await config();
  if (!url) throw new Error('CAMOFOX_URL not set in Settings');
  return axios.create({
    baseURL: url,
    timeout: REQUEST_TIMEOUT_MS,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

// GET /health — liveness ping for the daily connector health check. Never
// throws; returns a structured status so the caller can fold a failure into
// the existing alert.
async function health() {
  const { url } = await config();
  if (!url) return { ok: false, configured: false, message: 'CAMOFOX_URL not set in Settings' };
  try {
    const http = await client();
    const { data } = await http.get('/health', { timeout: 8000 });
    return { ok: true, configured: true, message: 'Camofox reachable', detail: data };
  } catch (err) {
    return { ok: false, configured: true, message: err.response?.status
      ? `Camofox returned HTTP ${err.response.status}`
      : err.message };
  }
}

// Open a tab pointed at `url`. camofox-browser auto-navigates on create, but
// we don't rely on that — fetchSnapshot issues an explicit navigate too.
async function openTab(url, { userId = DEFAULT_USER } = {}) {
  const http = await client();
  const { data } = await http.post('/tabs', { userId, url });
  const id = data?.id || data?.tabId || data?.tab?.id;
  if (!id) throw new Error('Camofox did not return a tab id on create');
  return id;
}

// Best-effort tab close — we never want a cleanup failure to mask the real
// result, and leaked tabs are reaped by the server's idle shutdown anyway.
async function closeTab(id, { userId = DEFAULT_USER } = {}) {
  if (!id) return;
  try {
    const http = await client();
    await http.delete(`/tabs/${encodeURIComponent(id)}`, { params: { userId } });
  } catch { /* best effort */ }
}

// Fetch the token-efficient accessibility snapshot for a URL through the
// stealth browser. Opens a tab, navigates, reads the snapshot, always closes
// the tab. Returns the snapshot text plus the raw payload for callers that
// want screenshot/links data.
//
// NOTE: this returns the accessibility snapshot, not raw DOM HTML. The
// slice that wires siteAudit/competitorPages (which parse HTML with cheerio)
// must confirm against a running instance whether the snapshot suffices or a
// raw-HTML path is needed — tracked in the integration plan.
async function fetchSnapshot(url, { userId = DEFAULT_USER, includeScreenshot = false } = {}) {
  const http = await client();
  const id = await openTab(url, { userId });
  try {
    await http.post(`/tabs/${encodeURIComponent(id)}/navigate`, { userId, url }).catch(() => {});
    const { data } = await http.get(`/tabs/${encodeURIComponent(id)}/snapshot`, {
      params: { userId, includeScreenshot },
    });
    return { url, via: 'camofox', snapshot: data?.snapshot || '', raw: data };
  } finally {
    await closeTab(id, { userId });
  }
}

// SEAM (Camofox slice 3): return rendered DOM *HTML* for a URL, for callers
// (siteAudit, competitorPages) that parse with cheerio and therefore need real
// HTML, not the accessibility snapshot fetchSnapshot() returns.
//
// camofox-browser's documented content endpoint is the a11y snapshot; whether
// it also exposes raw page HTML (e.g. a content/outerHTML route) has to be
// confirmed against a running instance. Until that's verified this returns
// null on purpose, so fetchRenderedHtml() cleanly degrades to the axios
// result rather than guessing an endpoint. See
// docs/nvelope/external-integrations-plan.md (Camofox slice 2 open question).
async function renderHtml(/* url, opts = {} */) {
  return null;
}

module.exports = { isConfigured, health, openTab, closeTab, fetchSnapshot, renderHtml };
