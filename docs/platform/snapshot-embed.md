# Growth Snapshot — public embed for octobercomms.com

The public front door to the Snapshot Studio. A visitor enters their website
(and optional Instagram handle), gets an instant **value-first** taste (scores +
the one-line opportunity + "what we found"), and enters an email to unlock the
deep "moves we'd make" sections and a *Book a call* CTA.

It's a self-contained widget served by the platform backend, so you embed it
with a single `<iframe>` — no build step, no script tag, works in WordPress,
Squarespace, Webflow, plain HTML, anything.

## Embed snippet

Paste this into a Custom HTML block on the page where you want it
(e.g. octobercomms.com homepage). It auto-resizes to fit its content.

```html
<iframe
  id="october-snapshot"
  src="https://platform.octobercomms.com/api/public/snapshot/embed"
  title="October Growth Snapshot"
  style="width:100%;border:0;min-height:520px"
  loading="lazy"></iframe>
<script>
  // Auto-resize the iframe to its content (the widget posts its height).
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'snapshot-embed-height' && e.data.height) {
      var f = document.getElementById('october-snapshot');
      if (f) f.style.height = e.data.height + 'px';
    }
  });
</script>
```

(If you don't add the resize script it still works — it just keeps a fixed
`min-height` with internal scroll.)

## What happens behind it

1. **Submit URL (+ IG)** → the backend drafts a personalised snapshot (one Claude
   call, ~2p) and shows the taste. This fires **email alert #1** to the October
   inbox — a lead worth looking up on Instagram, even with no email yet.
2. **Enter email** → unlocks the full sections + booking CTA and fires **email
   alert #2** (the warm lead). The lead now shows in **Leads → Snapshot Studio**
   with its email, ready for you to curate imagery and send the polished PDF.

Public leads land in the same Leads list as ones you add manually (they're
tagged `source = public`).

## Configuration (VPS env vars)

All optional — sensible defaults ship in code.

| Var | Default | Purpose |
|---|---|---|
| `ALERT_EMAIL` | `octobercomms@gmail.com` | Where both lead alerts are sent. |
| `SNAPSHOT_BOOK_URL` | `https://octobercomms.com/book/` | The *Book a call* link. |
| `SNAPSHOT_EMBED_ORIGINS` | `https://octobercomms.com https://www.octobercomms.com` | Space-separated sites allowed to frame the widget. Add others here if you embed it elsewhere. |
| `SNAPSHOT_PUBLIC_DAILY_CAP` | `200` | Max *new* public drafts per rolling 24h (deduped repeats don't count). Abuse backstop. |
| `SNAPSHOT_TURNSTILE_SECRET` | *(unset)* | Set to turn on Cloudflare Turnstile bot verification (see below). |

## Abuse protection (already on)

- **Per-IP rate limit** — 6 drafts / 15 min on the create endpoint.
- **Daily cap** — `SNAPSHOT_PUBLIC_DAILY_CAP` new drafts / 24h.
- **URL dedup** — the same site submitted again within 7 days reuses the existing
  draft, so a bot hammering one URL costs nothing extra.
- **SSRF guard** — only public http(s) hosts are fetched (no localhost, private
  ranges, or cloud-metadata IPs).

### Optional: Cloudflare Turnstile

For a hard bot gate, set `SNAPSHOT_TURNSTILE_SECRET` on the VPS and add the
Turnstile widget + site key to the embed form (send the token as `turnstile` in
the POST). When the secret is unset the check is skipped, so the widget works
out of the box and gains protection the moment you add a key.

## Cost

~2p per draft, ~2p per refine (Claude Sonnet). With the daily cap at 200, the
worst-case public spend is a few pounds a day; realistically far less thanks to
dedup.
