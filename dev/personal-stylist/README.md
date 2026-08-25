# AS IF — personal stylist app

A private stylist for one owner. Photograph your clothes; get told what to wear,
when, and why — occasion, weather, which of two homes the clothes are in, and
what's clean. Concept & full spec: [`docs/personal-stylist/`](../../docs/personal-stylist/).

**Stack:** PHP 8 + MySQL/MariaDB on 20i shared hosting. No framework, minimal
dependencies. Frontend is the classy design in [`index.html`](./index.html)
(design reference), progressively wired to real data.

> **Status: Phase 1 — foundation.** Auth, database, secure config, and a login →
> authenticated shell that proves the stack. Wardrobe capture is the next increment.

## Structure

```
dev/personal-stylist/
├─ public/           ← WEB ROOT (point the domain here)
│  ├─ index.php      front controller / router
│  ├─ .htaccess      routing + security headers
│  ├─ assets/        css (and later js)
│  └─ views/         login + app shell
├─ src/              app code — OUTSIDE the web root (Db, Auth, Csrf, bootstrap)
├─ db/               schema.sql + seed.sql
├─ bin/              CLI helpers (init-user)
├─ config.sample.php → copy to config.php (git-ignored) and fill in
└─ ps-storage/       private uploads, created at runtime (git-ignored)
```

`config.php` and `ps-storage/` hold secrets/personal photos and are **never**
committed (see `.gitignore`). Keep them **outside the web root** — the layout
above puts them one level above `public/`.

## First-time setup on 20i

1. **PHP 8.x** enabled for the site; **create a MySQL database** and note its
   name / user / password / host.
2. **Deploy the files** (see below). `public/` becomes the site's web root;
   `src/`, `db/`, `config.php`, `ps-storage/` sit one level above it.
3. **Config:** copy `config.sample.php` → `config.php` and fill in the DB
   credentials, `base_url`, and a random `secret`.
4. **Database:** import `db/schema.sql` then `db/seed.sql` (phpMyAdmin or CLI).
5. **Owner account:** over SSH, from the app root, run
   `php bin/init-user.php you@email.com` and set a password.
6. Visit `/health` — should return `{"ok":true,"db":true}`. Then sign in at `/login`.

## Deploy (no server credentials shared with Claude)

Claude works through the **GitHub repo only** — it never holds your hosting or
DB passwords. Deployment pulls from the repo using secrets **you** store:

- **SSH / Git plan:** `git pull` on the server (or a GitHub Action that SSHes in).
- **FTP-only plan:** a GitHub Action deploys `dev/personal-stylist/` over SFTP,
  with your FTP credentials in **GitHub → Settings → Secrets** (never in the repo).

The deploy workflow is wired once you confirm which access your 20i plan has.

## Security

Follows the secure-by-default pattern (PDO prepared statements, bcrypt, CSRF,
secrets + private photos outside the web root, security headers). A full
hardening pass with the repo's `october-security` skill is scheduled before the
app holds real personal data.
