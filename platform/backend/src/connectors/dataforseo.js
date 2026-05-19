const axios = require('axios');

const authType = 'apikey';

function getClient() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('DataForSEO credentials not configured');

  return axios.create({
    baseURL: 'https://api.dataforseo.com/v3',
    auth: { username: login, password },
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkTokenValidity(credentials) {
  // DataForSEO uses env vars, not per-connector credentials
  const client = getClient();
  const { data } = await client.get('/appendix/user_data');
  if (data.status_code !== 20000) throw new Error('Invalid DataForSEO credentials');
  return true;
}

async function checkRank(keyword) {
  const client = getClient();

  const { data } = await client.post('/serp/google/organic/live/advanced', [{
    keyword: keyword.keyword,
    location_code: keyword.location_code || 2826,
    language_code: 'en',
    device: keyword.device || 'desktop',
    depth: 100,
    se_domain: 'google.co.uk',
  }]);

  if (!data.tasks || !data.tasks[0] || data.tasks[0].status_code !== 20000) {
    return { position: null, url: null };
  }

  const results = data.tasks[0].result?.[0]?.items || [];
  const targetUrl = keyword.target_url;

  // Find the target URL in results
  if (targetUrl) {
    const match = results.find(item =>
      item.type === 'organic' && item.url && item.url.includes(
        new URL(targetUrl).hostname.replace('www.', '')
      )
    );
    if (match) {
      return { position: match.rank_absolute, url: match.url };
    }
  }

  // Return first organic result position if no target URL
  const firstOrganic = results.find(r => r.type === 'organic');
  return firstOrganic
    ? { position: firstOrganic.rank_absolute, url: firstOrganic.url }
    : { position: null, url: null };
}

async function fetchBacklinkData(domain) {
  const client = getClient();
  const { data } = await client.post('/backlinks/summary/live', [{
    target: domain,
    limit: 1,
  }]);

  if (!data.tasks?.[0]?.result?.[0]) return null;
  return data.tasks[0].result[0];
}

async function fetchDomainAuthority(domain) {
  const client = getClient();
  const { data } = await client.post('/domain_analytics/whois/overview/live', [{
    target: domain,
  }]);

  if (!data.tasks?.[0]?.result?.[0]) return null;
  return data.tasks[0].result[0];
}

async function fetchData(credentials, params) {
  const { domain, keyword } = params;
  const results = {};

  if (keyword) results.rank = await checkRank(keyword);
  if (domain) {
    const [backlinks, authority] = await Promise.all([
      fetchBacklinkData(domain),
      fetchDomainAuthority(domain),
    ]);
    results.backlinks = backlinks;
    results.domain_authority = authority;
  }

  return results;
}

module.exports = { authType, checkTokenValidity, checkRank, fetchBacklinkData, fetchDomainAuthority, fetchData };
