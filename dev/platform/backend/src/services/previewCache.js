// In-memory TTL caches for the report preview path. The goal is to make
// iteration on a template feel instant: the first preview pulls live data
// and runs Claude for narratives, subsequent previews in the same window
// reuse both unless the AM forces a refresh or the underlying section
// definition changes.
//
// Two caches:
//   - rawDataCache:   per (clientId, reportType, periodStart, periodEnd)
//                     Holds the dataCollector result for a few minutes so
//                     repeated previews don't re-hit GA4/Shopify/etc.
//
//   - narrativeCache: per (sectionId, prompt, sources signature, period,
//                     clientId, dataHash). Holds the Claude-written
//                     paragraph for a single narrative section.
//                     Changing the section's prompt or sources misses;
//                     reordering sections or editing non-narrative
//                     sections hits.

const crypto = require('crypto');

const RAW_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const NARRATIVE_TTL_MS = 30 * 60 * 1000; // 30 minutes — narratives are
                                         //  expensive to regenerate so we
                                         //  hold them a bit longer.

const rawDataCache = new Map();
const narrativeCache = new Map();

function rawKey({ clientId, reportType, periodStart, periodEnd }) {
  return `${clientId}|${reportType}|${periodStart}|${periodEnd}`;
}

function hashJson(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj || null)).digest('hex').slice(0, 16);
}

function getRawData(key) {
  const entry = rawDataCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > RAW_TTL_MS) {
    rawDataCache.delete(key);
    return null;
  }
  return entry;
}

function setRawData(key, value) {
  rawDataCache.set(key, { value, at: Date.now() });
}

function narrativeKey({ clientId, section, period, dataHash }) {
  // Include the prompt + sources + section.id in the key so any meaningful
  // change misses the cache, but reordering sections or editing other
  // sections hits.
  return [
    clientId, period,
    section.id, section.prompt || '',
    JSON.stringify(section.sources || []),
    dataHash,
  ].join('|');
}

function getNarrative(key) {
  const entry = narrativeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > NARRATIVE_TTL_MS) {
    narrativeCache.delete(key);
    return null;
  }
  return entry.value;
}

function setNarrative(key, value) {
  narrativeCache.set(key, { value, at: Date.now() });
}

// Drop everything — admins might want a clean slate if they suspect
// stale data (called via the preview endpoint with `force_refresh`).
function invalidateClient(clientId) {
  for (const key of rawDataCache.keys()) if (key.startsWith(`${clientId}|`)) rawDataCache.delete(key);
  for (const key of narrativeCache.keys()) if (key.startsWith(`${clientId}|`)) narrativeCache.delete(key);
}

module.exports = {
  rawKey, hashJson, getRawData, setRawData,
  narrativeKey, getNarrative, setNarrative,
  invalidateClient,
  RAW_TTL_MS, NARRATIVE_TTL_MS,
};
