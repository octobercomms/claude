// PM2 process config for the OMI video worker.
//
// It exists for two reasons, and the second is the one that cost something.
//
// TZ, for the reason the backend's own config gives: a Node process on cloud
// Linux runs in UTC while the AMs and clients are in the UK, so every
// timestamp this worker logs was an hour out during BST.
//
// AND SO `update.sh` CAN DEPLOY IT. The worker was started by hand with
// `pm2 start index.js --name video-worker`, and `update.sh` had no step for
// `dev/platform/worker/` at all: a merge updated the source on the box and the
// worker went on running the old code until somebody noticed. `pm2 reload`
// pointed at a file starts the process when it is not running and reloads it
// when it is, which is what makes a deploy step safe to run either way; by
// name alone it fails on a box where the worker has never been started.
module.exports = {
  apps: [
    {
      name: 'video-worker',
      script: 'index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        TZ: 'Europe/London',
      },
      autorestart: true,
      max_restarts: 10,
      // One job at a time per process, and ffmpeg is the memory. Lower than
      // the backend's ceiling because this box exists to encode and a
      // runaway here should recycle rather than take the encode queue with
      // it.
      max_memory_restart: '768M',
    },
  ],
};
