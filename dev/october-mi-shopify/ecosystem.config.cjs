// PM2 process config for the October MI Shopify app.
//
// Lives alongside the platform backend on the same box but as its own PM2
// process so each can be restarted independently. Port 3002 — the nginx
// vhost for omi.octobercomms.com proxies here.
//
// Real env vars (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL,
// SCOPES, OMI_FORWARD_SECRET, DATABASE_URL) come from .env in this folder,
// loaded by dotenv inside the Remix server. They are NOT committed here.
module.exports = {
  apps: [
    {
      name: 'october-mi-shopify',
      script: 'node_modules/@remix-run/serve/dist/cli.js',
      args: 'build/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        TZ: 'Europe/London',
        PORT: '3002',
      },
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
    },
  ],
};
