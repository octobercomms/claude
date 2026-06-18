# Security audit (Settings → Security)

A standing, automated security checklist for the OMI platform itself. It proves
every audit area was checked, re-runs nightly, and flags anything that needs
attention — admin-only, under **Settings → Security**.

## What it is

- **Engine:** `backend/src/services/securityAudit.js` runs ~18 deterministic
  checks against the platform's real config and source (the deployed tree the
  backend runs from), plus `npm audit`. Each check returns a finding:
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
SPA-document CSP), Dependencies (`npm audit`).

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
