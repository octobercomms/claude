# OC Mail — the October MailFlow fork

This folder holds October's customizations to [MailFlow](https://github.com/maathimself/mailflow)
(AGPL-3.0) as a single, self-contained patch plus a script to build a branded
source tree. Two things live here:

| File | What |
|------|------|
| `october-branding-and-cross-account-move.patch` | `git diff --binary` of every October change, against a pinned upstream commit. Includes text *and* binaries (favicon, app icons). |
| `apply.sh` | Clones upstream at the pinned commit and applies the patch, producing a ready-to-build checkout. |

**Pinned upstream commit:** `62ead1e1850246ba064bf10f1b66229c20db0eed`

## What the patch changes

**Branding**
- `LogoMark.jsx` → the two-bar October logomark (reads the accent, so it's gold), no wordmark.
- `favicon.svg` + `themes.js` favicon rasteriser → the October mail mark (black envelope + gold asterisk), keeping MailFlow's unread-count badge.
- `icon-*.png` (72–512) → regenerated from the October logomark (transparent).
- `manifest.json`, `index.html`, runtime `document.title` → "OC Mail", white background, gold theme colour.
- `themes.js` → a new **October** theme (`#fff` bg, `#000` text, `#e7cd41` accent) baked in as the **default** look, so branding survives without the admin Custom-CSS box.

**Cross-account move** (the Airmail feature MailFlow lacks)
- `imapManager.moveMessageAcrossAccounts()` — fetch raw source + flags from account A → `APPEND` into account B's folder → delete from A (delete last, so a failure never loses the message).
- `POST /mail/messages/:id/move-to-account` — validates ownership of both accounts, runs the move, reconciles the local index for both, adjusts counts, broadcasts folder updates.
- `api.moveToAccount()` + a **"Move to account →"** submenu in the message right-click menu, listing the other accounts (moves to that account's INBOX).

## Two ways to ship this

### Option A — the public fork (chosen)
1. On GitHub, fork `maathimself/mailflow` → **`octobercomms/mailflow`** (or create that repo and push upstream into it). *This is the one manual step; repo creation isn't available to the automation.*
2. Apply this patch on a branch of the fork and push:
   ```bash
   ./apply.sh mailflow-oct          # upstream + patch, with the changes staged
   cd mailflow-oct
   git remote set-url origin https://github.com/octobercomms/mailflow.git
   git checkout -b october
   git commit -m "October branding + cross-account move"
   git push -u origin october
   ```
3. The server builds from the fork (see `docs/oc-mail/fork-build.md`).

### Option B — build from the patch directly (works today, no fork needed)
Run `./apply.sh` on the server (or in CI) to produce the branded tree from pinned
upstream + patch, then `docker compose … up -d --build`. Identical result; skips
the fork until you want it.

## Regenerating the patch

If you change the branded tree, regenerate the patch from the checkout:
```bash
cd mailflow-oct
git add -A
git diff --cached --binary > /path/to/dev/oc-mail/fork/october-branding-and-cross-account-move.patch
```

## Licensing

MailFlow is AGPL-3.0. Self-hosting for ourselves is free. If we ever host it for
third parties, AGPL requires offering them the source — a public fork satisfies
that cleanly. See `docs/oc-mail/brief.md`.
