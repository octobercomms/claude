# Routing yourarchitect.uk outbound mail through Brevo SMTP

**Goal:** move all outbound mail for `yourarchitect.uk` off the 20i shared
StackMail relay (shared IP `185.151.28.65`, which Microsoft throttles) and onto
Brevo's monitored sending infrastructure. **Inbound mail stays on StackMail — the
MX records must not change.**

Deliverability was never an auth problem: SPF, DKIM (`s1._domainkey`) and DMARC
(`p=none`) all pass. The problem is the reputation of the shared StackMail
outbound IP with Microsoft (Hotmail/Outlook/Live). Brevo gives us a monitored,
warmed sending IP and per-message visibility.

This repo change (plugin **0.7.30**) covers the WordPress side. The rest is
operational — the Brevo dashboard, 20i/StackCP DNS, `wp-config.php` on the live
host, and the separate n8n/Hetzner sender. Work the checklist in order.

---

## 1. Brevo — verify `info@` as a sender

Brevo is already domain-authenticated for `yourarchitect.uk` (DKIM verified,
sender `login@yourarchitect.uk`).

- In Brevo → **Senders, Domains & Dedicated IPs → Senders**, add
  `info@yourarchitect.uk` as a verified sender alongside `login@`.
- Confirm the domain still shows **authenticated / DKIM verified** (no DNS change
  needed for this — the existing Brevo DKIM record stays).
- Get the SMTP relay credentials from Brevo → **SMTP & API → SMTP**:
  - Host: `smtp-relay.brevo.com`
  - Port: `587` (STARTTLS)
  - Login: your Brevo SMTP user (shown on that page)
  - Key: your Brevo SMTP **master password / key** (this is the secret)

## 2. WordPress — point outbound mail at Brevo (no DB-stored key)

The Archie plugin (0.7.30+) reads SMTP credentials from `wp-config.php` constants
or environment variables, in preference to anything stored in Settings. **Put the
key here, not in the plugin's Settings screen, and never commit it.**

Add to `wp-config.php` (above the `/* That's all, stop editing */` line):

```php
define( 'YAA_SMTP_HOST',   'smtp-relay.brevo.com' );
define( 'YAA_SMTP_PORT',   587 );
define( 'YAA_SMTP_SECURE', 'tls' );               // STARTTLS on 587
define( 'YAA_SMTP_USER',   '<your Brevo SMTP login>' );
define( 'YAA_SMTP_PASS',   '<your Brevo SMTP key>' );
define( 'YAA_SMTP_FROM',   'info@yourarchitect.uk' );
```

What this does:

- Defining `YAA_SMTP_HOST` **turns the relay on by itself** — no need to tick
  "Use SMTP relay" in Archie → Settings. The settings screen shows a notice
  confirming the key is being read from `wp-config.php` and is not in the
  database.
- Every message leaves as `info@yourarchitect.uk` (From forced), so nothing slips
  out as the WordPress default `wordpress@host` and breaks SPF/DKIM alignment.
- A relay send that fails is logged and `wp_mail()` returns false — it does **not**
  silently fall back to the unsigned PHP `mail()` path. (Front-end submit already
  defers notification mail to shutdown, so a slow relay can't break a quote
  submission; a 15s relay timeout backs that up.)

**Set the From name too:** Archie → Settings → "Email from address" should be
`info@yourarchitect.uk` and the From name whatever the practice wants (e.g. "Your
Architect"). That name rides on every relayed message.

**Brevo key already in the plugin DB?** If an earlier Brevo *API* key or SMTP key
was saved in Settings, clear it: Archie → Settings → tick "Clear this key" next to
the Brevo API key / SMTP password and Save. With `YAA_SMTP_PASS` defined in
`wp-config.php`, the stored `smtp_pass` is ignored anyway, but clearing it keeps
the database clean.

> **If you'd rather use a dedicated SMTP plugin** (WP Mail SMTP / Fluent SMTP) as
> the brief's primary option: install it, choose the "Other SMTP" / Brevo mailer,
> set the same host/port/TLS/from, store the key via its wp-config.php constant
> support (WP Mail SMTP: `WPMS_SMTP_PASS`; Fluent SMTP supports `$fluentMail`
> config), turn on **Force From Email / Force From Name**, and disable any "send
> next if primary fails / PHP mail fallback" option so failures surface. If you do
> this, leave Archie's own relay **off** (don't define `YAA_SMTP_*` and don't tick
> the box) so only one layer touches `wp_mail()`.

## 3. DNS — add Brevo to SPF (keep StackMail during transition)

In 20i / StackCP DNS for `yourarchitect.uk`, edit the single `TXT` SPF record.

- Current: `v=spf1 include:spf.stackmail.com a mx -all`
- New:     `v=spf1 include:spf.brevo.com include:spf.stackmail.com a mx -all`

Rules:
- Keep `include:spf.stackmail.com` through the transition (inbound/other senders
  may still use it); remove it only once nothing legitimate sends via StackMail.
- Keep the hard fail `-all`.
- **Watch the 10-DNS-lookup SPF limit.** `include:spf.brevo.com`,
  `include:spf.stackmail.com`, plus `a` and `mx` are several lookups each. If you
  approach 10, drop `a`/`mx` if the domain doesn't actually send from its own
  A/MX hosts, or flatten.
- **Do not touch DKIM** — `s1._domainkey` (StackMail) is correct and Brevo has its
  own verified DKIM selector already. **Do not touch MX.**

## 4. The other sender — Hetzner host authenticating as `admin@`

Logs show a Hetzner host `178.104.225.97`
(`static.97.225.104.178.clients.your-server.de`) authenticating as
`admin@yourarchitect.uk` via StackMail. **This is most likely the n8n instance.**

- Confirm what it is (n8n? a cron/report mailer?).
- Repoint its SMTP to Brevo (`smtp-relay.brevo.com:587`, STARTTLS, the Brevo SMTP
  login/key), sending as `info@` (or a verified sender), so it stops using the
  shared StackMail IP too.
- If it can't move yet, that's why `include:spf.stackmail.com` stays in SPF for
  now.

## 5. Transactional mail audit

Confirm which site events actually send mail, then verify each **after** the
switch:

- Stripe receipts (Archie's payment flow / Stripe-side emails).
- Archie enquiry/quote notifications — studio alert, client quote, portal
  sign-in, revision emails (all go through `wp_mail()` → now Brevo).
- Any form confirmations / other plugins using `wp_mail()`.
- The n8n flows from step 4.

---

## Verification (do all three)

1. **To Gmail:** send from `info@yourarchitect.uk` (use Archie → Settings → "Send
   test email"). In Gmail, **Show original** and confirm:
   - `dkim=pass` with `d=yourarchitect.uk`
   - `spf=pass`
   - `dmarc=pass`
   - the sending IP is a **Brevo** IP, **not** `185.151.28.65`.
2. **To Hotmail/Outlook:** send a test and confirm it lands in the **inbox**, not
   junk.
3. **End-to-end:** trigger one real transactional email (a genuine quote
   submission or a Stripe receipt) and confirm it arrives and shows the Brevo IP.

## Do NOT

- Change the **MX** records (inbound stays on StackMail).
- Add or modify **DKIM** — `s1` is correct; Brevo's selector is already verified.
- Raise **DMARC** above `p=none` yet. Only after 2–3 weeks of clean DMARC
  aggregate reports: step `none → quarantine → reject`.
- Submit the IP to Microsoft's delisting form — `185.151.28.65` is 20i's shared
  relay, **not ours**; delisting isn't ours to request. The fix is to stop sending
  from it (this cutover), not to delist it.

## Follow-up (after cutover, outside the build)

- Register `yourarchitect.uk` with **Microsoft SNDS** and **JMRP** at
  `postmaster.live.com` for ongoing Hotmail/Outlook reputation visibility.
- Once a few weeks of reports are clean, begin the DMARC tightening above.

---

### What shipped in the repo for this (plugin 0.7.30)

- `includes/class-yaa-smtp.php`: `creds()` resolves SMTP config with
  constant/env → database precedence (`YAA_SMTP_HOST/PORT/SECURE/USER/PASS/FROM`);
  `managed()` reports external credentials; `enabled()` activates on a resolvable
  host; `configure()` forces the aligned From, applies a 15s timeout, and never
  falls back to `mail()`; `log_failure()` records relay failures.
- `includes/class-yaa-admin.php`: SMTP section shows a notice when credentials are
  coming from `wp-config.php`/env, with the exact `define()` block, and notes that
  `YAA_SMTP_PASS` overrides the stored key.
