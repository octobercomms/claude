import { MetaClient } from './meta-client.js';
import { CAMPAIGNS } from './campaigns/definitions.js';

async function getAdAccountId(client) {
  const accountsRes = await client.getAdAccounts();
  const accounts = accountsRes.data;
  if (!accounts || accounts.length === 0) {
    throw new Error('No ad accounts found for this token.');
  }
  // Use first active account, fall back to first account
  const account = accounts.find(a => a.account_status === 1) || accounts[0];
  console.log(`Using ad account: ${account.name} (${account.id})\n`);
  return account.id;
}

async function createCampaign(client, adAccountId, campaignDef) {
  console.log(`Creating campaign: ${campaignDef.name}`);
  const url = `${adAccountId}/campaigns`;

  const result = await client.post(url, {
    name: campaignDef.name,
    objective: campaignDef.objective,
    status: campaignDef.status,
    daily_budget: campaignDef.daily_budget,
    special_ad_categories: campaignDef.special_ad_categories,
  });

  console.log(`  Created campaign ID: ${result.id}`);
  return result.id;
}

async function createAdSet(client, adAccountId, campaignId, adsetDef) {
  console.log(`  Creating ad set: ${adsetDef.name}`);
  const url = `${adAccountId}/adsets`;

  const payload = {
    name: adsetDef.name,
    campaign_id: campaignId,
    status: adsetDef.status,
    optimization_goal: adsetDef.optimization_goal,
    billing_event: adsetDef.billing_event,
    targeting: adsetDef.targeting,
    // Required by Meta even for PAUSED ad sets
    bid_amount: 500, // $5 max bid in cents — conservative starting point
  };

  const result = await client.post(url, payload);
  console.log(`    Created ad set ID: ${result.id}`);
  console.log(`    Creative brief: ${adsetDef.creative_notes}`);
  return result.id;
}

async function main() {
  console.log('nvelope.co — Meta Campaign Creator');
  console.log('All campaigns created as PAUSED (drafts). Nothing goes live until you unpause.\n');

  const client = new MetaClient();
  const adAccountId = await getAdAccountId(client);

  const created = [];

  for (const campaignDef of CAMPAIGNS) {
    console.log('─'.repeat(60));
    const campaignId = await createCampaign(client, adAccountId, campaignDef);
    const adsetIds = [];

    for (const adsetDef of campaignDef.adsets) {
      const adsetId = await createAdSet(client, adAccountId, campaignId, adsetDef);
      adsetIds.push({ key: adsetDef.key, id: adsetId });
    }

    created.push({ key: campaignDef.key, campaignId, adsetIds });
    console.log('');
  }

  console.log('─'.repeat(60));
  console.log('\nAll campaigns created successfully (PAUSED).\n');
  console.log('Summary:');
  for (const c of created) {
    console.log(`\n  [${c.key}] Campaign ID: ${c.campaignId}`);
    for (const a of c.adsetIds) {
      console.log(`    [${a.key}] Ad Set ID: ${a.id}`);
    }
  }

  console.log('\nNext steps:');
  console.log('  1. Upload creatives (images/video) in Meta Ads Manager');
  console.log('  2. Attach ads to each ad set');
  console.log('  3. Set up Pixel custom audiences for retargeting ad sets');
  console.log('  4. Review and unpause when ready to go live');
  console.log('\n  Or use the optimizer: node src/optimizer.js');
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
