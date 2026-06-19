# Instagram DM autoresponder

A native, Claude-powered alternative to ManyChat: auto-reply to Instagram DMs
and comment-to-DM in the brand's voice. Lives under **Social → Performance → DM
bot**.

## Phase 1 — brain + drafts (shipped)
- **Persona** (`social_dm_bot.persona`): brand instructions (system prompt),
  FAQs/facts, tone, max words, escalation rule → compiled into a guard-railed
  system prompt (`services/dmBot.js`).
- **Reply templates**: Claude drafts a library across the common triggers.
- **Live tester**: paste an incoming message → see the exact reply the bot would
  send.

## Phase 2 — live auto-send via Meta (shipped)
A single signature-verified webhook receives Instagram messaging + comment
events for every connected client, matches the event to a client by IG account
id, drafts a reply with that client's persona, and sends it via the Graph API.

- **Webhook:** `GET/POST /api/social/dm-webhook` (`routes/dmWebhook.js`),
  mounted before auth + the global limiter. GET echoes `hub.challenge` when the
  verify token matches; POST is HMAC-verified against `META_APP_SECRET` (raw
  body via `express.json`'s verify hook), acks fast, processes async.
- **Routing + send:** `services/metaMessaging.js` — `findClientByIgId`,
  `sendDM` (`POST /{ig-id}/messages`), `sendPrivateReply` (comment-to-DM, the
  highest-converting trigger). Every inbound/outbound message is logged to
  `social_dm_events` (audit + dedupe by message/comment id, so we never
  double-reply).
- **Per-client config** (`social_dm_bot`): `enabled`, `ig_user_id`,
  `page_token_encrypted` (Page token with `instagram_manage_messages`,
  encrypted). Managed from the panel's **Live auto-send** card.

### Setup (per client)
1. Server env: `META_APP_SECRET` (already used for Meta OAuth) and
   `META_WEBHOOK_VERIFY_TOKEN` (any string you'll also enter in the Meta app).
2. Meta app dashboard → Webhooks → Instagram → callback
   `https://platform.octobercomms.com/api/social/dm-webhook`, the verify token
   above, subscribe to **messages** + **comments**.
3. In the DM bot panel → Live auto-send: paste the **Instagram business account
   ID** and a **Page access token** with `instagram_manage_messages`, save, then
   **Go live**. Toggle off any time.

### Guard-rails
Replies obey the persona's word limit/tone, stay on-platform, never invent
facts/prices, and escalate to a human per the AM's rule. Disabled or
missing-token accounts log a `skipped` event rather than sending.

## Refinements (shipped)
- **Comment trigger keywords** (`social_dm_bot.comment_keywords`): when set,
  comment-to-DM only fires on a comment containing one of them (the classic
  "comment WORD for the link" play); blank = any comment.
- **Public comment reply** (`public_reply` / `public_reply_text`): optionally
  post a visible nudge under the comment in addition to the private DM.
- **Opt-out / suppression** (`social_dm_optouts`): anyone who DMs
  "stop" / "unsubscribe" / "opt out" is added to a per-client suppression list
  and never messaged again; the inbound is logged as `opted_out`.

## Later
A richer inbox view of conversations; analytics on reply/conversion rates.
