import { MetaClient } from './meta-client.js';

async function verifyConnection() {
  console.log('Connecting to Meta Marketing API...\n');

  const client = new MetaClient();

  // 1. Verify token & get user info
  console.log('Checking access token...');
  const me = await client.getMe();
  console.log(`  Authenticated as: ${me.name} (ID: ${me.id})\n`);

  // 2. List ad accounts
  console.log('Fetching ad accounts...');
  const accountsRes = await client.getAdAccounts();
  const accounts = accountsRes.data;

  if (!accounts || accounts.length === 0) {
    console.log('  No ad accounts found for this token.');
    console.log('  Make sure your token has ads_read or ads_management permissions.');
    return;
  }

  console.log(`  Found ${accounts.length} ad account(s):\n`);

  for (const account of accounts) {
    const statusLabel = account.account_status === 1 ? 'ACTIVE' : `STATUS:${account.account_status}`;
    console.log(`  [${statusLabel}] ${account.name}`);
    console.log(`    ID:       ${account.id}`);
    console.log(`    Currency: ${account.currency}`);
    console.log(`    Timezone: ${account.timezone_name}`);
    if (account.amount_spent) {
      console.log(`    Spent:    ${(account.amount_spent / 100).toFixed(2)} ${account.currency}`);
    }
    console.log('');
  }

  // 3. For the first active account, pull campaign summary
  const activeAccount = accounts.find(a => a.account_status === 1) || accounts[0];
  console.log(`Fetching campaigns for "${activeAccount.name}" (${activeAccount.id})...`);

  const campaignsRes = await client.getCampaigns(activeAccount.id);
  const campaigns = campaignsRes.data;

  if (!campaigns || campaigns.length === 0) {
    console.log('  No campaigns found.');
  } else {
    console.log(`  Found ${campaigns.length} campaign(s):\n`);
    for (const c of campaigns) {
      console.log(`  [${c.status}] ${c.name}`);
      console.log(`    Objective: ${c.objective}`);
      if (c.daily_budget) console.log(`    Daily budget: ${(c.daily_budget / 100).toFixed(2)}`);
      console.log('');
    }
  }

  // 4. Fetch 30-day insights
  console.log(`Fetching 30-day account insights for "${activeAccount.name}"...`);
  try {
    const insightsRes = await client.getInsights(activeAccount.id);
    const insights = insightsRes.data?.[0];
    if (insights) {
      console.log(`  Impressions: ${Number(insights.impressions || 0).toLocaleString()}`);
      console.log(`  Clicks:      ${Number(insights.clicks || 0).toLocaleString()}`);
      console.log(`  Spend:       ${Number(insights.spend || 0).toFixed(2)} ${activeAccount.currency}`);
      console.log(`  CTR:         ${Number(insights.ctr || 0).toFixed(2)}%`);
      console.log(`  CPC:         ${Number(insights.cpc || 0).toFixed(2)} ${activeAccount.currency}`);
    } else {
      console.log('  No insights data available (account may have no spend).');
    }
  } catch (err) {
    console.log(`  Insights not available: ${err.message}`);
  }

  console.log('\nConnection verified successfully.');
  console.log(`\nAdd this to your .env to target this account directly:`);
  console.log(`  META_AD_ACCOUNT_ID=${activeAccount.id}`);
}

verifyConnection().catch(err => {
  console.error('\nConnection failed:', err.message);
  process.exit(1);
});
