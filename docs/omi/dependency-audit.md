# Backend dependency audit

**Where it stands (31 Oct 2026): zero high or critical findings in the
production tree.** It was 59 — 1 critical, 53 high, 5 moderate — on the
morning of the Node 22 upgrade.

```bash
cd /opt/october-source/dev/platform/backend
node scripts/audit-check.js --all
```

That is the check, and `platform-checks.yml` runs it on every PR. It reads the
tree `npm install --omit=dev` produces, because that is what reaches the box,
and fails on any high or critical.

## Why not just `npm audit fix`

Two reasons, both of which cost time here.

**Its suggested fix is sometimes a downgrade.** For `jimp` it proposed
0.22.12, three years and one major behind our 1.6.1, which would have broken
both call sites: `visualise.js` and `adResize.js` use the v1 ESM API
(`(await import('jimp')).Jimp`). Never run `npm audit fix --force` here.

**It counts packages, not problems.** 38 of the 53 highs were one advisory —
`zod < 4.6.6`, vulnerable to memory exhaustion on oversized collections —
reached through jimp's own subpackages, each of which bundles it.

## What was actually done

| Change | Findings cleared | How it was checked |
|---|---|---|
| `npm audit fix` ×2, lockfile only | 15, including the critical `proxy-addr` IP-spoofing advisory (CVSS 9.1) | the suite |
| `overrides: { "zod": "^4.6.6" }` | 31 | jimp read/composite/resize/write exercised on the new zod |
| `nodemailer` 9 → 10 | 12 advisories on one package | a real SMTP send against a stub: auth, envelope, html, attachment |
| `puppeteer` 22 → 25 | 8 | a real PDF render, plus the Buffer fix below |
| `overrides: { "image-size": "^2.0.3" }` | 1 | an html-to-docx export with an embedded image |

The `zod` override is global and deliberately so: the jimp tree carried 3.23.8
and the remotion tree 4.3.6, and the whole 3.x line is in the advisory range
with no fix published. jimp works on 4.6.7 — exercised, not assumed — so one
override settles both trees rather than two scoped ones settling half.

## The one that would have bitten quietly

puppeteer 24 changed `page.pdf()` to resolve a **Uint8Array** rather than a
Buffer. Every caller of `generatePDFBuffer` passes the result to `res.send()`,
and Express treats only a real `Buffer` as binary: a bare Uint8Array falls
through to its object branch and is JSON-stringified. Every downloaded
report — PR portal, overview, AI visibility, chat export — would have arrived
as `{"0":37,"1":80,...}` under an `application/pdf` content-type. Nothing
thrown, nothing logged.

`pdfService.generatePDFBuffer` now returns `Buffer.from(buffer)`, one
conversion covering all six call sites, and `tests/pdf-buffer.test.js` guards
it. That test measures the Express behaviour itself rather than asserting it,
so the reason the conversion exists cannot decay into folklore.

## Accepted, not fixed

**`nodemon` and its `minimatch`** (2 moderate). Dev-only: `update.sh` installs
with `--omit=dev`, so neither reaches the box. npm's proposed fix is nodemon
1.0.2, a downgrade of eleven majors. A glob DoS in a local file watcher is not
a risk worth that. `audit-check.js` reports these under `--all` and never fails
on them.

Nothing else is excused. `audit-check.js` has no allowlist on purpose — the
moment a finding is permanently waved through in code, the check stops meaning
anything. A finding that genuinely cannot be fixed gets written down here,
with a date and a reason, and the check stays red until someone decides.

## If a new finding appears

1. `node scripts/audit-check.js --all` — is it in the production tree?
2. `npm audit fix`, never `--force`.
3. Still there? Read what the fix actually is. A major bump or a downgrade is a
   decision, not a formality: find the call sites, upgrade deliberately, and
   exercise them the way the table above did.
4. An `overrides` entry is the right tool when a transitive dependency is
   pinned by a parent you cannot move. Check the overridden package still
   works with its consumer before trusting it.
