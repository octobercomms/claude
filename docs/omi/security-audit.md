# Security audit (Settings → Security)

A standing, automated security checklist for the OMI platform itself. It proves
every audit area was checked, re-runs nightly, and flags anything that needs
attention — admin-only, under **Settings → Security**.

## What it is

- **Engine:** `backend/src/services/securityAudit.js` runs ~19 deterministic
  checks against the platform's real config and source (the deployed tree the
  backend runs from), plus `npm audit` and, for `H3`, the connector table. Each check returns a finding:
  `{ id, area, title, severity, status: pass|warn|fail|unknown, detail, recommendation }`.
- **Storage:** one row per run in `security_audit_runs` (migration `092`),
  with counts and the full findings JSON.
- **Schedule:** a daily cron at 02:30 (`scheduler.js`) stores a fresh run.
- **API:** `GET /api/security/audit` (latest + history, seeds a run if empty),
  `POST /api/security/audit/run` ("Run now"). Both admin-only.
- **UI:** `frontend/src/components/SecurityPanel.jsx` — overall risk badge,
  last-run time, pass/warn/fail tally, an "items to review" summary, and the
  full checklist grouped by area.

## Areas covered

Authentication (bcrypt, JWT secret strength, login rate-limit, token storage),
Authorisation (client scoping, admin guards), Input handling (SQL-injection
scan, body-size cap), Secrets (frontend secret scan, `.env` not committed),
Data exposure (error filtering, stack-trace leaks), API security (global
rate-limit, CORS, Helmet/CSP), Headers & TLS (nginx HTTPS/HSTS/frame/sniff,
SPA-document CSP), Dependencies (`npm audit`), Client sites (the PHP each
connected WordPress site runs).

## H3 — the one check that looks outside the platform

Every other check reads this platform's own config and source. `H3` reads the
`connectors` table and reports any connected WordPress site running a PHP
branch that no longer receives security fixes.

It exists because of 21 October 2026, when two unauthenticated RCEs in PHP
(`CVE-2026-109618`, `CVE-2026-109619`, CVSSv4 9.2) were published with working
exploits demonstrated through WordPress. October ships plugins to client sites,
and the only way to answer "which of our clients are exposed" was to ring
round. The plugin had been sending its WordPress version at pairing since the
beginning and the platform was throwing it away.

- **Where the data comes from:** the shared envelope on every signed push from
  `october-mi-wp` carries `php_version` and `wp_version`. `routes/wpConnect.js`
  records them after the signature check, writing only when something changed
  or the record is a day old. Columns are on `connectors` (migration `210`).
- **Why a push and not pairing alone:** a host can change PHP at any time, so a
  figure captured on the day a site was paired ages into a lie.
- **The support dates** live in `backend/src/utils/phpSupport.js`, with their
  own suite in `tests/php-support.test.js`. Add a row when a branch ships; a
  branch the table does not know is reported as unknown rather than guessed,
  because inventing a date marks a live client site as safe when nobody
  checked.
- **End of life is a `fail`, not a `warn`,** because such a site cannot be
  patched at all. A branch whose fixes stop within four months is a `warn`.
- **Sites that have never reported are counted separately** and never as safe.

## Risk levels

- **clean** — every check passed.
- **hardening** — no active vulnerabilities, only low/medium defence-in-depth
  warnings (e.g. token in localStorage, no CSP on the static document).
- **action_needed** — a check failed or raised a high/critical warning.

## Deliberate scope

These are the *reliably automatable* checks — they catch regressions (someone
removing a limiter, header, or guard) and known-CVE dependencies. They do **not**
replace a deep human/LLM review: run the full `SECURITY_AUDIT.md` prompt against
the codebase periodically for injection/logic analysis the automated battery
can't do.

## Extending

Add a `checkX()` function in `securityAudit.js` returning a finding via the
`ok` / `warn` / `fail` / `unknown` helpers, then append it to the `CHECKS`
array. Keep each check self-contained and resilient (return `unknown` rather
than throwing) so one flaky check never sinks the run.
