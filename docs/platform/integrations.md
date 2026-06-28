# OMI — AI Layer, Integrations & Settings

## The AI layer

Almost every text/JSON LLM feature flows through one chokepoint:

### `services/claude.js` — `callClaude(...)`
```js
callClaude({ system, user, max_tokens, model, feature, clientId })
```
- Resolves the model **per feature** via `aiModels.resolveModel(feature)` unless an
  explicit `model` is passed.
- Routes to **Claude** (Anthropic SDK) or **DeepSeek** (`callDeepSeekText`,
  OpenAI-compatible `https://api.deepseek.com/chat/completions`) based on the
  resolved model's provider.
- Applies **prompt caching** (ephemeral cache control on system prompts) for the
  input-token discount.
- Logs cost to `api_cost_events` (`recordClaudeCost`) with provider/feature/
  client/meta. DeepSeek pricing constants live here (`DEEPSEEK_PRICES`).

### `services/aiModels.js` — per-feature routing
- `MODELS` registry: `claude-fable-5` ($), `claude-sonnet-4-6` ($$),
  `claude-opus-4-8` ($$$), `deepseek-chat` (¢). `DEFAULT_MODEL = claude-sonnet-4-6`.
- `FEATURES` catalogue: grouped routable features, each with a `sensitive` flag
  (true = sends real client/customer data → DeepSeek shows a ⚠ in the UI).
- The AM sets routing in **Settings → AI models**, persisted as the
  `AI_MODEL_MAP` JSON in `platform_settings` (20s cache, `clearCache()` on save).
- `resolveModel(feature)` returns the mapped model or the default.

### AI Data Analyst — `routes/chat.js`
- Multi-round **tool-use** loop (Anthropic tool format) over connector-backed
  tools (GA4, Shopify, Search Console, etc.).
- **Per-question model picker** in the chat (Claude Fable/Sonnet/Opus or
  DeepSeek). DeepSeek path translates Anthropic tools → OpenAI function-calling
  (`runDeepSeekChat`); image inputs fall back to Claude.
- This is separate from `callClaude` (it's tool-use, not single-shot).

> **Data residency:** DeepSeek is hosted in China. Route only non-sensitive
> features there (drafting, captions). Keep `sensitive: true` features (reports,
> contacts, message content) on Claude. The UI flags violations.

## The settings store (`utils/settings.js`)

- `getSetting(key)` reads `platform_settings`, **AES-256-GCM decrypts**, and
  falls back to `process.env`. `encrypt`/`decrypt` use `ENCRYPTION_KEY`.
- ~30+ keys: provider API keys, OAuth secrets, service-account JSON, balances
  (e.g. `SERPER_CREDITS`), `AI_MODEL_MAP`, `DEEPSEEK_API_KEY`.
- **Bootstrap-only** secrets (DB creds, `JWT_SECRET`, `ENCRYPTION_KEY`, admin
  seed) come from `.env`, not the store.

## External integrations (service file → what it does)

### AI / search / visibility
- **Anthropic Claude** — `claude.js` (see above).
- **DeepSeek** — `claude.js` / `aiModels.js` (cheap, non-sensitive).
- **Serper** — `serper.js`: Google search results, IG profile discovery (free
  tier rejects the `site:` operator and `num>20` — keep queries plain).
- **DataForSEO** — `dataforseo.js`: rank tracking, SERP/AIO data, keyword volume,
  domain authority. Login/password creds.
- **Google Search Console / GA4** — analytics + search performance (OAuth).
- **Microsoft Clarity** — `clarity.js`: heatmaps/session signals → CRO reports.

### Lead enrichment
- **Hunter.io / IcyPeas / Apollo / People Data Labs** — email discovery &
  enrichment. **FlareSolverr** — Cloudflare-protected fetches.

### Email / messaging
- **AWS SES** (`@aws-sdk/client-sesv2`) and **Nodemailer/Gmail** — sending +
  bounce/complaint webhook. **Brevo** — transactional/contacts. **Meta /
  Instagram DM** — webhook + send. **LinkedIn**, **Shopify Email**.

### Ecommerce / inventory
- **Shopify** (OAuth + app webhooks), **WooCommerce** (`wp-connect` HMAC),
  **Zoho Inventory**, **Cin7**, **Amazon Seller**, **Klaviyo**,
  **Google Merchant Center**.

### Ads
- **Google Ads** (developer token + MCC refresh), **Meta Ads**, **competitor ads**
  via Ads Transparency Center (SerpApi).

### Generative media
- **Replicate / Ideogram / Adobe Firefly** — images. **ElevenLabs** — voiceover.
  **Remotion + ffmpeg + Whisper + Claude Vision** — video worker pipeline.

> Most provider credentials are read from the **settings store** (per-platform)
> or from **connectors** (`credentials` JSONB, per-client). A few global ones
> (`ANTHROPIC_API_KEY`, `WORKER_TOKEN`, OAuth app secrets) come from `.env`.

---

_Last verified: 2026-06-28._
