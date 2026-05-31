// One-off diagnostic for the SEO rank checker.
// Loads DataForSEO credentials exactly the way the running server does
// (from the platform_settings table), then reports whether they work.
//
// Run on the server:
//   cd /opt/october-platform && node scripts/test-dataforseo.js

require('dotenv').config();
const db = require('../src/db');
const { decrypt } = require('../src/utils/encryption');
const dataForSEO = require('../src/connectors/dataforseo');

(async () => {
  try {
    const { rows } = await db.query('SELECT key, value FROM platform_settings');
    for (const r of rows) {
      try {
        const d = decrypt(JSON.parse(r.value));
        if (d) process.env[r.key] = d;
      } catch {}
    }
  } catch (e) {
    console.log('Could not read platform_settings:', e.message);
  }

  console.log('DATAFORSEO_LOGIN present:    ', !!process.env.DATAFORSEO_LOGIN);
  console.log('DATAFORSEO_PASSWORD present: ', !!process.env.DATAFORSEO_PASSWORD);

  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    console.log('\n=> FIX: enter DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on the Settings page, then restart the backend.');
    process.exit(0);
  }

  try {
    await dataForSEO.checkTokenValidity();
    console.log('Credentials:                 VALID');
  } catch (e) {
    const detail = e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.log('Credentials:                 REJECTED -', detail);
    console.log('\n=> FIX: the DataForSEO login/password are wrong. Re-enter them on the Settings page.');
    process.exit(0);
  }

  try {
    const r = await dataForSEO.checkRank({ keyword: 'enamel mug', location_code: 2826, device: 'desktop' });
    console.log('Test rank check:             OK ->', JSON.stringify(r));
    console.log('\n=> DataForSEO works. If keywords still show no data, the daily job is not running —');
    console.log('   check pm2 logs for the "[Scheduler] Running daily SEO rank checks" line.');
  } catch (e) {
    const detail = e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.log('Test rank check:             FAILED -', detail);
  }
  process.exit(0);
})();
