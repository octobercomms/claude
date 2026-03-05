import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'https://graph.facebook.com';

export class MetaClient {
  constructor() {
    this.accessToken = process.env.META_ACCESS_TOKEN;
    this.apiVersion = process.env.META_API_VERSION || 'v22.0';

    if (!this.accessToken) {
      throw new Error('META_ACCESS_TOKEN is not set in .env');
    }
  }

  async get(path, params = {}) {
    const url = new URL(`${BASE_URL}/${this.apiVersion}/${path}`);
    url.searchParams.set('access_token', this.accessToken);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`);
    }

    return data;
  }

  async post(path, body = {}) {
    const url = new URL(`${BASE_URL}/${this.apiVersion}/${path}`);
    url.searchParams.set('access_token', this.accessToken);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.error) {
      throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`);
    }

    return data;
  }

  // Fetch the authenticated user's profile
  async getMe(fields = 'id,name,email') {
    return this.get('me', { fields });
  }

  // List all ad accounts the token has access to
  async getAdAccounts() {
    return this.get('me/adaccounts', {
      fields: 'id,name,account_id,account_status,currency,timezone_name,amount_spent,balance',
    });
  }

  // Get campaigns for a given ad account
  async getCampaigns(adAccountId, fields = 'id,name,status,objective,daily_budget,lifetime_budget') {
    return this.get(`${adAccountId}/campaigns`, { fields });
  }

  // Get ad sets for a given ad account
  async getAdSets(adAccountId, fields = 'id,name,status,daily_budget,targeting,optimization_goal') {
    return this.get(`${adAccountId}/adsets`, { fields });
  }

  // Get ads for a given ad account
  async getAds(adAccountId, fields = 'id,name,status,creative') {
    return this.get(`${adAccountId}/ads`, { fields });
  }

  // Get account-level insights (last 30 days by default)
  async getInsights(adAccountId, params = {}) {
    const defaults = {
      fields: 'impressions,clicks,spend,cpm,cpc,ctr,actions',
      date_preset: 'last_30d',
      level: 'account',
    };
    return this.get(`${adAccountId}/insights`, { ...defaults, ...params });
  }
}
