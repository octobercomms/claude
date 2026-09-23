// Node 22 treats `node --test <path>` arguments as files or globs, not
// directories. When given this directory, Node loads index.js, so this file
// makes `node --test dev/falcon-back-in-stock/worker/tests/` run the suite.
import './worker.test.mjs';
import './review-fixes.test.mjs';
