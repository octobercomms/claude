// Standalone tests for the WordPress-plugin generate guards. No test framework
// in this project, so this runs with plain
//   node src/routes/wpGenerateGuards.test.js
// and exits non-zero on the first failure. Pure module — no DB, no HTTP.

const assert = require('assert');
const { ALLOWED_MODELS, assessGenerate, makeBurstLimiter } = require('./wpGenerateGuards');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, `FAILED: ${name}`);
  passed++;
}

const goodMessages = [{ role: 'user', content: 'hi' }];

// ── Model allow-list ─────────────────────────────────────────────────────────
check('defaults include the three plugin models',
  ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5'].every(m => ALLOWED_MODELS.includes(m)));

// ── Happy path ───────────────────────────────────────────────────────────────
check('active + allow-listed model + messages → 200',
  assessGenerate({ connectorStatus: 'active', model: 'claude-sonnet-5', messages: goodMessages }).code === 200);
check('null status (freshly paired) is treated as allowed',
  assessGenerate({ connectorStatus: null, model: 'claude-sonnet-5', messages: goodMessages }).code === 200);

// ── Status gate (the kill-switch surface) ────────────────────────────────────
check('revoked connector → 403',
  assessGenerate({ connectorStatus: 'revoked', model: 'claude-sonnet-5', messages: goodMessages }).code === 403);
check('inactive connector → 403',
  assessGenerate({ connectorStatus: 'inactive', model: 'claude-sonnet-5', messages: goodMessages }).code === 403);

// ── Model allow-list enforcement ─────────────────────────────────────────────
check('arbitrary client-supplied model → 403',
  assessGenerate({ connectorStatus: 'active', model: 'gpt-4o', messages: goodMessages }).code === 403);
check('empty model → 403',
  assessGenerate({ connectorStatus: 'active', model: '', messages: goodMessages }).code === 403);

// ── Request shape ────────────────────────────────────────────────────────────
check('missing messages → 400',
  assessGenerate({ connectorStatus: 'active', model: 'claude-sonnet-5', messages: undefined }).code === 400);
check('empty messages array → 400',
  assessGenerate({ connectorStatus: 'active', model: 'claude-sonnet-5', messages: [] }).code === 400);

// Ordering: a revoked site with a bad model still reports revoked first (403),
// and either way a disallowed request never reaches the model call.
check('revoked takes precedence over model check (still 403)',
  assessGenerate({ connectorStatus: 'revoked', model: 'gpt-4o', messages: goodMessages }).code === 403);

// ── Burst limiter ────────────────────────────────────────────────────────────
const allow = makeBurstLimiter({ max: 3, windowMs: 1000 });
const t0 = 1_000_000;
check('burst: 1st allowed', allow('client-a', t0) === true);
check('burst: 2nd allowed', allow('client-a', t0 + 10) === true);
check('burst: 3rd allowed', allow('client-a', t0 + 20) === true);
check('burst: 4th within window blocked', allow('client-a', t0 + 30) === false);
check('burst: a different client is independent', allow('client-b', t0 + 30) === true);
check('burst: window slides — allowed again after it passes', allow('client-a', t0 + 1500) === true);

console.log(`wpGenerateGuards: ${passed} assertions passed`);
