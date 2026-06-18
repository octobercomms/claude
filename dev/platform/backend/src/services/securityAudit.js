// Automated security audit — the engine behind Settings → Security.
//
// It runs a battery of concrete, deterministic checks against the platform's
// actual config and source (the deployed repo the backend runs from), records
// one row per run, and surfaces pass / warn / fail per area so we can show that
// every audit area was checked, when, and what needs attention. A daily cron
// runs it; admins can also "Run now".
//
// Design notes:
//   - Every check is self-contained and resilient: a check that can't run
//     returns an `unknown` finding rather than throwing, so one flaky check
//     never sinks the whole audit.
//   - Checks read the real files on disk (this is the source of truth — the
//     same tree that's deployed) rather than asserting from memory, so the
//     dashboard reflects reality and catches regressions if someone removes a
//     limiter, header, or guard.
//   - We deliberately do NOT claim to find every vulnerability class (deep
//     injection / logic analysis needs a human or an LLM pass). These are the
//     reliably-automatable checks; the manual SECURITY_AUDIT.md prompt stays
//     the deeper, occasional review.

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const pool = require('../db');

// Resolve the repo layout from this file: services → src → backend → platform.
const BACKEND_DIR = path.join(__dirname, '..', '..');         // dev/platform/backend
const PLATFORM_DIR = path.join(BACKEND_DIR, '..');            // dev/platform
const FRONTEND_SRC = path.join(PLATFORM_DIR, 'frontend', 'src');
const NGINX_CONF = path.join(PLATFORM_DIR, 'nginx', 'platform.conf');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

// Walk a directory collecting files matching an extension list (small tree;
// frontend/src and backend/src are a few hundred files — fine to read).
function walk(dir, exts, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

const ok = (id, area, title, detail) => ({ id, area, title, severity: 'info', status: 'pass', detail });
const warn = (id, area, title, severity, detail, recommendation) => ({ id, area, title, severity, status: 'warn', detail, recommendation });
const fail = (id, area, title, severity, detail, recommendation) => ({ id, area, title, severity, status: 'fail', detail, recommendation });
const unknown = (id, area, title, detail) => ({ id, area, title, severity: 'info', status: 'unknown', detail });

// ── Checks ───────────────────────────────────────────────────────────────────
// Each returns a single finding. Order roughly follows the audit areas.

function checkPasswordHashing() {
  const id = 'A1', area = 'Authentication', title = 'Passwords hashed with bcrypt';
  const src = read(path.join(BACKEND_DIR, 'src', 'services', 'users.js'));
  if (/bcrypt/.test(src) && /\.hash\(/.test(src)) return ok(id, area, title, 'users.js hashes passwords with bcrypt before storage.');
  return fail(id, area, title, 'critical', 'No bcrypt hashing found in users.js — passwords may be stored weakly.', 'Hash all passwords with bcrypt (cost ≥ 10) before persisting.');
}

function checkJwtSecret() {
  const id = 'A2', area = 'Authentication', title = 'JWT signing secret is strong';
  const s = process.env.JWT_SECRET || '';
  const weak = ['', 'secret', 'changeme', 'change-me', 'dev', 'development', 'jwt', 'jwtsecret', 'password'];
  if (!s) return fail(id, area, title, 'critical', 'JWT_SECRET is not set — tokens may be forgeable.', 'Set a random JWT_SECRET of at least 32 characters.');
  if (weak.includes(s.toLowerCase()) || s.length < 32) {
    return fail(id, area, title, 'high', `JWT_SECRET is weak (length ${s.length}).`, 'Use a random secret of at least 32 characters and rotate it.');
  }
  return ok(id, area, title, `JWT_SECRET is set and ${s.length} characters long.`);
}

function checkLoginRateLimit() {
  const id = 'A3', area = 'Authentication', title = 'Login is rate-limited (brute-force defence)';
  const idx = read(path.join(BACKEND_DIR, 'src', 'index.js'));
  const limited = /\/api\/auth\/login['"]\s*,\s*authLimiter/.test(idx) || /authLimiter[\s\S]{0,80}\/api\/auth\/login/.test(idx);
  if (limited && /rateLimit\(/.test(idx)) return ok(id, area, title, 'A dedicated rate limiter is mounted on /api/auth/login.');
  return warn(id, area, title, 'high', 'No dedicated rate limiter detected on the login endpoint.', 'Mount an express-rate-limit on /api/auth/login (e.g. 20 attempts / 15 min).');
}

function checkTokenStorage() {
  const id = 'A4', area = 'Authentication', title = 'Session token storage';
  const api = read(path.join(FRONTEND_SRC, 'utils', 'api.js'));
  if (/localStorage\.(get|set)Item\(\s*['"]token/.test(api)) {
    return warn(id, area, title, 'medium',
      'The JWT is stored in localStorage, which is readable by any script — an XSS bug would expose the session.',
      'Defence-in-depth: move to an httpOnly, SameSite=strict cookie so script can\'t read the token. Architectural change — track separately.');
  }
  return ok(id, area, title, 'Token is not kept in localStorage.');
}

function checkClientScoping() {
  const id = 'B1', area = 'Authorisation', title = 'Per-client access scoping middleware present';
  const src = read(path.join(BACKEND_DIR, 'src', 'middleware', 'clientAccess.js'));
  if (/getVisibleClientIds/.test(src) && /canAccessClient/.test(src)) {
    return ok(id, area, title, 'clientAccess.js enforces visible-client scoping (loadVisibleClientIds / requireClientAccess).');
  }
  return warn(id, area, title, 'high', 'Could not confirm per-client scoping middleware.', 'Ensure every client-scoped route checks the caller can see the client.');
}

function checkAdminGuard() {
  const id = 'B2', area = 'Authorisation', title = 'Admin-only routes are guarded server-side';
  const settings = read(path.join(BACKEND_DIR, 'src', 'routes', 'settings.js'));
  const users = read(path.join(BACKEND_DIR, 'src', 'routes', 'users.js'));
  if (/requireAdmin/.test(settings) && /requireAdmin/.test(users)) {
    return ok(id, area, title, 'Settings and Users routes enforce requireAdmin on the server, not just the client.');
  }
  return warn(id, area, title, 'high', 'Admin guard not confirmed on settings/users routes.', 'Apply requireAdmin middleware to all admin-only routes.');
}

function checkSqlInjection() {
  const id = 'C1', area = 'Input handling', title = 'No user input interpolated into SQL';
  const files = walk(path.join(BACKEND_DIR, 'src'), ['.js']);
  const offenders = [];
  // Flag a backtick string that contains a SQL keyword AND interpolates req.*
  // directly (the strong, low-false-positive signal for injection). Parameterised
  // queries use $1/$2 placeholders, so legitimate code won't match.
  const re = /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^`]*\$\{\s*req\.(params|body|query)/i;
  for (const f of files) {
    const txt = read(f);
    if (re.test(txt)) offenders.push(path.relative(PLATFORM_DIR, f));
  }
  if (!offenders.length) return ok(id, area, title, 'No SQL templates interpolate req.params/body/query directly; queries use parameter placeholders.');
  return fail(id, area, title, 'critical', `Possible SQL injection — request input inside a SQL template in: ${offenders.slice(0, 5).join(', ')}.`, 'Use parameterised queries ($1, $2 …) and never interpolate req.* into SQL.');
}

function checkBodyLimit() {
  const id = 'C2', area = 'Input handling', title = 'Request body size is capped';
  const idx = read(path.join(BACKEND_DIR, 'src', 'index.js'));
  if (/express\.json\(\s*\{[^}]*limit\s*:/.test(idx)) return ok(id, area, title, 'express.json is configured with an explicit body-size limit.');
  return warn(id, area, title, 'low', 'No explicit JSON body-size limit found.', 'Set a limit on express.json (e.g. 10mb) to bound memory use.');
}

function checkFrontendSecrets() {
  const id = 'D1', area = 'Secrets', title = 'No hardcoded secrets in frontend source';
  const files = walk(FRONTEND_SRC, ['.js', '.jsx', '.ts', '.tsx']);
  const patterns = [
    [/sk-ant-[A-Za-z0-9-]{8,}/, 'Anthropic key'],
    [/sk_live_[A-Za-z0-9]{8,}/, 'Stripe live key'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
    [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, 'Private key'],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
    [/AIza[0-9A-Za-z_-]{20,}/, 'Google API key'],
  ];
  const hits = [];
  for (const f of files) {
    const txt = read(f);
    for (const [re, label] of patterns) {
      if (re.test(txt)) hits.push(`${label} in ${path.relative(PLATFORM_DIR, f)}`);
    }
  }
  if (!hits.length) return ok(id, area, title, 'No secret-shaped strings found in the frontend bundle source.');
  return fail(id, area, title, 'critical', `Possible secret in client code: ${hits.slice(0, 5).join('; ')}.`, 'Remove the secret, rotate it, and move it server-side. Anything shipped to the browser is public.');
}

function checkEnvIgnored() {
  const id = 'D2', area = 'Secrets', title = '.env is gitignored and not committed';
  const gi = read(path.join(PLATFORM_DIR, '..', '..', '.gitignore'));
  const ignored = /(^|\n)\.env\b/.test(gi) || /(^|\n)\*?\.env/.test(gi);
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '*.env', '.env', '**/.env'], { cwd: path.join(PLATFORM_DIR, '..', '..'), timeout: 8000 }, (err, stdout) => {
      const tracked = (stdout || '').split('\n').map(s => s.trim()).filter(s => s && !s.endsWith('.example'));
      if (tracked.length) {
        return resolve(fail(id, area, title, 'critical', `A .env file is committed to git: ${tracked.slice(0, 3).join(', ')}.`, 'Remove it from history, rotate every secret it held, and add it to .gitignore.'));
      }
      if (!ignored) return resolve(warn(id, area, title, 'medium', '.gitignore does not appear to ignore .env files.', 'Add .env to .gitignore.'));
      return resolve(ok(id, area, title, '.env is gitignored and no .env file is tracked in git.'));
    });
  });
}

function checkErrorFilter() {
  const id = 'E1', area = 'Data exposure', title = 'Client error reporting filters third-party noise';
  const main = read(path.join(FRONTEND_SRC, 'main.jsx'));
  if (/isOurError/.test(main)) return ok(id, area, title, 'Browser error reporting filters out extension/cross-origin errors before logging.');
  return warn(id, area, title, 'low', 'No filtering on the global error reporter.', 'Filter extension/cross-origin errors so the digest reflects real app errors.');
}

function checkStackLeak() {
  const id = 'E2', area = 'Data exposure', title = 'Stack traces not returned to clients';
  const files = walk(path.join(BACKEND_DIR, 'src', 'routes'), ['.js']);
  const offenders = [];
  const re = /res[\s\S]{0,40}\.(send|json)\([^)]*\.stack\b/;
  for (const f of files) { if (re.test(read(f))) offenders.push(path.relative(PLATFORM_DIR, f)); }
  if (!offenders.length) return ok(id, area, title, 'No route returns an error .stack to the client.');
  return warn(id, area, title, 'medium', `Stack trace may be sent to the client in: ${offenders.slice(0, 5).join(', ')}.`, 'Return a generic message; log the stack server-side only.');
}

function checkGlobalRateLimit() {
  const id = 'F1', area = 'API security', title = 'Global per-IP rate limit on the API';
  const idx = read(path.join(BACKEND_DIR, 'src', 'index.js'));
  if (/rateLimit\(/.test(idx) && /app\.use\(\s*['"]\/api['"]\s*,\s*\w*[Ll]imiter/.test(idx)) {
    return ok(id, area, title, 'A global per-IP rate limiter is applied to /api.');
  }
  return warn(id, area, title, 'medium', 'No global rate limiter detected on /api.', 'Apply an express-rate-limit to /api to bound abuse.');
}

function checkCors() {
  const id = 'F2', area = 'API security', title = 'CORS is not wildcard in production';
  const idx = read(path.join(BACKEND_DIR, 'src', 'index.js'));
  if (/cors\(/.test(idx) && /origin:\s*[\s\S]{0,160}PLATFORM_URL/.test(idx)) {
    return ok(id, area, title, 'CORS origin is pinned to PLATFORM_URL in production.');
  }
  if (/origin:\s*['"]\*['"]/.test(idx)) return fail(id, area, title, 'high', 'CORS allows any origin (*).', 'Restrict CORS origin to the platform domain in production.');
  return warn(id, area, title, 'low', 'Could not confirm CORS origin policy.', 'Pin CORS origin to the platform domain in production.');
}

function checkHelmet() {
  const id = 'F3', area = 'API security', title = 'Security headers via Helmet (incl. CSP)';
  const idx = read(path.join(BACKEND_DIR, 'src', 'index.js'));
  if (/helmet\(/.test(idx) && /contentSecurityPolicy/.test(idx)) return ok(id, area, title, 'Helmet is enabled with a Content-Security-Policy on API responses.');
  if (/helmet\(/.test(idx)) return warn(id, area, title, 'low', 'Helmet is enabled but no explicit CSP found.', 'Add a contentSecurityPolicy to Helmet.');
  return warn(id, area, title, 'medium', 'Helmet not detected.', 'Add Helmet to set security response headers.');
}

function checkNginxHeaders() {
  const id = 'H1', area = 'Headers & TLS', title = 'HTTPS redirect + HSTS + frame/sniff headers';
  const conf = read(NGINX_CONF);
  if (!conf) return unknown(id, area, title, 'nginx config not found at the expected path on this host.');
  const https = /return\s+301\s+https/.test(conf);
  const hsts = /Strict-Transport-Security/.test(conf);
  const xfo = /X-Frame-Options/.test(conf);
  const nosniff = /X-Content-Type-Options\s+nosniff/.test(conf);
  const missing = [];
  if (!https) missing.push('HTTPS redirect');
  if (!hsts) missing.push('HSTS');
  if (!xfo) missing.push('X-Frame-Options');
  if (!nosniff) missing.push('nosniff');
  if (!missing.length) return ok(id, area, title, 'nginx forces HTTPS and sets HSTS, X-Frame-Options and nosniff.');
  return warn(id, area, title, 'medium', `nginx is missing: ${missing.join(', ')}.`, 'Add the missing directives to the server block.');
}

function checkNginxCsp() {
  const id = 'H2', area = 'Headers & TLS', title = 'CSP on the served SPA document';
  const conf = read(NGINX_CONF);
  if (!conf) return unknown(id, area, title, 'nginx config not found at the expected path on this host.');
  if (/Content-Security-Policy/.test(conf)) return ok(id, area, title, 'nginx sets a Content-Security-Policy on the SPA document.');
  return warn(id, area, title, 'low',
    'The SPA HTML (served by nginx) has no Content-Security-Policy header — Helmet only covers API responses, not the static document.',
    'Add a Content-Security-Policy header to the nginx server block for defence-in-depth against injected script.');
}

function checkDependencies() {
  const id = 'G1', area = 'Dependencies', title = 'No known-vulnerable backend dependencies';
  return new Promise((resolve) => {
    execFile('npm', ['audit', '--omit=dev', '--json'], { cwd: BACKEND_DIR, timeout: 90000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (!stdout) return resolve(unknown(id, area, title, 'Could not run npm audit on this host (offline or npm unavailable).'));
      let v;
      try { v = JSON.parse(stdout).metadata?.vulnerabilities || {}; } catch { return resolve(unknown(id, area, title, 'npm audit output could not be parsed.')); }
      const crit = v.critical || 0, high = v.high || 0, mod = v.moderate || 0, low = v.low || 0;
      const summary = `critical ${crit}, high ${high}, moderate ${mod}, low ${low}`;
      if (crit > 0) return resolve(fail(id, area, title, 'critical', `npm audit: ${summary}.`, 'Run `npm audit fix` (or upgrade the offending packages) and redeploy.'));
      if (high > 0) return resolve(warn(id, area, title, 'high', `npm audit: ${summary}.`, 'Run `npm audit fix` to clear the high-severity advisories.'));
      if (mod > 0) return resolve(warn(id, area, title, 'low', `npm audit: ${summary}.`, 'Schedule a dependency update to clear moderate advisories.'));
      return resolve(ok(id, area, title, `npm audit clean (${summary}).`));
    });
  });
}

const CHECKS = [
  checkPasswordHashing, checkJwtSecret, checkLoginRateLimit, checkTokenStorage,
  checkClientScoping, checkAdminGuard,
  checkSqlInjection, checkBodyLimit,
  checkFrontendSecrets, checkEnvIgnored,
  checkErrorFilter, checkStackLeak,
  checkGlobalRateLimit, checkCors, checkHelmet,
  checkNginxHeaders, checkNginxCsp,
  checkDependencies,
];

// Run every check (resilient), tally, derive an overall risk level.
async function runChecks() {
  const findings = [];
  for (const check of CHECKS) {
    try {
      findings.push(await check());
    } catch (e) {
      findings.push(unknown('?', 'Unknown', check.name || 'check', `Check threw: ${e.message}`));
    }
  }
  const pass = findings.filter(f => f.status === 'pass').length;
  const warnC = findings.filter(f => f.status === 'warn').length;
  const failC = findings.filter(f => f.status === 'fail').length;
  // action_needed if anything actually failed or a high/critical warning stands;
  // hardening if only low/medium warnings; clean otherwise.
  const hasSerious = findings.some(f => (f.status === 'fail') || (f.status === 'warn' && (f.severity === 'critical' || f.severity === 'high')));
  const risk = failC > 0 || hasSerious ? 'action_needed' : (warnC > 0 ? 'hardening' : 'clean');
  return { findings, pass, warn: warnC, fail: failC, risk };
}

// Run and persist a row. trigger = 'cron' | 'manual'.
async function runAndStore(trigger = 'cron') {
  const r = await runChecks();
  const { rows } = await pool.query(
    `INSERT INTO security_audit_runs (risk, pass_count, warn_count, fail_count, findings, trigger)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [r.risk, r.pass, r.warn, r.fail, JSON.stringify(r.findings), trigger]
  );
  return rows[0];
}

async function getLatest() {
  const { rows } = await pool.query('SELECT * FROM security_audit_runs ORDER BY created_at DESC LIMIT 1');
  return rows[0] || null;
}

async function getHistory(limit = 30) {
  const { rows } = await pool.query(
    'SELECT id, risk, pass_count, warn_count, fail_count, trigger, created_at FROM security_audit_runs ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { runChecks, runAndStore, getLatest, getHistory, CHECK_COUNT: CHECKS.length };
