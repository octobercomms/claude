/**
 * Coverage monitor (native) — scheduled searches across Serper Google News and
 * Google Alerts RSS that drop new hits into pr_editorial_log as status='new'
 * for review. Hits are matched to an outlet (alias-aware) and de-duped by URL.
 */
const axios = require('axios');
const db = require('../db');
const pr = require('./pr');
const serper = require('./serper');
const { getSetting } = require('../utils/settings');
let cheerio;
try { cheerio = require('cheerio'); } catch (e) { cheerio = null; }

const windowDays = (cadence) => (cadence === 'weekly' ? 7 : 1);

async function ingest(clientId, hit, source) {
  const url = (hit.link || '').trim();
  if (!url) return 0;
  const exists = (await db.query('SELECT 1 FROM pr_editorial_log WHERE client_id = $1 AND story_url = $2 LIMIT 1', [clientId, url])).rows.length;
  if (exists) return 0;

  let outletName = (hit.source || '').trim();
  if (!outletName) { try { outletName = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ } }
  const outletId = outletName ? await pr.resolveOutlet(outletName) : null;

  let date = null;
  if (hit.date) { const t = new Date(hit.date); if (!isNaN(t)) date = t.toISOString().slice(0, 10); }

  await db.query(
    `INSERT INTO pr_editorial_log (client_id, story_title, outlet_id, status, issue_date, story_url, source)
     VALUES ($1, $2, $3, 'new', $4, $5, $6)`,
    [clientId, hit.title || '', outletId, date, url, source === 'alerts' ? 'alerts' : 'serper']
  );
  return 1;
}

async function fetchRss(rssUrl) {
  if (!cheerio) return [];
  try {
    const { data } = await axios.get(rssUrl, { timeout: 15000 });
    const $ = cheerio.load(data, { xmlMode: true });
    const hits = [];
    $('entry').each((i, el) => { // Atom (Google Alerts)
      let link = $(el).find('link').attr('href') || '';
      if (link.includes('google.com/url')) { try { link = new URL(link).searchParams.get('url') || link; } catch (e) { /* ignore */ } }
      hits.push({ title: $(el).find('title').first().text().trim(), link, source: '', date: $(el).find('published').text() || $(el).find('updated').text() || '', snippet: '' });
    });
    if (!hits.length) $('item').each((i, el) => { // RSS 2.0
      hits.push({ title: $(el).find('title').first().text().trim(), link: $(el).find('link').first().text().trim(), source: '', date: $(el).find('pubDate').text() || '', snippet: '' });
    });
    return hits;
  } catch (e) { return []; }
}

async function runSearch(s) {
  const sources = (s.sources || 'serper').split(',').map((x) => x.trim()).filter(Boolean);
  let added = 0;
  if (sources.includes('serper') && s.query) {
    const key = await getSetting('SERPER_API_KEY');
    if (key) {
      try { for (const h of await serper.searchNews(key.trim(), s.query, 20)) added += await ingest(s.client_id, h, 'serper'); }
      catch (e) { /* keep going */ }
    }
  }
  if (sources.includes('alerts') && s.alerts_rss) {
    for (const h of await fetchRss(s.alerts_rss)) added += await ingest(s.client_id, h, 'alerts');
  }
  await db.query('UPDATE pr_coverage_searches SET last_run_at = NOW() WHERE id = $1', [s.id]);
  return added;
}

async function runDue() {
  const { rows } = await db.query("SELECT * FROM pr_coverage_searches WHERE status = 'active'");
  for (const s of rows) {
    const win = windowDays(s.cadence);
    const due = !s.last_run_at || (Date.now() - new Date(s.last_run_at).getTime()) >= (win - 0.1) * 86400000;
    if (due) { try { await runSearch(s); } catch (e) { /* keep going */ } }
  }
}

module.exports = { runSearch, runDue };
