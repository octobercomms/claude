// The settings catalogue: every credential OMI holds, and where it lives.
//
// This was three constants inside SettingsPage.jsx, which made it invisible
// to everything else — including search. Typing "n8n" into the palette found
// nothing, because search covers the record tables and the 91 screens from
// nav/sections.js, and a credential is in neither. The account lead, reading
// the result: "So i don't think it's searching enough."
//
// Extracted here so there is one list and two readers: the page that renders
// the fields, and the palette that finds them.

export const KEY_GROUPS = [
  {
    title: 'AI models',
    category: 'AI',
    hint: 'Claude powers report narratives, summaries, social, ad creative and the AI Data Analyst. The Anthropic Admin key is optional — if set, the Costs panel pulls this month\u2019s spend from the Anthropic usage API, counting only the key OMI uses rather than everything on your Anthropic account. DeepSeek is optional and selectable per question in the Data Analyst (a cheap, fast model) — but it sends data to DeepSeek, so use it for non-sensitive questions only.',
    keys: [
      { key: 'CLAUDE_API_KEY', label: 'Claude API Key', placeholder: 'sk-ant-…', type: 'password' },
      { key: 'ANTHROPIC_ADMIN_KEY', label: 'Anthropic Admin Key (optional — for cost tracking)', placeholder: 'sk-ant-admin-…', type: 'password' },
      { key: 'ANTHROPIC_OMI_KEY_IDS', label: 'OMI\u2019s Anthropic API key id (optional)', placeholder: 'apikey_… — only needed if the Costs panel says it cannot identify OMI\u2019s key',
        note: 'The Costs panel reports what OMI itself spends, not what the whole Anthropic account spends. It works that out by matching the Claude key above against the key list on your organisation, so normally this stays empty.\nFill it in if the panel tells you it could not identify the key: find the id in the Anthropic console under Settings \u2192 API keys (it starts with apikey_). Several ids can be separated by commas.' },
      { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key (optional)', placeholder: 'sk-… from platform.deepseek.com — enables DeepSeek in the Data Analyst', type: 'password' },
    ],
  },
  {
    title: 'OpenAI (transcription)',
    category: 'AI',
    hint: 'Powers Whisper speech-to-text — the Swipe file ("reel → ideas") transcribes pasted videos with it, and the video caption stage uses it too. ~$0.006 per minute of audio (about half a cent per reel). Get a key at platform.openai.com → API keys (add a little billing credit).',
    keys: [
      { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', placeholder: 'sk-… — enables reel transcription', type: 'password' },
      { key: 'IG_SESSIONID', label: 'Instagram session cookie (optional — for Instagram reels)', placeholder: 'paste the sessionid value here', type: 'password',
        note: 'How to get it (Chrome/desktop):\n1. Log in to instagram.com in your browser.\n2. Open DevTools (⌥⌘I on Mac, F12 on Windows) → Application tab → Cookies → https://www.instagram.com.\n3. Find the row named “sessionid”, copy its Value, and paste it above.\nIt expires every so often, so re-paste it if Instagram reels start failing with a “needs a logged-in session” error. Tip: use a low-traffic or dedicated IG account. Public YouTube/TikTok links don’t need this.' },
    ],
  },
  {
    title: 'HeyGen (AI avatar reels)',
    category: 'AI',
    test: 'heygen',
    hint: 'AI avatar / Digital Twin reels from a script — the video suite. Pay-as-you-go (~$1/min of 720–1080p video, no subscription). Create your Digital Twin in the HeyGen app first, then it appears in the picker. Get a key at heygen.com → Settings → API.',
    keys: [
      { key: 'HEYGEN_API_KEY', label: 'HeyGen API Key', placeholder: 'heygen.com → Settings → API', type: 'password' },
    ],
  },
  {
    title: 'Replicate (Flux 1.1 Pro)',
    category: 'AI',
    hint: 'Used by the Social tab to generate post images. Pay-per-call, around $0.04 per image. Get a token at replicate.com/account/api-tokens.',
    keys: [
      { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', placeholder: 'r8_…', type: 'password' },
      { key: 'REPLICATE_CREDITS', label: 'Replicate balance (optional)', placeholder: 'e.g. 50 — your dashboard balance; Costs & usage ticks it down per image. Re-enter after topping up.', type: 'text' },
    ],
  },
  {
    title: 'Ideogram',
    category: 'AI',
    hint: 'Alternative image generator used by the Social tab — best when the post needs clean legible on-image text. Around $0.08 per image. Get a key at ideogram.ai/manage-api.',
    keys: [
      { key: 'IDEOGRAM_API_KEY', label: 'Ideogram API Key', placeholder: '…', type: 'password' },
      { key: 'IDEOGRAM_CREDITS', label: 'Ideogram credit balance (optional)', placeholder: 'e.g. 500 — your dashboard credits; Costs & usage ticks it down per image. Re-enter after topping up.', type: 'text' },
    ],
  },
  {
    title: 'fal.ai (Visualise)',
    category: 'AI',
    hint: 'Single-key media aggregator behind the Visualise studio — generation, circle-and-fix inpainting, and faithful 4K upscales, pay-per-call. Also the consolidation target for the standalone image accounts. Get a key at fal.ai → Settings → API keys.',
    keys: [
      { key: 'FAL_KEY', label: 'fal.ai API Key', placeholder: 'fal-… (fal.ai → Settings → API keys)', type: 'password' },
    ],
  },
  {
    title: 'ElevenLabs (voiceover)',
    category: 'AI',
    hint: 'Text-to-speech voiceovers for storyboards. Pay-per-character (~$0.30/min at creator tier).',
    keys: [
      { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Apify (TikTok trending sounds)',
    category: 'AI',
    hint: 'Powers the "Refresh trending sounds" action on the Social tab. ~$0.25 per scrape; cached for 7 days so weekly refreshes are plenty.',
    keys: [
      { key: 'APIFY_API_TOKEN', label: 'Apify API Token', placeholder: 'apify_api_…', type: 'password' },
    ],
  },
  {
    title: 'Email Provider',
    category: 'Email',
    hint: 'Choose whether to send reports via Gmail or Amazon SES. SES is recommended for production.',
    keys: [
      { key: 'EMAIL_PROVIDER', label: 'Provider', placeholder: 'gmail or ses', type: 'text' },
    ],
  },
  {
    title: 'Proposals and prospect email',
    category: 'Email',
    hint: 'Who a prospect sees a proposal or a snapshot nudge come from. Everything else (reports, internal alerts) keeps using the provider address below. '
      + 'Setting an address here does NOT authorise it: on Gmail the address must be a verified "Send mail as" alias on the account in Gmail SMTP below, or Gmail quietly rewrites the From back to that account; on SES the address or its domain must be verified, or the send is rejected. '
      + 'Worth doing: a proposal from a reports@ address is a strong spam signal, because that address sends automated mail all day and filters learn it.',
    keys: [
      { key: 'PIPELINE_FROM', label: 'Send proposals from', placeholder: '"Daniel Nelson" <dn@octobercomms.com>', type: 'text' },
      { key: 'PIPELINE_REPLY_TO', label: 'Replies go to (optional)', placeholder: 'dn@octobercomms.com', type: 'text' },
    ],
  },
  {
    title: 'Gmail SMTP',
    category: 'Email',
    hint: 'Used when EMAIL_PROVIDER is set to "gmail". Requires a Gmail App Password — Google Account → Security → 2-Step Verification → App passwords.',
    keys: [
      { key: 'GMAIL_USER', label: 'Gmail Address', placeholder: 'octobercommsreports@gmail.com', type: 'text' },
      { key: 'GMAIL_APP_PASSWORD', label: 'Gmail App Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password' },
    ],
  },
  {
    title: 'Amazon SES',
    category: 'Email',
    hint: 'Amazon SES handles report email (SMTP) and outreach (preferred via the SES API). Set the API access keys for outreach — they enable the SESv2 path which is lower latency than SMTP and gives better error responses. Keep the SMTP credentials too for the report transport.',
    keys: [
      { key: 'SES_FROM_EMAIL', label: 'From Email (verified in SES)', placeholder: 'reports@octobercomms.com', type: 'text' },
      { key: 'SES_REGION', label: 'AWS Region', placeholder: 'eu-west-1', type: 'text' },
      { key: 'SES_ACCESS_KEY_ID', label: 'API Access Key ID (preferred for outreach)', placeholder: 'AKIA…', type: 'text' },
      { key: 'SES_SECRET_ACCESS_KEY', label: 'API Secret Access Key', placeholder: '…', type: 'password' },
      { key: 'SES_SMTP_USER', label: 'SMTP Username (used by report email)', placeholder: 'AKIA…', type: 'text' },
      { key: 'SES_SMTP_PASS', label: 'SMTP Password', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Google OAuth',
    category: 'Ad Platforms',
    hint: 'Required for GA4, Google Search Console, Google Ads and Merchant Center connectors. Create credentials at console.cloud.google.com.',
    keys: [
      { key: 'GOOGLE_CLIENT_ID', label: 'Client ID', placeholder: '…apps.googleusercontent.com', type: 'text' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', placeholder: 'GOCSPX-…', type: 'password' },
    ],
  },
  {
    title: 'Google Ads',
    category: 'Ad Platforms',
    hint: 'Optional. A developer token enables automatic account discovery for Google Ads connectors. Apply at ads.google.com → Tools → API Center. Without it, enter Customer IDs manually in the connector.',
    keys: [
      { key: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Developer Token', placeholder: 'ABcDEF…', type: 'password' },
      { key: 'GOOGLE_ADS_MCC_ID', label: 'Manager Account ID (MCC)', placeholder: 'e.g. 1234567890', type: 'text' },
    ],
  },
  {
    title: 'Meta',
    category: 'Ad Platforms',
    hint: 'Required for Meta Ads and Instagram connectors. Create an app at developers.facebook.com, then add the redirect URL below to the app\'s App Domains (Settings → Basic) and Valid OAuth Redirect URIs (Facebook Login for Business → Settings).',
    scopes: {
      label: 'Required permissions (App Review)',
      help: 'Paste these into the App Review request in Meta for Developers — see platform/backend/src/connectors/meta.js for the source of truth.',
      values: [
        'ads_read', 'read_insights', 'instagram_basic',
        'instagram_manage_insights', 'pages_read_engagement', 'business_management',
        'pages_show_list', 'pages_manage_posts', 'instagram_content_publish',
      ],
    },
    keys: [
      { key: 'META_APP_ID', label: 'App ID', placeholder: '1234567890', type: 'text' },
      { key: 'META_APP_SECRET', label: 'App Secret', placeholder: '…', type: 'password' },
      { key: 'META_REDIRECT_URI', label: 'Redirect URI (must match Meta app config)', placeholder: 'https://your-platform.com/auth/meta/callback', type: 'text' },
    ],
  },
  {
    title: 'LinkedIn',
    category: 'Ad Platforms',
    hint: 'Required for the social autopilot to publish to LinkedIn on behalf of a member. Create an app at linkedin.com/developers, attach the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products, then add the redirect URL below under Auth → Authorized redirect URLs. Tokens last 60 days — the AM will need to reconnect when they expire.',
    scopes: {
      label: 'Required product scopes',
      help: 'These map to the products attached to the LinkedIn app: "Sign In with LinkedIn using OpenID Connect" gives openid/profile/email, "Share on LinkedIn" gives w_member_social. Company-Page posting (w_organization_social) needs LinkedIn Marketing Developer Platform approval and is a separate review.',
      values: ['openid', 'profile', 'email', 'w_member_social'],
    },
    keys: [
      { key: 'LINKEDIN_CLIENT_ID', label: 'Client ID', placeholder: '86xxxxxxxxxxxx', type: 'text' },
      { key: 'LINKEDIN_CLIENT_SECRET', label: 'Client Secret', placeholder: '…', type: 'password' },
      { key: 'LINKEDIN_REDIRECT_URI', label: 'Redirect URI (must match LinkedIn app config)', placeholder: 'https://your-platform.com/auth/linkedin/callback', type: 'text' },
    ],
  },
  {
    title: 'Shopify',
    category: 'Ecommerce & Inventory',
    hint: 'Required for Shopify connectors. Create one app in the Shopify Partners dashboard (partners.shopify.com → Apps → Create app). Either "Public" distribution (works for any store) or "Custom" distribution with each client store added to the allow-list. Set the redirect URL to your platform URL + /auth/shopify/callback. One app + one set of API keys works for every client store — each store just runs the install flow with the same credentials.',
    scopes: {
      label: 'Required access scopes',
      help: 'Paste these into the app\'s Configuration → Access scopes section in the Shopify Partners dashboard. Source of truth: platform/backend/src/connectors/shopify.js.',
      values: [
        'read_orders', 'read_all_orders', 'read_products', 'read_customers',
        'read_analytics', 'read_reports', 'read_marketing_events',
        'read_inventory', 'read_fulfillments', 'read_shipping',
        'read_price_rules', 'read_discounts', 'read_draft_orders',
      ],
    },
    keys: [
      { key: 'SHOPIFY_CLIENT_ID', label: 'API Key (Client ID)', placeholder: 'a1b2c3d4e5f6…', type: 'text' },
      { key: 'SHOPIFY_CLIENT_SECRET', label: 'API Secret (Client Secret)', placeholder: 'shpss_…', type: 'password' },
      { key: 'SHOPIFY_REDIRECT_URI', label: 'Redirect URI (must match Shopify app config)', placeholder: 'https://your-platform.com/auth/shopify/callback', type: 'text' },
    ],
  },
  {
    title: 'Amazon SP-API',
    category: 'Ecommerce & Inventory',
    hint: null,
    note: 'Amazon SP-API requires a registered developer application approved by Amazon before credentials can be generated. This is a separate process from standard API key setup.',
    keys: [
      { key: 'AMAZON_CLIENT_ID', label: 'Client ID', placeholder: 'amzn1.application-oa2-client.…', type: 'text' },
      { key: 'AMAZON_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Client secret from LWA credentials', type: 'password' },
    ],
  },
  {
    title: 'Zoho Inventory',
    category: 'Ecommerce & Inventory',
    hint: 'Required for Zoho Inventory connectors. Create an OAuth app at api-console.zoho.com → Server-based Applications. Set the redirect URL to your platform URL + /auth/zoho/callback.',
    keys: [
      { key: 'ZOHO_CLIENT_ID', label: 'Client ID', placeholder: '1000.XXXXXXXX', type: 'text' },
      { key: 'ZOHO_CLIENT_SECRET', label: 'Client Secret', placeholder: '…', type: 'password' },
      { key: 'ZOHO_REDIRECT_URI', label: 'Redirect URI (must match Zoho app config)', placeholder: 'https://your-platform.com/auth/zoho/callback', type: 'text' },
    ],
  },
  {
    title: 'DataForSEO',
    category: 'SEO',
    hint: 'Keyword rank tracking, backlinks and search volume. Copy the API login and password from app.dataforseo.com/api-access — the API password is not your dashboard login password.',
    test: 'dataforseo',
    keys: [
      { key: 'DATAFORSEO_LOGIN', label: 'API login (email)', placeholder: 'you@example.com', type: 'text' },
      { key: 'DATAFORSEO_PASSWORD', label: 'API password', placeholder: 'From app.dataforseo.com/api-access', type: 'password' },
    ],
  },
  {
    title: 'Moz',
    category: 'SEO',
    hint: 'Domain Authority on the Owned → Authority panel, fetched once a month per client. Create an API token at moz.com/api — a single token, not the older Access ID and Secret Key pair, which Moz now calls a legacy credential. The free tier allows 50 rows a month and a row is one site, so twelve clients use twelve. Leave blank and DA is simply not collected; everything else on that panel still fills.',
    test: 'moz',
    keys: [
      { key: 'MOZ_API_TOKEN', label: 'API token', placeholder: 'From moz.com/api', type: 'password' },
    ],
  },
  {
    title: 'PageSpeed / Core Web Vitals',
    category: 'SEO',
    hint: 'Google PageSpeed Insights API key (key only, no OAuth) — powers real Core Web Vitals (LCP / INP / CLS) in the Site audit. Create one in the Google Cloud console → APIs & Services, enable the PageSpeed Insights API, and paste the key here. Leave blank to keep the built-in heuristics.',
    test: 'pagespeed',
    keys: [
      { key: 'PAGESPEED_API_KEY', label: 'PageSpeed Insights API key', placeholder: 'AIza… (Google Cloud → PageSpeed Insights API)', type: 'password' },
    ],
  },
  {
    title: 'October Outreach',
    category: 'Outreach',
    hint: 'Contact-finding APIs for the Outreach module. Hunter and Serper each need one key. Icypeas needs all three (API Key, API Secret and User ID) — copy them from icypeas.com → Settings → API. Hunter, Serper and the free page-scraper cover most lead-finding. People Data Labs is an optional extra "deep find" provider — leave it blank unless you have a paid plan.',
    keys: [
      { key: 'HUNTER_API_KEY', label: 'Hunter API Key', placeholder: 'Hunter.io API key', type: 'password' },
      { key: 'ICYPEAS_API_KEY', label: 'Icypeas API Key', placeholder: 'Icypeas API key', type: 'password' },
      { key: 'ICYPEAS_API_SECRET', label: 'Icypeas API Secret', placeholder: 'Icypeas API secret', type: 'password' },
      { key: 'ICYPEAS_USER_ID', label: 'Icypeas User ID', placeholder: 'Icypeas account user ID', type: 'text' },
      { key: 'SERPER_API_KEY', label: 'Serper API Key', placeholder: 'Serper.dev API key', type: 'password' },
      { key: 'SERPER_CREDITS', label: 'Serper credit balance', placeholder: 'e.g. 2385 — read from the Serper dashboard; re-enter after topping up', type: 'text' },
      { key: 'PEOPLEDATALABS_API_KEY', label: 'People Data Labs API Key (optional · paid plan)', placeholder: 'Contact-finder: company + role → decision-makers, work emails & LinkedIn for outreach. Paid plan; leave blank to use Hunter.', type: 'password' },
      { key: 'SERPAPI_API_KEY', label: 'SerpApi Key', placeholder: 'serpapi.com key (competitor Google Ads / Ads Transparency)', type: 'password' },
    ],
  },
  {
    title: 'Internal tools',
    category: 'Outreach',
    hint: 'The project tracker and wiki October runs beside the platform, on their own subdomains and their own logins. Set a URL and the link appears in the sidebar for admin users; leave it blank and the item is hidden. These are signposts, not access control: the tools are protected by their own authentication, not by whether this menu item renders.',
    keys: [
      { key: 'PROJECTS_URL', label: 'Projects URL', placeholder: 'e.g. https://projects.octobercomms.com', type: 'text' },
      { key: 'DOCS_URL', label: 'Docs URL', placeholder: 'e.g. https://docs.octobercomms.com', type: 'text' },
    ],
  },
  {
    title: 'AI detection (Pangram)',
    category: 'Outreach',
    hint: 'Optional. The base URL is documented only inside a code block, so it has to be read off docs.pangram.com → API Overview → Base URLs and pasted here; the built-in default is an inference and does not resolve. Press "Test the connection" in a release to confirm it, which is free. Pangram scores how much of a text reads as machine-written, and OMI stores its answer beside the release so the two readings sit together. Billed at $0.05 per 100 words, so about 34p for a 670-word release. It never runs on its own: one call per button press, nothing on save or on typing, a re-check of unchanged text is served from the stored answer, and the whole thing stops at the monthly allowance set under AI models → Task budgets. Leave it blank and every other part of the checker works exactly as before, with the detector column simply absent.',
    keys: [
      { key: 'PANGRAM_API_KEY', label: 'Pangram API Key', placeholder: 'pangram.com → Developer API → Get API Key', type: 'password' },
      { key: 'PANGRAM_API_URL', label: 'Pangram API base URL', placeholder: 'From docs.pangram.com → API Overview → Base URLs. Leave blank only if the built-in default works.', type: 'text' },
    ],
  },
  // The single reply inbox used to be four keys here. It is now a list, in
  // InboxesPanel below, because one mailbox was the bug: releases replied to
  // press@ while the poll read hello@, so opt-outs sent to press@ never
  // happened. These keys still exist in the database and are imported into the
  // list once, automatically; editing them here would change nothing, which is
  // why the group is gone rather than merely relabelled.
  {
    title: 'Outreach Sending Domain',
    category: 'Outreach',
    hint: 'Used for SPF / DMARC health checks on the dashboard. A dedicated subdomain (e.g. outreach.yourbrand.com) keeps cold-email reputation separate from your main mail domain. Reply-to is the address journalists reply to; it must be one of the mailboxes listed under "Mailboxes OMI reads" below, or their replies and opt-outs are never seen.',
    keys: [
      { key: 'OUTREACH_SENDING_DOMAIN', label: 'Sending Domain', placeholder: 'outreach.yourbrand.com', type: 'text' },
      { key: 'OUTREACH_DEFAULT_REPLY_TO', label: 'Default Reply-To Address', placeholder: 'replies@yourbrand.com', type: 'text' },
    ],
  },
  {
    title: 'n8n Integration',
    category: 'Other',
    hint: 'Set your n8n instance URL to enable webhook-triggered data pulls.',
    keys: [
      { key: 'N8N_WEBHOOK_BASE_URL', label: 'Webhook Base URL', placeholder: 'https://your-n8n.example.com', type: 'text' },
    ],
  },
  {
    title: 'Stealth Scraping (FlareSolverr)',
    category: 'Other',
    hint: 'Optional. A FlareSolverr instance that solves Cloudflare/WAF challenges so the Site Audit and Competitor Tracker can read pages that block plain requests. Run it on the box (docker run -d --restart unless-stopped -p 127.0.0.1:8191:8191 ghcr.io/flaresolverr/flaresolverr), then put its URL here. Leave blank to keep scrapers on the direct-fetch path.',
    test: 'flaresolverr',
    keys: [
      { key: 'FLARESOLVERR_URL', label: 'FlareSolverr URL', placeholder: 'http://127.0.0.1:8191', type: 'text' },
    ],
  },
  {
    title: 'Alerts',
    category: 'Other',
    hint: 'Email address for platform alerts — connector failures, token expiry, and daily health check summaries.',
    keys: [
      { key: 'ALERT_EMAIL', label: 'Alert Email', placeholder: 'you@octobercomms.com', type: 'text' },
    ],
  },
  {
    title: 'Report Footer',
    category: 'Other',
    hint: 'Three lines printed at the bottom of every report PDF, beneath the "Page X of Y" line. Edit any time. Leave blank to use the built-in October defaults. Header is locked.',
    keys: [
      { key: 'REPORT_FOOTER_LINE_1', label: 'Footer line 1', placeholder: 'Private & Confidential · October Communications Ltd.', type: 'text' },
      { key: 'REPORT_FOOTER_LINE_2', label: 'Footer line 2', placeholder: 'Company No. 8816416 · VAT Registration No. GB 176 6335 82 · Registered in England and Wales', type: 'text' },
      { key: 'REPORT_FOOTER_LINE_3', label: 'Footer line 3', placeholder: '85 Great Portland Street, First Floor, London W1W 7LT · www.octobercomms.com', type: 'text' },
    ],
  },
];


// Top-level categories displayed as collapsible cards in a responsive grid.
export const CATEGORIES = [
  { title: 'AI', description: 'Claude & DeepSeek models, plus image / video / voice generation.' },
  { title: 'Email', description: 'Email transport for reports and outreach — Gmail or Amazon SES.', hasTestEmail: true },
  { title: 'Ad Platforms', description: 'Google Ads, Meta Ads and Instagram Insights.' },
  { title: 'Ecommerce & Inventory', description: 'Shopify, Amazon Seller and Zoho Inventory.' },
  { title: 'SEO', description: 'Keyword rank tracking, backlinks and search volume.' },
  { title: 'Outreach', description: 'Contact-finding, AI-drafted emails and reply tracking for cold outreach.' },
  { title: 'Other', description: 'Webhooks, stealth scraping and platform alerts.' },
];

// Sub-tab → which CATEGORIES of provider-key groups it shows.
export const SUBTAB_CATS = {
  ai: ['AI'],
  email: ['Email'],
  ads: ['Ad Platforms'],
  commerce: ['Ecommerce & Inventory'],
  seo: ['SEO'],
  outreach: ['Outreach'],
  other: ['Other'],
};

// Does this label already say which provider it belongs to?
//
// Compared on whole words, so "Moz" matches "Moz API token" but not
// "Amazon SES": a substring test called every Amazon key a Moz key.
function labelNamesGroup(label, group) {
  const words = String(group).toLowerCase().match(/[a-z0-9]+/g) || [];
  const inLabel = new Set(String(label).toLowerCase().match(/[a-z0-9]+/g) || []);
  // Words too short or too generic to identify anything.
  const useful = words.filter(w => w.length > 2 && !['the', 'and', 'api', 'key', 'keys', 'integration', 'models'].includes(w));
  if (!useful.length) return true;
  return useful.some(w => inLabel.has(w));
}

// One row per credential, for the search palette.
//
// A credential is addressed by the settings screen that renders it, which is
// the reverse of SUBTAB_CATS: a category belongs to exactly one sub-tab, so
// the mapping is unambiguous. `terms` is what a person might type — the
// visible label, the environment-variable name, and the group it sits in —
// because "n8n" is in the label, "MOZ_API_TOKEN" is what somebody pasting a
// key has in their clipboard, and "ecommerce" is how you look for Shopify
// when you cannot remember what it was called.
// `groups` is a parameter so the skip below can be tested: every group in
// the real catalogue currently belongs to a sub-tab, which makes the guard
// unreachable from the live data and therefore unfalsifiable without one.
export function settingsEntries(groups = KEY_GROUPS) {
  const slugOfCategory = {};
  for (const [slug, cats] of Object.entries(SUBTAB_CATS)) {
    for (const c of cats) slugOfCategory[c] = slug;
  }
  const out = [];
  for (const group of groups) {
    const slug = slugOfCategory[group.category];
    // A group in no sub-tab renders nowhere, so offering it in search would
    // be offering a row that goes somewhere it cannot show.
    if (!slug) continue;
    for (const k of group.keys || []) {
      const label = k.label || k.key;
      out.push({
        key: k.key,
        label,
        // What the search row says.
        //
        // Several providers call their credential "API token", so a row
        // reading "API token" with the provider in small print beside it is
        // three identical rows when you have Moz, SAM.gov and PageSpeed
        // configured. The group goes in the title unless the label already
        // names it.
        title: labelNamesGroup(label, group.title) ? label : `${group.title} · ${label}`,
        group: group.title,
        category: group.category,
        slug,
        terms: [k.label || '', k.key, group.title, group.category]
          .filter(Boolean).join(' ').toLowerCase(),
      });
    }
  }
  return out;
}
