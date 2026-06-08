// PM2 process config for the October platform backend.
//
// Why this exists: pm2 start src/index.js --name october-platform launches
// the Node process inheriting the OS environment. On cloud Linux that means
// the process runs in UTC even though the AMs and clients are in the UK,
// so `new Date()` logs, cron schedules (when they don't set their own tz),
// scheduler log timestamps, and DB DEFAULT NOW() values were all an hour off
// during BST. Setting TZ here pins the whole Node process to UK local time
// year-round (BST + GMT both auto-handled by IANA tzdata).
module.exports = {
  apps: [
    {
      name: 'october-platform',
      script: 'src/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        TZ: 'Europe/London',
      },
      // pm2 picks up env changes on `pm2 reload --update-env`; restart is
      // fine after a deploy that already pulls a fresh process.
      autorestart: true,
      max_restarts: 10,
      // Restart on memory creep beyond a generous ceiling rather than letting
      // a runaway request degrade the box. 1GB is well above steady-state.
      max_memory_restart: '1G',
    },
  ],
};
