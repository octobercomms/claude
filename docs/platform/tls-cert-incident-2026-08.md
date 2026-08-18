# TLS certificate incident & renewal runbook — Aug 2026

**Status:** platform ✅ fixed · omi + shopify-app ⏳ one DNS edit outstanding
**Deadline:** omi & shopify-app certs expire **2026-09-07** — must be renewed before then.

---

## What happened

On 18 Aug 2026 `https://platform.octobercomms.com` started showing
`NET::ERR_CERT_DATE_INVALID` ("Your connection is not private"). The TLS
certificate had **expired** — not a breach, just a Let's Encrypt cert that
failed to auto-renew. Investigation found **all three** certs on the platform
VPS were failing to renew, for two different reasons.

### The server
- **Platform VPS:** Hetzner Ubuntu, `root@platform`, IPv4 **195.201.149.223**.
  Runs nginx + certbot + the Node API (PM2 app `october-platform`).
- **Mail is a *separate* box** (`root@mail`) — it has no nginx/certbot. Don't
  debug certs there.
- **DNS:** 20i (nameservers `ns1–4.stackdns.com`), panel **my.20i.com**.

### The three certs
| Domain | Renewal problem | Status now |
|---|---|---|
| `platform.octobercomms.com` | renewal was set to the **standalone** authenticator, which tries to bind port 80 — but nginx already holds 80, so it failed every time and the cert expired | ✅ **Fixed** — see below. Valid to **2026-11-16**, renews hands-free |
| `omi.octobercomms.com` | stale **AAAA (IPv6)** record → LE validates over IPv6 → 404 | ⏳ **Outstanding** — valid to 2026-09-07 |
| `shopify-app.octobercomms.com` | same stale AAAA as omi | ⏳ **Outstanding** — valid to 2026-09-07 |

---

## What's been fixed (platform)

1. Freed port 80 and renewed manually:
   ```bash
   systemctl stop nginx
   certbot renew --cert-name platform.octobercomms.com --force-renewal
   systemctl start nginx
   ```
2. Switched platform's renewal off standalone and onto the **nginx** plugin so
   it renews without the port-80 clash:
   ```bash
   certbot certonly --nginx --cert-name platform.octobercomms.com -d platform.octobercomms.com
   #   chose "2: Renew & replace"
   certbot renew --cert-name platform.octobercomms.com --dry-run   # → success
   ```
   `/etc/letsencrypt/renewal/platform.octobercomms.com.conf` now has
   `authenticator = nginx`. Platform is self-healing from here.

---

## What's outstanding (omi + shopify-app)

**Root cause:** these two domains have a stale **AAAA** record pointing at
`2a07:7800::127` — that's **20i's shared-hosting IPv6**, a *different* server
from the Hetzner box (whose IPv4 `A` record is `195.201.149.223`). When the
sites moved to Hetzner the `A` records were updated but the `AAAA` records were
left pointing back at 20i. Let's Encrypt prefers IPv6 when an `AAAA` exists, so
every challenge lands on the old 20i host and returns **404**.

- nginx on the box **already listens on IPv6** for these vhosts — it is *not* an
  nginx problem. Don't edit the nginx configs.
- `platform` renews fine precisely because it has **no AAAA** record.
- The stale AAAA also means IPv6 traffic from real users to omi/shopify is
  currently broken (routed to the dead 20i host).

### Fix — delete the two AAAA records in 20i (web panel, not the server)
1. Log in at **my.20i.com**.
2. **Manage Hosting** → the package holding `octobercomms.com` (or **Domains** →
   `octobercomms.com`) → **DNS** → **Manage DNS**.
3. In the **AAAA** section, delete the rows for **`omi`** and **`shopify-app`**
   (both value `2a07:7800::127`). Leave all `A` records (→ `195.201.149.223`)
   and everything else alone.
4. **If they re-appear:** 20i is auto-managing DNS because those subdomains are
   attached to the 20i hosting package. Open each subdomain's website/hosting
   settings and detach them from 20i hosting so only the manual `A` record
   remains.

### Then confirm and renew (on the server)
```bash
# Query the authoritative NS directly — must both be EMPTY before proceeding:
dig +short AAAA omi.octobercomms.com @ns1.stackdns.com
dig +short AAAA shopify-app.octobercomms.com @ns1.stackdns.com

# Only when empty:
certbot renew --cert-name omi.octobercomms.com --dry-run          # → success
certbot renew --cert-name shopify-app.octobercomms.com --dry-run  # → success
certbot renew && systemctl reload nginx
```

---

## Prevention already shipped

**PR #1176 (merged)** adds a daily **TLS-expiry watch** to the backend
(`dev/platform/backend/src/services/tlsMonitor.js`, wired into the cron
scheduler at 07:30). It opens a live TLS connection to each watched domain,
reads the *served* cert's expiry, and emails `ALERT_EMAIL` if any is within
`TLS_ALERT_DAYS` (default 14) of expiry or is unreachable. Silent when healthy.
Catches a lapse regardless of cause (dead timer, authenticator clash, IPv6, DNS
moved).

**To arm it for all three certs**, set this in the server's real backend `.env`
(the `.env.example` documents it) and reload:
```bash
# in /opt/october-platform backend .env (or wherever the live .env lives):
TLS_MONITOR_DOMAINS=platform.octobercomms.com,omi.octobercomms.com,shopify-app.octobercomms.com
# then:
pm2 reload october-platform --update-env
```
It ships on the next backend deploy anyway; without `TLS_MONITOR_DOMAINS` it
defaults to watching just the `PLATFORM_URL` host.

---

## Next-session checklist
- [ ] my.20i.com → delete `AAAA` for `omi` and `shopify-app` (value `2a07:7800::127`)
- [ ] `dig +short AAAA … @ns1.stackdns.com` returns empty for both
- [ ] `certbot renew --cert-name omi… --dry-run` and shopify-app → success
- [ ] `certbot renew && systemctl reload nginx`
- [ ] Set `TLS_MONITOR_DOMAINS` in the live backend `.env` + `pm2 reload october-platform --update-env`
- [ ] (Optional) confirm the auto-renew timer is alive: `systemctl list-timers '*certbot*'`

---

## Handy reference
- Check all certs & expiries: `certbot certificates`
- Renewal configs: `/etc/letsencrypt/renewal/*.conf` (the `authenticator =` line matters)
- Which authenticator each uses: `grep -H authenticator /etc/letsencrypt/renewal/*.conf`
- Live cert served for a host: `echo | openssl s_client -connect <host>:443 -servername <host> 2>/dev/null | openssl x509 -noout -dates`
- Renewal log: `/var/log/letsencrypt/letsencrypt.log`
