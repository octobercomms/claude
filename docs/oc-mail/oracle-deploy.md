# OC Mail — Oracle Cloud (Always Free, ARM) Deploy Runbook

Deploy MailFlow on Oracle Cloud's **Always Free** Ampere A1 (ARM) shape — €0
forever, up to 4 OCPU / 24 GB RAM. MailFlow's images are multi-arch
(amd64 + arm64), so they run on A1 natively.

> **Why this over Hetzner:** when Hetzner's cost-optimized CX (x86) *and* CAX
> (Arm) lines are out of stock everywhere and only the pricey CPX line is
> available, Oracle's free A1 is the cheap always-on box. Trade-off: Oracle is
> fiddlier (capacity hunting + two firewall layers). This runbook handles both.

## 0. Account + home region

- Home region is chosen **once at signup and is permanent**. Pick
  **UK South (London)** — best latency for UK use; your free A1 lives here.
- Always-Free resources must be created in your home region.

## 1. Create the A1 instance

**Compute → Instances → Create instance.**

| Field | Value |
|---|---|
| Name | `oc-mail-test` |
| Image | **Canonical Ubuntu 24.04** (or 22.04) |
| Shape | **Change shape → Ampere → VM.Standard.A1.Flex** → **2 OCPU / 12 GB** (well within the free 4 OCPU / 24 GB) |
| Networking | Create a new VCN (wizard default) with a **public subnet**; **Assign a public IPv4 address = Yes** |
| SSH keys | Paste your public key, or let Oracle generate one and **download the private key** (you'll need it to SSH in) |
| Advanced → Management → cloud-init | Paste the contents of [`dev/oc-mail/deploy/oracle-cloud-init.sh`](../../dev/oc-mail/deploy/oracle-cloud-init.sh) |

Click **Create**.

> **"Out of capacity" for A1?** This is common — the free shape is popular.
> Retry after a minute, try a different **Availability Domain** in the dialog,
> or come back later. It usually succeeds within a few attempts. Don't switch to
> the AMD "micro" free shape — it's too small (1 GB) for MailFlow.

## 2. Note the public IP

Once the instance is **Running**, copy its **Public IP address** from the
instance details.

## 3. Open the firewall — BOTH layers

Oracle blocks inbound in two independent places. The cloud-init script (§1)
already opened the **host iptables** for 80/443. You must **also** open the
**cloud Security List**, or the app stays unreachable:

**Networking → Virtual Cloud Networks → _your VCN_ → Security Lists → Default
Security List → Add Ingress Rules.** Add two:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Port 22 is already allowed by default.)

## 4. First login + accounts

1. Browse to `https://<PUBLIC_IP>` — accept the self-signed cert warning.
2. Create your MailFlow **login** (app account, not an email account).
3. **Settings → Accounts → Add account** for each mailbox: Gmail (OAuth or an
   app password), StackMail/20i + other IMAP (host/username/password from 20i's
   mail settings).

## 5. Enable Claude (AI assistant)

In MailFlow's AI settings, pick the **OpenAI-compatible provider** option:

- Base URL: `https://api.anthropic.com/v1/`
- API key: an Anthropic API key
- Model: a current Claude model ID *(exact strings in setup chat — a top-tier
  model for drafting, a fast/cheap one for bulk sorting)*

## 6. Brief for a browser agent (Claude for Chrome)

> **Task:** In the Oracle Cloud console (`cloud.oracle.com`), create a free A1
> VM and let its cloud-init self-install the app.
>
> 1. **Compute → Instances → Create instance.** Name `oc-mail-test`.
> 2. **Image:** Canonical Ubuntu 24.04.
> 3. **Shape → Ampere → VM.Standard.A1.Flex → 2 OCPU / 12 GB.**
> 4. Networking: new VCN, public subnet, **assign public IPv4 = yes**.
> 5. **SSH keys:** use my key if listed; else generate and save the private key.
> 6. **Advanced → Management → cloud-init:** paste this verbatim:
>
>    ```
>    <PASTE dev/oc-mail/deploy/oracle-cloud-init.sh HERE>
>    ```
>
> 7. Create. **If "Out of capacity,"** retry / try another Availability Domain.
> 8. When Running, go to **Networking → the VCN → Default Security List → Add
>    Ingress Rules:** `0.0.0.0/0` TCP **80**, and `0.0.0.0/0` TCP **443**.
> 9. Report back the **Public IP**.
>
> Do **not** enter any passwords or API keys anywhere — the script generates its
> own secrets; email logins are added by me later in the app.

## 7. Notes

- **Migration later:** MailFlow holds only account config + a local mail index.
  Moving to a Hetzner CX23 when they restock is just redeploy + re-add accounts
  (or copy the Docker volumes). No lock-in.
- **Optional real domain:** point e.g. `mail.octobercomms.com` at the public IP
  and switch to the Caddy/Let's Encrypt profile (see the Hetzner runbook §6) to
  drop the self-signed warning.
- **Teardown:** terminate the instance in the Oracle console, or
  `docker compose -f /opt/mailflow/docker-compose.yml down -v` on the box.
