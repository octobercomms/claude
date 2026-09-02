import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import ImportWizard from '../components/ImportWizard';
import EditContactModal from '../components/EditContactModal';
import ManageUsersPage from './ManageUsersPage';
import LeadsPage from './LeadsPage';
import SecurityPanel from '../components/SecurityPanel';
import StrategyTemplatesPanel from '../components/StrategyTemplatesPanel';
import TendersPanel from '../components/TendersPanel';
import AiModelsPanel from '../components/AiModelsPanel';
import IntegrationsPage from './IntegrationsPage';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

const KEY_GROUPS = [
  {
    title: 'AI models',
    category: 'AI',
    hint: 'Claude powers report narratives, summaries, social, ad creative and the AI Data Analyst. The Anthropic Admin key is optional — if set, the Costs panel pulls monthly spend from the Anthropic usage API. DeepSeek is optional and selectable per question in the Data Analyst (a cheap, fast model) — but it sends data to DeepSeek, so use it for non-sensitive questions only.',
    keys: [
      { key: 'CLAUDE_API_KEY', label: 'Claude API Key', placeholder: 'sk-ant-…', type: 'password' },
      { key: 'ANTHROPIC_ADMIN_KEY', label: 'Anthropic Admin Key (optional — for cost tracking)', placeholder: 'sk-ant-admin-…', type: 'password' },
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
    title: 'Outreach Reply Inbox',
    category: 'Outreach',
    hint: 'IMAP login for the inbox outreach replies land in. The platform polls it to detect replies, classify them with Claude, and stop follow-ups automatically.',
    keys: [
      { key: 'OUTREACH_IMAP_HOST', label: 'IMAP Host', placeholder: 'e.g. imap.gmail.com', type: 'text' },
      { key: 'OUTREACH_IMAP_PORT', label: 'IMAP Port', placeholder: '993', type: 'text' },
      { key: 'OUTREACH_IMAP_USER', label: 'IMAP User', placeholder: 'replies@example.com', type: 'text' },
      { key: 'OUTREACH_IMAP_PASSWORD', label: 'IMAP Password', placeholder: 'App password', type: 'password' },
    ],
  },
  {
    title: 'Outreach Sending Domain',
    category: 'Outreach',
    hint: 'Used for SPF / DMARC health checks on the dashboard. A dedicated subdomain (e.g. outreach.yourbrand.com) keeps cold-email reputation separate from your main mail domain. Reply-to is the inbox replies should go to — usually the same as the IMAP user above.',
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
const CATEGORIES = [
  { title: 'AI', description: 'Claude & DeepSeek models, plus image / video / voice generation.' },
  { title: 'Email', description: 'Email transport for reports and outreach — Gmail or Amazon SES.', hasTestEmail: true },
  { title: 'Ad Platforms', description: 'Google Ads, Meta Ads and Instagram Insights.' },
  { title: 'Ecommerce & Inventory', description: 'Shopify, Amazon Seller and Zoho Inventory.' },
  { title: 'SEO', description: 'Keyword rank tracking, backlinks and search volume.' },
  { title: 'Outreach', description: 'Contact-finding, AI-drafted emails and reply tracking for cold outreach.' },
  { title: 'Other', description: 'Webhooks, stealth scraping and platform alerts.' },
];

// Two-level navigation (mirrors OMI's suite pages): three top-level sections,
// each with sub-tabs. Connection sub-tabs that show provider keys map to one or
// more of the CATEGORIES above; the rest render a dedicated panel.
const SECTIONS = [
  { key: 'connections', label: 'Connections', subs: [
    { k: 'costs', label: 'Costs & usage' },
    { k: 'ai', label: 'AI' },
    { k: 'email', label: 'Email' },
    { k: 'ads', label: 'Ad platforms' },
    { k: 'commerce', label: 'E-commerce' },
    { k: 'seo', label: 'SEO' },
    { k: 'outreach', label: 'Outreach finders' },
    { k: 'integrations', label: 'Integrations' },
    { k: 'other', label: 'Other' },
  ] },
  { key: 'database', label: 'Database', subs: [
    { k: 'contacts', label: 'Journalists' },
    { k: 'publications', label: 'Publications' },
    { k: 'tags', label: 'Tags' },
    { k: 'tasks', label: 'Tasks' },
  ] },
  { key: 'tools', label: 'Tools', subs: [
    { k: 'strategy', label: 'Strategy templates' },
    { k: 'praddon', label: 'PR Gmail add-on' },
  ] },
  { key: 'bizdev', label: 'Biz dev', subs: [
    { k: 'leads', label: 'Leads' },
    { k: 'tenders', label: 'Tenders' },
  ] },
  { key: 'account', label: 'Account', subs: [
    { k: 'users', label: 'Users & access' },
    { k: 'security', label: 'Security' },
  ] },
];
// Sub-tabs clustered into labelled bentos per section, so long flat strips
// read as a few scannable groups. Keyed by section; a section without an entry
// keeps the flat sub-tab strip.
const SECTION_GROUPS = {
  connections: [
    { label: 'Spend',          subs: ['costs'] },
    { label: 'Marketing data', subs: ['ads', 'commerce', 'seo'] },
    { label: 'AI & outreach',  subs: ['ai', 'email', 'outreach'] },
    { label: 'Platform',       subs: ['integrations', 'other'] },
  ],
  database: [
    { label: 'Library', subs: ['contacts', 'publications', 'tags'] },
    { label: 'Work',    subs: ['tasks'] },
  ],
  account: [
    { label: 'Access', subs: ['users', 'security'] },
  ],
};

// Sub-tab → which CATEGORIES of provider-key groups it shows.
const SUBTAB_CATS = {
  ai: ['AI'],
  email: ['Email'],
  ads: ['Ad Platforms'],
  commerce: ['Ecommerce & Inventory'],
  seo: ['SEO'],
  outreach: ['Outreach'],
  other: ['Other'],
};
const ALL_SUBS = SECTIONS.flatMap(s => s.subs.map(x => x.k));

export default function SettingsPage() {
  const { readOnly } = useAuth();
  const [values, setValues] = useState({});
  const [revealed, setRevealed] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState({});
  const [savingSection, setSavingSection] = useState(null);
  const [sectionResult, setSectionResult] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testingDfs, setTestingDfs] = useState(false);
  const [dfsTestMsg, setDfsTestMsg] = useState(null);
  const [testingFs, setTestingFs] = useState(false);
  const [fsTestMsg, setFsTestMsg] = useState(null);
  const [testingHg, setTestingHg] = useState(false);
  const [hgTestMsg, setHgTestMsg] = useState(null);
  const [testingPsi, setTestingPsi] = useState(false);
  const [psiTestMsg, setPsiTestMsg] = useState(null);
  const [openCategories, setOpenCategories] = useState({});
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'general') return 'costs';      // legacy deep links
    if (t === 'aimodels') return 'ai';
    return ALL_SUBS.includes(t) ? t : 'costs';
  });

  function switchTab(next) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  }

  // initialValues captures what came back from GET /platform-keys so the
  // save handler can tell "this field was already empty" from "this field
  // was just cleared by the AM" and only post the latter as a delete.
  const [initialValues, setInitialValues] = useState({});

  useEffect(() => {
    api.get('/settings/platform-keys').then(data => {
      setValues(data);
      setInitialValues(data);
    });
  }, []);

  async function toggleReveal(key) {
    if (!revealed) {
      const data = await api.get('/settings/platform-keys/values');
      setValues(data);
      setRevealed(true);
    }
    setVisibleKeys(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  function toggleCategory(title) {
    setOpenCategories(prev => ({ ...prev, [title]: !prev[title] }));
  }

  async function handleSaveSection(group) {
    setSavingSection(group.title);
    setSectionResult(null);
    try {
      const body = {};
      let changed = 0;
      for (const k of group.keys) {
        const cur = (values[k.key] == null ? '' : values[k.key]);
        const init = (initialValues[k.key] == null ? '' : initialValues[k.key]);
        if (cur === init) continue;        // untouched
        if (cur === '••••••••') continue;  // still masked; nothing to send
        // Send the new value (or '' meaning "clear it"); backend handles both.
        body[k.key] = cur;
        changed++;
      }
      if (changed === 0) {
        setSectionResult({ title: group.title, ok: false, message: 'No changes to save' });
        return;
      }
      await api.post('/settings/platform-keys', body);
      const fresh = await api.get('/settings/platform-keys');
      setValues(fresh);
      setInitialValues(fresh);
      setVisibleKeys({});
      setSectionResult({ title: group.title, ok: true, message: 'Saved' });
      setTimeout(() => setSectionResult(r => (r && r.title === group.title ? null : r)), 4000);
    } catch (err) {
      setSectionResult({ title: group.title, ok: false, message: err.message });
    } finally {
      setSavingSection(null);
    }
  }

  async function handleTestEmail(e) {
    e.preventDefault();
    setSendingTest(true);
    setTestMsg('');
    try {
      await api.post('/settings/test-email', { to: testEmail });
      setTestMsg('Test email sent successfully.');
    } catch (err) {
      setTestMsg(`Error: ${err.message}`);
    } finally {
      setSendingTest(false);
    }
  }

  async function handleTestDataForSEO() {
    setTestingDfs(true);
    setDfsTestMsg(null);
    try {
      const result = await api.post('/settings/test-dataforseo', {
        login: values.DATAFORSEO_LOGIN,
        password: values.DATAFORSEO_PASSWORD,
      });
      setDfsTestMsg(result);
    } catch (err) {
      setDfsTestMsg({ ok: false, message: err.message });
    } finally {
      setTestingDfs(false);
    }
  }

  async function handleTestFlareSolverr() {
    setTestingFs(true);
    setFsTestMsg(null);
    try {
      // Real end-to-end solve can take 10–20s while the browser spins up.
      const result = await api.post('/settings/test-flaresolverr', {
        url: values.FLARESOLVERR_URL,
      });
      setFsTestMsg(result);
    } catch (err) {
      setFsTestMsg({ ok: false, message: err.message });
    } finally {
      setTestingFs(false);
    }
  }

  async function handleTestHeyGen() {
    setTestingHg(true);
    setHgTestMsg(null);
    try {
      setHgTestMsg(await api.post('/settings/test-heygen', {}));
    } catch (err) {
      setHgTestMsg({ ok: false, message: err.message });
    } finally {
      setTestingHg(false);
    }
  }

  async function handleTestPageSpeed() {
    setTestingPsi(true);
    setPsiTestMsg(null);
    try {
      // Save the key first — the endpoint reads it from the DB. Real PSI call
      // against a sample URL can take ~10s.
      setPsiTestMsg(await api.post('/settings/test-pagespeed', {}));
    } catch (err) {
      setPsiTestMsg({ ok: false, message: err.message });
    } finally {
      setTestingPsi(false);
    }
  }

  return (
    <div>
      <div className="kicker"><span className="pip" />Admin</div>
      <header className="hero">
        <h1 className="display">Settings</h1>
      </header>

      <div className="tabs">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => switchTab(s.subs[0].k)}
            className={`tab ${s.subs.some(x => x.k === tab) ? 'active' : ''}`}>
            {s.label}
          </button>
        ))}
      </div>
      {(() => {
        const section = SECTIONS.find(s => s.subs.some(x => x.k === tab)) || SECTIONS[0];
        const groups = SECTION_GROUPS[section.key];
        // Sections with a group map render labelled bentos; anything else keeps
        // the flat sub-tab strip.
        if (!groups) {
          return (
            <div className="tabs tabs-sub">
              {section.subs.map(x => (
                <button key={x.k} onClick={() => switchTab(x.k)}
                  className={`tab ${tab === x.k ? 'active' : ''}`}>
                  {x.label}
                </button>
              ))}
            </div>
          );
        }
        const byKey = Object.fromEntries(section.subs.map(x => [x.k, x]));
        const pill = (active) => ({
          padding: '6px 12px', borderRadius: 'var(--r-pill)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', border: 'var(--border-w) solid ' + (active ? 'var(--accent)' : 'var(--card-border)'),
          background: active ? 'var(--accent)' : 'var(--surface)', color: active ? 'var(--accent-on)' : 'var(--text)',
        });
        return (
          <div className="stepper-grouped" style={{ marginBottom: 18 }}>
            {groups.map(g => (
              <div key={g.label} className="stepper-group-card">
                <div className="stepper-group-heading">{g.label}</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {g.subs.filter(k => byKey[k]).map(k => (
                    <button key={k} onClick={() => switchTab(k)} style={pill(tab === k)}>
                      {byKey[k].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {tab === 'integrations' && <IntegrationsPage embedded />}
      {tab === 'contacts' && <ContactsLibrary />}
      {tab === 'tasks' && <JournalistTasks />}
      {tab === 'publications' && <PublicationsPanel />}
      {tab === 'tags' && <TagsManager />}
      {tab === 'users' && <ManageUsersPage embedded />}
      {tab === 'leads' && <LeadsPage embedded />}
      {tab === 'tenders' && <TendersPanel />}
      {tab === 'security' && <SecurityPanel />}
      {tab === 'strategy' && <StrategyTemplatesPanel />}
      {tab === 'costs' && (<>
      <CostsPanel />
      <KeywordSpendPanel />
      <CostLogPanel />
      </>)}
      {tab === 'praddon' && <PrAddonPanel />}

      {tab === 'ai' && <AiModelsPanel />}

      {SUBTAB_CATS[tab] && (<>
      {/* Provider keys for this section — one or more categories. */}
      <form onSubmit={e => e.preventDefault()} autoComplete="off">
        {/* Dummy fields to prevent browser autofill from hitting real inputs */}
        <input type="text" name="username" style={{ display: 'none' }} autoComplete="username" readOnly />
        <input type="password" name="password" style={{ display: 'none' }} autoComplete="current-password" readOnly />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, alignItems: 'start' }}>
          {CATEGORIES.filter(cat => SUBTAB_CATS[tab].includes(cat.title)).map(cat => {
            const groupsInCat = KEY_GROUPS.filter(g => g.category === cat.title);
            const open = openCategories[cat.title] !== false;
            const configuredCount = groupsInCat.filter(g => g.keys.some(k => values[k.key] === '••••••••')).length;

            return (
              <Card key={cat.title}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.title)}
                  className="row between center" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                >
                  <div>
                    <div className="h3">{cat.title}</div>
                    {cat.description && <div className="body-sm text-muted">{cat.description}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`chip ${configuredCount === groupsInCat.length ? 'chip-success' : 'chip-accent'}`}>{configuredCount} / {groupsInCat.length}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                  </div>
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
                    {groupsInCat.map(group => {
                      // "Set" = every required key (those without "optional" in the
                      // label) is stored. Turns the section green, like a connected
                      // connector, so configured providers are obvious at a glance.
                      const reqKeys = group.keys.filter(k => !/optional/i.test(k.label));
                      const groupSet = reqKeys.length > 0 && reqKeys.every(k => values[k.key] === '••••••••');
                      return (
                      <div key={group.title} style={{ borderLeft: `4px solid ${groupSet ? 'var(--positive)' : 'var(--card-border)'}`, background: groupSet ? 'var(--positive-soft)' : 'var(--surface-raised)', borderRadius: 'var(--r-sm)', padding: '14px 16px' }}>
                        <div className="row between center" style={{ marginBottom: 8 }}>
                          <div className="h3" style={{ margin: 0 }}>{group.title}</div>
                          {groupSet && <span className="chip chip-success" style={{ fontSize: 10, flex: '0 0 auto' }}>✓ Set</span>}
                        </div>
                        {group.hint && <p className="body-sm text-muted">{group.hint}</p>}
                        {group.note && (
                          <div className="callout callout-warning"><strong>Developer app required.</strong> {group.note}</div>
                        )}
                        {group.scopes && <ScopesBlock scopes={group.scopes} />}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: group.hint || group.note ? 12 : 0 }}>
                          {group.keys.map(({ key, label, placeholder, type, note }) => {
                            // Each row turns green on its own once stored, so a
                            // group with one field deliberately left blank still
                            // shows clearly which keys ARE set (the whole cell only
                            // goes green when every required key is filled).
                            const fieldSet = values[key] === '••••••••';
                            return (
                            <div key={key} className="field" style={{ borderLeft: `3px solid ${fieldSet && !groupSet ? 'var(--positive)' : 'transparent'}`, background: fieldSet && !groupSet ? 'var(--positive-soft)' : 'transparent', borderRadius: 'var(--r-sm)', padding: fieldSet && !groupSet ? '8px 10px' : '0', marginLeft: fieldSet && !groupSet ? '-10px' : '0', transition: 'background .15s, border-color .15s' }}>
                              <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {label}
                                {fieldSet && <span className="chip chip-success" style={{ fontSize: 9, flex: '0 0 auto' }}>✓ set</span>}
                              </label>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  type={visibleKeys[key] ? 'text' : type}
                                  className="input" style={{ flex: 1 }}
                                  value={values[key] === '••••••••' ? '' : (values[key] || '')}
                                  placeholder={values[key] === '••••••••' ? 'Already set — enter new value to change' : placeholder}
                                  onChange={e => handleChange(key, e.target.value)}
                                  autoComplete="new-password"
                                />
                                {type === 'password' && (
                                  <button
                                    type="button"
                                    onClick={() => toggleReveal(key)}
                                    className="btn btn-secondary btn-sm"
                                    title={visibleKeys[key] ? 'Hide' : 'Show'}
                                  >
                                    {visibleKeys[key] ? '🙈' : '👁️'}
                                  </button>
                                )}
                              </div>
                              <span className="body-xs text-subtle"><code>{key}</code></span>
                              {note && <p className="body-xs text-muted" style={{ marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{note}</p>}
                            </div>
                            );
                          })}
                        </div>
                        {group.test === 'dataforseo' && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleTestDataForSEO} disabled={testingDfs}
                                className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                                {testingDfs ? 'Testing…' : 'Test connection'}
                              </button>
                              {dfsTestMsg && (
                                <span style={{ fontSize: 12, color: dfsTestMsg.ok ? 'var(--positive)' : 'var(--negative)' }}>
                                  {dfsTestMsg.ok ? '✓ ' : '✗ '}{dfsTestMsg.message}
                                </span>
                              )}
                            </div>
                            {dfsTestMsg && dfsTestMsg.sent && (
                              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.5 }}>
                                Sent login <code>{dfsTestMsg.sent.login}</code>, password {dfsTestMsg.sent.passwordLength} chars ({dfsTestMsg.sent.passwordPreview}){dfsTestMsg.code != null ? `. DataForSEO code ${dfsTestMsg.code}` : ''}.
                              </div>
                            )}
                          </div>
                        )}
                        {group.test === 'flaresolverr' && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleTestFlareSolverr} disabled={testingFs}
                                className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                                {testingFs ? 'Testing… (can take ~15s)' : 'Test connection'}
                              </button>
                              {fsTestMsg && (
                                <span style={{ fontSize: 12, color: fsTestMsg.ok ? 'var(--positive)' : 'var(--negative)' }}>
                                  {fsTestMsg.ok ? '✓ ' : '✗ '}{fsTestMsg.message}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.5 }}>
                              Pings the service and solves a sample page end-to-end. Save the URL first if you've just changed it.
                            </div>
                          </div>
                        )}
                        {group.test === 'pagespeed' && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleTestPageSpeed} disabled={testingPsi}
                                className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                                {testingPsi ? 'Testing… (~10s)' : 'Test connection'}
                              </button>
                              {psiTestMsg && (
                                <span style={{ fontSize: 12, color: psiTestMsg.ok ? 'var(--positive)' : 'var(--negative)' }}>
                                  {psiTestMsg.ok ? '✓ ' : '✗ '}{psiTestMsg.message}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.5 }}>
                              Save the key first, then this runs a real PageSpeed check against a sample URL.
                            </div>
                          </div>
                        )}
                        {group.test === 'heygen' && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleTestHeyGen} disabled={testingHg}
                                className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                                {testingHg ? 'Testing… (up to ~20s)' : 'Test connection'}
                              </button>
                              {hgTestMsg && (
                                <span style={{ fontSize: 12, color: hgTestMsg.ok ? 'var(--positive)' : 'var(--negative)' }}>
                                  {hgTestMsg.ok ? '✓ ' : '✗ '}{hgTestMsg.message}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.5 }}>
                              Pings HeyGen with the saved key. Save the key first if you've just changed it. Tells you if it's the key (✗ rejected) or the connection (✗ didn't respond).
                            </div>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                          <button type="button" onClick={() => handleSaveSection(group)} disabled={savingSection === group.title}
                            className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                            {savingSection === group.title ? 'Saving…' : 'Save'}
                          </button>
                          {sectionResult && sectionResult.title === group.title && (
                            <span style={{ fontSize: 12, fontWeight: 600, color: sectionResult.ok ? 'var(--positive)' : 'var(--negative)' }}>
                              {sectionResult.ok ? '✓ Saved' : `✗ ${sectionResult.message}`}
                            </span>
                          )}
                        </div>
                      </div>
                      );
                    })}

                    {cat.hasTestEmail && (
                      <div style={{ borderTop: "2px solid var(--accent-soft)", paddingTop: 14 }}>
                        <div className="h3 mb-2">Send Test Email</div>
                        <p className="body-sm text-muted">Verify your email provider after saving credentials above.</p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <input
                            type="email" placeholder="Send test email to…"
                            value={testEmail} onChange={e => setTestEmail(e.target.value)}
                            className="input" style={{ flex: '1 1 200px' }}
                          />
                          <button type="button" {...roWrite(readOnly, { onClick: handleTestEmail, disabled: sendingTest })} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }}>
                            {sendingTest ? 'Sending…' : 'Send Test'}
                          </button>
                        </div>
                        {testMsg && <div style={{ marginTop: 6, fontSize: 12, color: testMsg.startsWith('Error') ? 'var(--negative)' : 'var(--positive)' }}>{testMsg}</div>}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </form>
      </>)}
    </div>
  );
}

function ScopesBlock({ scopes }) {
  const [copied, setCopied] = useState(false);
  const csv = scopes.values.join(',');
  async function copy() {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="card" style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface-raised)" }}>
      <div className="row between" style={{ gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
        <div>
          <div className="caption">{scopes.label}</div>
          {scopes.help && <div className="body-xs text-muted mt-2">{scopes.help}</div>}
        </div>
        <button type="button" onClick={copy} className="btn btn-secondary btn-sm">
          {copied ? '✓ Copied' : 'Copy all'}
        </button>
      </div>
      <code className="card" style={{ display: "block", fontSize: 11, fontFamily: "monospace", padding: "6px 8px", wordBreak: "break-all" }}>{csv}</code>
      <div className="row wrap mt-3" style={{ gap: 4 }}>
        {scopes.values.map(s => (
          <span key={s} className="chip chip-outline" style={{ fontFamily: "monospace", fontSize: 10 }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

// Publications — the shared outlet list behind press coverage. The
// duplicate-detection / merge flow now lives in the Cleanup Centre (same place
// as the Contacts equivalent), so this panel is the live list + inline rename
// + per-row delete only.
function PublicationsPanel() {
  const [err, setErr] = useState(null);
  const [outlets, setOutlets] = useState(null);
  const [outletSearch, setOutletSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [openOutlet, setOpenOutlet] = useState(null);
  const [rssBusy, setRssBusy] = useState(null); // outlet id being resolved, or 'sweep'

  // Auto-discover one publication's RSS feed.
  async function findRss(o) {
    setRssBusy(o.id);
    try {
      const r = await api.post(`/pr/outlets/${o.id}/find-rss`, {});
      setOutlets((list) => list.map((x) => (x.id === o.id ? { ...x, rss_status: r.rss_status, rss_url: r.rss_url || null } : x)));
    } catch (e) { setErr(e.message); }
    finally { setRssBusy(null); }
  }
  // Sweep every unresolved publication for a feed.
  async function sweepRss() {
    setRssBusy('sweep');
    try {
      const r = await api.post('/pr/outlets/find-rss/sweep', {});
      setErr(null);
      // Reload to reflect the newly-found feeds.
      const path = outletSearch.trim() ? `/pr/outlets?q=${encodeURIComponent(outletSearch.trim())}` : '/pr/outlets';
      const res = await api.get(path);
      setOutlets(res.items || []);
      alert(`Feed sweep: checked ${r.checked}, found ${r.found}.`);
    } catch (e) { setErr(e.message); }
    finally { setRssBusy(null); }
  }

  // Reload on every search-term change. Server-side ILIKE means the user
  // finds zero-coverage outlets (Vogue.nl etc.) that fall outside the
  // top-2000-by-coverage window the unfiltered list returns. Debounce so
  // we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const path = outletSearch.trim() ? `/pr/outlets?q=${encodeURIComponent(outletSearch.trim())}` : '/pr/outlets';
      api.get(path).then((r) => { setOutlets(r.items || []); setSelected(new Set()); }).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [outletSearch]);
  async function setTier(id, tier) {
    setOutlets((list) => list.map((o) => (o.id === id ? { ...o, tier } : o)));
    try { await api.patch(`/pr/outlets/${id}`, { tier }); } catch (e) { setErr(e.message); }
  }

  async function deleteOutlet(o) {
    const tail = o.coverage || o.contacts
      ? `${o.coverage || 0} coverage entr${o.coverage === 1 ? 'y' : 'ies'} and ${o.contacts || 0} journalist${o.contacts === 1 ? '' : 's'} will be detached (kept, but their Publication field becomes blank).`
      : 'No coverage or journalists attached.';
    if (!confirm(`Delete "${o.name}"?\n\n${tail}\n\nCannot be undone.`)) return;
    try {
      await api.delete(`/pr/outlets/${o.id}`);
      setOutlets((list) => list.filter((x) => x.id !== o.id));
      setSelected((s) => { const n = new Set(s); n.delete(o.id); return n; });
    } catch (e) { setErr(e.message); }
  }

  const TIERS = [['', '—'], ['1', 'T1 · premium'], ['2', 'T2 · broad'], ['3', 'T3 · blog']];
  const visibleOutlets = (outlets || []).filter((o) => !outletSearch.trim() || (o.name || '').toLowerCase().includes(outletSearch.trim().toLowerCase()));
  const totalCount = outlets ? outlets.length : 0;
  const shownCount = Math.min(visibleOutlets.length, 500);

  function toggleRow(id) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAllVisible() {
    setSelected((s) => {
      const ids = visibleOutlets.slice(0, 500).map((o) => o.id);
      const allSelected = ids.every((id) => s.has(id));
      const n = new Set(s);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  async function deleteSelected() {
    if (!selected.size) return;
    const total = Array.from(selected).reduce((acc, id) => {
      const o = (outlets || []).find((x) => x.id === id);
      return { coverage: acc.coverage + (o?.coverage || 0), contacts: acc.contacts + (o?.contacts || 0) };
    }, { coverage: 0, contacts: 0 });
    if (!confirm(`Delete ${selected.size} publication${selected.size === 1 ? '' : 's'}?\n\n${total.coverage} coverage entries and ${total.contacts} journalists will be detached (kept; their Publication becomes blank).\n\nCannot be undone.`)) return;
    try {
      await api.post('/pr/outlets/bulk-delete', { ids: Array.from(selected) });
      setOutlets((list) => list.filter((x) => !selected.has(x.id)));
      setSelected(new Set());
    } catch (e) { setErr(e.message); }
  }
  async function deleteAllMatching() {
    if (!visibleOutlets.length) return;
    const total = visibleOutlets.reduce((acc, o) => ({
      coverage: acc.coverage + (o.coverage || 0),
      contacts: acc.contacts + (o.contacts || 0),
    }), { coverage: 0, contacts: 0 });
    if (!confirm(`Delete ALL ${visibleOutlets.length} matching publication${visibleOutlets.length === 1 ? '' : 's'}?\n\n${total.coverage} coverage entries and ${total.contacts} journalists will be detached.\n\nCannot be undone.`)) return;
    try {
      const ids = visibleOutlets.map((o) => o.id);
      await api.post('/pr/outlets/bulk-delete', { ids });
      setOutlets((list) => list.filter((x) => !ids.includes(x.id)));
      setSelected(new Set());
    } catch (e) { setErr(e.message); }
  }

  function exportOutletsCsv() {
    if (!outlets || !outlets.length) return;
    const header = ['Publication', 'Tier', 'Coverage', 'Contacts', 'Region', 'Domain'];
    const rows = outlets.map((o) => [o.name || '', o.tier || '', o.coverage || 0, o.contacts || 0, o.region || '', o.domain || '']);
    const csv = [header, ...rows].map((r) => r.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'publications.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const allVisibleSelected = visibleOutlets.length > 0 && visibleOutlets.slice(0, 500).every((o) => selected.has(o.id));

  return (
    <>
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <CardTitle>Publications</CardTitle>
          <p className="body-sm text-muted">
            The outlets behind your coverage, shared across all clients. Set a <strong>tier</strong> — T1 premium
            titles, T2 broad, T3 blogs/microbloggers — to prioritise targeting and reporting. (Tier is the
            publication's; a journalist inherits it.)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/contacts/cleanup?tab=pubdupes" className="btn btn-secondary btn-sm"
            title="Find duplicate publications, merge them, dismiss false-positive suggestions — same Cleanup Centre as Journalists.">
            🧹 Cleanup Centre
          </Link>
          <button onClick={sweepRss} disabled={rssBusy === 'sweep'} className="btn btn-secondary btn-sm"
            title="Find RSS feeds for every publication that doesn't have one yet (uses each outlet's website/domain)">
            {rssBusy === 'sweep' ? 'Finding feeds…' : '🛰 Find all feeds'}
          </button>
          <button onClick={exportOutletsCsv} disabled={!outlets?.length} className="btn btn-secondary btn-sm"
            title={outlets?.length ? `Download ${outlets.length.toLocaleString()} publication${outlets.length === 1 ? '' : 's'}` : 'Nothing to export'}>
            ↓ Export CSV
          </button>
        </div>
      </div>
      <input className="input" placeholder="Search publications…" value={outletSearch} onChange={(e) => setOutletSearch(e.target.value)} style={{ maxWidth: 320, margin: '10px 0' }} />

      {outlets && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>{selected.size} selected · Showing {shownCount.toLocaleString()} of {totalCount.toLocaleString()} matching</span>
          <div style={{ flex: 1 }} />
          {selected.size > 0 && (
            <button onClick={deleteSelected} className="btn btn-sm btn-danger" style={{ background: 'var(--negative)', color: '#fff', border: 'none' }}>
              Delete selected ({selected.size})
            </button>
          )}
          {visibleOutlets.length > 0 && (
            <button onClick={deleteAllMatching} className="btn btn-sm" style={{ background: 'var(--negative)', color: '#fff', border: 'none' }}>
              Delete all {visibleOutlets.length} matching
            </button>
          )}
        </div>
      )}

      {!outlets ? <p className="body-sm text-muted">Loading…</p> : (
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="contacts-list-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible" />
              </th>
              <th>Publication</th>
              <th style={{ width: 60, textAlign: 'center' }} title="RSS feed">RSS</th>
              <th style={{ textAlign: 'right' }}>Coverage</th>
              <th style={{ textAlign: 'right' }}>Journalists</th>
              <th style={{ width: 150 }}>Tier</th>
              <th style={{ width: 28 }}></th>
            </tr></thead>
            <tbody>
              {visibleOutlets.slice(0, 500).map((o) => (
                <tr key={o.id}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleRow(o.id)} />
                  </td>
                  <td onClick={() => setOpenOutlet(o)} style={{ cursor: 'pointer' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{o.name}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                    {rssBusy === o.id ? <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>…</span>
                      : o.rss_status === 'found' && o.rss_url
                        ? <a href={o.rss_url} target="_blank" rel="noopener noreferrer" title={`Feed: ${o.rss_url}`} style={{ color: '#e8871e', textDecoration: 'none', fontSize: 15 }}>🛰</a>
                        : o.rss_status === 'none'
                          ? <button onClick={() => findRss(o)} title="No feed found — click to try again" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 14 }}>—</button>
                          : <button onClick={() => findRss(o)} title="Find this publication's RSS feed" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 14 }}>＋</button>}
                  </td>
                  <td onClick={() => setOpenOutlet(o)} style={{ cursor: 'pointer', textAlign: 'right' }}>{o.coverage}</td>
                  <td onClick={() => setOpenOutlet(o)} style={{ cursor: 'pointer', textAlign: 'right' }}>{o.contacts || 0}</td>
                  <td onClick={() => setOpenOutlet(o)} style={{ cursor: 'pointer' }}>
                    {/* Tier rendered flat (no inline select) so the row sits at
                        the same height as the Contacts list. Editing happens in
                        the modal — one click, one fix. */}
                    {(() => {
                      const label = (TIERS.find(([v]) => v === (o.tier || '')) || ['', '—'])[1];
                      return <span style={{ color: o.tier ? 'var(--text)' : 'var(--text-subtle)', fontSize: 13 }}>{label}</span>;
                    })()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => deleteOutlet(o)} title="Delete publication" aria-label="Delete"
                      style={{ background: 'none', border: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!visibleOutlets.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 20 }}>No publications{outletSearch ? ' match that search' : ' yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {err && <div style={{ color: 'var(--negative)', fontSize: 12, marginTop: 8 }}>{err}</div>}
    </Card>
    {openOutlet && (
      <OutletEditModal
        outletId={openOutlet.id}
        onClose={() => setOpenOutlet(null)}
        onSaved={(patched) => {
          setOutlets((list) => list.map((x) => (x.id === patched.id ? { ...x, ...patched } : x)));
        }}
        onDeleted={(id) => {
          setOutlets((list) => list.filter((x) => x.id !== id));
          setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
          setOpenOutlet(null);
        }}
      />
    )}
    </>
  );
}

// Full-profile publication modal. Same shape as EditContactModal so the AM
// gets the same interaction model whether they click a contact or a
// publication. Fetches everything fresh from /pr/outlets/:id (summary,
// journalists, coverage history) rather than relying on the row data.
function OutletEditModal({ outletId, onClose, onSaved, onDeleted }) {
  const { readOnly } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [gen, setGen] = useState(false);

  useEffect(() => {
    api.get(`/pr/outlets/${outletId}`).then((d) => {
      setData(d);
      setForm({
        name: d.name || '', summary: d.summary || '', tier: d.tier || '',
        region: d.region || '', notes: d.notes || '', domain: d.domain || '',
      });
    }).catch((e) => setErr(e.message));
  }, [outletId]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!data || !form) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className="modal" style={{ padding: 24 }}>
          {err ? <p style={{ color: 'var(--negative)' }}>{err}</p> : <p style={{ color: 'var(--text-subtle)' }}>Loading…</p>}
        </div>
      </div>
    );
  }

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    setSaving(true);
    try {
      await api.patch(`/pr/outlets/${outletId}`, form);
      onSaved({ id: outletId, name: form.name, tier: form.tier });
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }
  async function generate() {
    setGen(true);
    try {
      const r = await api.post(`/pr/outlets/${outletId}/summary`, {});
      update('summary', r.summary || '');
    } catch (e) { setErr(e.message); }
    finally { setGen(false); }
  }
  async function deleteOutlet() {
    const covered = (data.coverage || []).length;
    const journos = (data.journalists || []).length;
    const tail = (covered || journos)
      ? `${covered} coverage entr${covered === 1 ? 'y' : 'ies'} and ${journos} journalist${journos === 1 ? '' : 's'} will be detached (kept; their Publication becomes blank).`
      : 'No coverage or journalists attached.';
    if (!confirm(`Delete "${data.name}"?\n\n${tail}\n\nCannot be undone.`)) return;
    try {
      await api.delete(`/pr/outlets/${outletId}`);
      onDeleted(outletId);
    } catch (e) { setErr(e.message); }
  }

  const published = (data.coverage || []).filter((r) => r.status === 'published' || r.status === 'download').length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }} className="modal modal-wide">
        <div className="modal-head">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{data.name || 'Publication'}</h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>

        {err && <div style={{ color: 'var(--negative)', fontSize: 12, padding: '0 0 8px' }}>{err}</div>}

        <div className="grid">
          <MSection title="Publication">
            <MField label="Name">
              <input className="input" value={form.name} onChange={(e) => update('name', e.target.value)} />
            </MField>
            <MField label={<>About <button type="button" className="btn btn-secondary btn-sm" style={{ float: 'right' }} {...roWrite(readOnly, { onClick: generate, disabled: gen })}>{gen ? '…' : '✨ Generate'}</button></>}>
              <textarea className="input" rows={3} value={form.summary} onChange={(e) => update('summary', e.target.value)} placeholder="Who they are — Claude can draft this from your coverage." />
            </MField>
            <MField label="Tier">
              <select className="input" value={form.tier} onChange={(e) => update('tier', e.target.value)}>
                <option value="">—</option>
                <option value="1">T1 · premium</option>
                <option value="2">T2 · broad</option>
                <option value="3">T3 · blog</option>
              </select>
            </MField>
            <MField label="Region"><input className="input" value={form.region} onChange={(e) => update('region', e.target.value)} placeholder="UK" /></MField>
            <MField label="Domain"><input className="input" value={form.domain} onChange={(e) => update('domain', e.target.value)} /></MField>
            <MField label="Notes" full>
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
            </MField>
          </MSection>

          <MSection title="Activity">
            <div style={{ display: 'flex', gap: 18, marginBottom: 14 }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Published</div><div style={{ fontSize: 22, fontWeight: 800 }}>{published}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Tracked</div><div style={{ fontSize: 22, fontWeight: 800 }}>{(data.coverage || []).length}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Journalists</div><div style={{ fontSize: 22, fontWeight: 800 }}>{(data.journalists || []).length}</div></div>
            </div>
            {(data.journalists || []).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Journalists here</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {(data.journalists || []).slice(0, 20).map((j) => (
                    <Link key={j.id} to={`/media/journalist/${j.id}`} onClick={onClose}
                      className="chip" style={{ textDecoration: 'none', fontSize: 12 }}>{j.name}</Link>
                  ))}
                </div>
              </>
            )}
            {(data.coverage || []).length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Recent coverage</div>
                <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12 }}>
                  {(data.coverage || []).slice(0, 12).map((r, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--card-border)' }}>
                      <span style={{ fontWeight: 600 }}>{r.client || '—'}</span>
                      <span style={{ color: 'var(--text-muted)' }}> · {r.journalist || '—'} · </span>
                      <span style={{ color: 'var(--text-subtle)' }}>{r.status}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </MSection>
        </div>

        <div className="row end" style={{ gap: 8 }}>
          <button type="button" onClick={deleteOutlet}
            className="btn btn-sm"
            style={{ background: 'var(--negative)', color: '#fff', border: 'none' }}
            title="Hard-delete this publication. Coverage and journalists pointing at it stay (their Publication becomes blank).">
            Delete publication
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// Local Section/Field for the outlet modal — same DOM shape as the contacts
// modal but private to PublicationsPanel to avoid clashing with the page's
// existing top-level `Field` (which is a one-arg form-field component used
// by Costs/Keyword panels).
function MSection({ title, children }) { return <div className="modal-section"><h3 className="caption">{title}</h3><div className="grid">{children}</div></div>; }
function MField({ label, children, full }) { return <label className="field" style={full ? { gridColumn: '1/-1' } : undefined}><span className="field-label">{label}</span>{children}</label>; }

// PR Gmail add-on — surfaces the API base URL + shared key to paste into the
// Google Apps Script add-on's config, with a Regenerate (rotate) button.
function PrAddonPanel() {
  const { readOnly } = useAuth();
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const base = `${window.location.origin}/api/pr-addon`;

  useEffect(() => { api.get('/settings/pr-addon-key').then((r) => setKey(r.key || '')).catch(() => setKey('')); }, []);

  async function regenerate() {
    if (key && !window.confirm('Regenerate the key? The current key stops working immediately and the add-on must be updated.')) return;
    setBusy(true);
    try { const r = await api.post('/settings/pr-addon-key/regenerate', {}); setKey(r.key); setReveal(true); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  }
  const copy = (v) => { try { navigator.clipboard.writeText(v); } catch { window.prompt('Copy:', v); } };
  const masked = key ? '•'.repeat(Math.min(40, key.length)) : '';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <h2 className="caption">PR · Gmail add-on</h2>
          <p className="body-sm text-muted">Connect the OMI for Gmail add-on so you can look up journalists, log threads, and capture contacts from your inbox. Paste these two values into the add-on's setup.</p>
        </div>
        <button {...roWrite(readOnly, { onClick: regenerate, disabled: busy })} className="btn btn-primary" style={{ padding: '6px 14px' }}>{busy ? 'Generating…' : (key ? 'Regenerate' : 'Generate key')}</button>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label className="field-label">API base URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" readOnly value={base} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(base)}>Copy</button>
        </div>
      </div>
      <div className="field">
        <label className="field-label">API key (X-OMI-Key)</label>
        {key ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" readOnly value={reveal ? key : masked} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReveal((r) => !r)}>{reveal ? 'Hide' : 'Reveal'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(key)}>Copy</button>
          </div>
        ) : key === '' ? (
          <p className="body-sm text-muted">No key yet — generate one to connect the add-on.</p>
        ) : (
          <p className="body-sm text-muted">Loading…</p>
        )}
      </div>
    </div>
  );
}

function CostsPanel() {
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(null);
  const [gbpPerUsd, setGbpPerUsd] = useState(null);

  async function load() {
    try { setRows(await api.get('/settings/usage')); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  // Display-only GBP conversion for the USD totals. Falls back to a static
  // approx if the live-rate endpoint isn't available (e.g. backend not yet
  // deployed), so the £ figure always shows.
  useEffect(() => { api.get('/settings/fx-rate').then(d => setGbpPerUsd(d.rate || 0.79)).catch(() => setGbpPerUsd(0.79)); }, []);

  async function refresh() {
    setRefreshing(true);
    setErr(null);
    try {
      const { snapshots } = await api.post('/settings/usage/refresh', {});
      setRows(snapshots);
    } catch (e) { setErr(e.message); }
    finally { setRefreshing(false); }
  }

  // Total spent this month — sums every provider's spend (real cost_this_period
  // for Anthropic-style providers, snapshot-diff for balance-only ones). Same
  // computation as the dashboard banner so the two read the same.
  const totalThisMonth = rows
    ? rows.reduce((acc, r) => {
        const s = r.snapshot;
        if (!s) return acc;
        if (s.cost_this_period != null && (s.currency || 'USD') === 'USD') return acc + Number(s.cost_this_period);
        if (r.spend_this_month && (s.currency || 'USD') === 'USD') return acc + Number(r.spend_this_month);
        return acc;
      }, 0)
    : 0;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="caption">Costs &amp; usage</h2>
          <p className="body-sm text-muted">Latest balance / usage reading from each pay-per-use provider. Auto-refreshes every night at 02:00.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {totalThisMonth > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Total spent this month</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>
                ${totalThisMonth.toFixed(2)}
                {gbpPerUsd ? <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-subtle)', marginLeft: 8 }}>≈ £{(totalThisMonth * gbpPerUsd).toFixed(2)}</span> : null}
              </div>
            </div>
          )}
          <button onClick={refresh} disabled={refreshing} className="btn btn-primary" style={{ padding: '6px 14px' }}>
            {refreshing ? 'Polling…' : 'Refresh now'}
          </button>
        </div>
      </div>
      {err && <div style={{ color: 'var(--negative)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {!rows && <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 10 }}>Loading…</div>}
      {rows && (() => {
        const configured = r => !r.snapshot || r.snapshot.status !== 'no_credentials';
        const live = rows.filter(r => !r.manual && configured(r));
        const manual = rows.filter(r => r.manual && configured(r));
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {live.map(r => <ProviderCard key={r.name} entry={r} />)}
            </div>
            {manual.length > 0 && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: 'var(--border-w) solid var(--card-border)' }}>
                <div className="caption" style={{ marginBottom: 4 }}>No balance API — estimated from a manual checkpoint</div>
                <p className="body-sm text-muted" style={{ marginBottom: 10 }}>
                  These providers don’t expose a balance to read. Enter your current dashboard balance in each provider’s settings above and OMI ticks it down by what it generates. It’s an estimate — exact only if OMI is the only thing using that key.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {manual.map(r => <ProviderCard key={r.name} entry={r} />)}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// Keyword spend estimator — totals every billable (active) keyword across
// the app and projects the recurring DataForSEO cost the scheduler will
// incur (rank checks every 4 days at depth 50 + weekly AI Overview). Gives
// the AM a self-sizing recommended daily spending cap to set on the
// DataForSEO dashboard as a runaway-cost backstop.
function KeywordSpendPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/settings/dataforseo-estimate').then(setData).catch(e => setErr(e.message));
  }, []);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 className="caption">DataForSEO keyword spend</h2>
        <p className="body-sm text-muted">
          Projected from every active keyword the scheduler checks — rank checks every 4 days plus weekly AI Overview.
          Use it to size a daily spending cap on the DataForSEO dashboard as a runaway-cost backstop.
        </p>
      </div>
      {err && <div style={{ color: 'var(--negative)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {!data && !err && <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 10 }}>Loading…</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="caption mb-2">Active keywords</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{data.active_keywords.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>across {data.active_clients} active client{data.active_clients === 1 ? '' : 's'}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="caption mb-2">Est. spend / month</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtCurrency(data.est_monthly_gbp, 'GBP')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>≈ {fmtCurrency(data.est_monthly_usd, 'USD')} · rank {fmtCurrency(data.rank.monthly_usd, 'USD')} + AIO {fmtCurrency(data.aio.monthly_usd, 'USD')}</div>
            </div>
            <div className="card success" style={{ padding: 12 }}>
              <div className="caption mb-2">Suggested daily cap</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtCurrency(data.recommended_daily_cap_usd, 'USD')}<span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>/ day</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>3× peak run-day ({fmtCurrency(data.peak_day_usd, 'USD')})</div>
            </div>
          </div>
          <div className="callout" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
            <strong>Set the backstop:</strong> DataForSEO dashboard → <em>API Settings → Spending limits</em> → set the
            <strong> General Daily Limit</strong> to <strong>{fmtCurrency(data.recommended_daily_cap_usd, 'USD')}</strong>.
            Spend is spiky (every keyword is checked on one run day every 4 days), so this sits ~3× above a normal sweep —
            high enough never to block legitimate checks, low enough to stop a runaway loop. Over-limit calls return
            <code> 40203</code> until the 00:00 UTC reset. This is a backstop, not a throttle; it doesn&apos;t change normal spend.
          </div>
        </>
      )}
    </div>
  );
}

function ProviderCard({ entry }) {
  const s = entry.snapshot;
  const [showDiag, setShowDiag] = useState(false);
  let body, statusColour = 'var(--text-subtle)';
  if (!s) {
    body = <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No data yet — click Refresh.</div>;
  } else if (s.status === 'no_credentials') {
    body = <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Not configured</div>;
  } else if (s.status === 'error') {
    body = <div style={{ fontSize: 12, color: 'var(--negative)' }}>{s.error_message || 'Error'}</div>;
    statusColour = 'var(--negative)';
  } else {
    body = (
      <div>
        {s.cost_this_period != null && (
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
            {fmtCurrency(s.cost_this_period, s.currency)}
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>this month</span>
          </div>
        )}
        {s.cost_this_period == null && s.balance_remaining != null && (
          <>
            {entry.spend_this_month > 0 ? (
              // Spend is the headline — the panel exists to answer "how much
              // does this app cost me per month". Balance is the footnote.
              <>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                  {fmtCurrency(entry.spend_this_month, s.currency)}
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>this month</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                  {fmtCurrency(s.balance_remaining, s.currency)} remaining in pool
                </div>
              </>
            ) : (
              // No diff yet (one snapshot in the window) — show the balance
              // as the headline so the card isn't empty. Once a second
              // snapshot lands, spend swaps in.
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                {fmtCurrency(s.balance_remaining, s.currency)}
                <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>remaining</span>
              </div>
            )}
          </>
        )}
        {s.units_used != null && (
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>
            {s.units_used.toLocaleString()}{s.units_limit ? ` / ${s.units_limit.toLocaleString()}` : ''}{' '}
            <span style={{ color: 'var(--text-subtle)' }}>{s.unit_label || ''}</span>
          </div>
        )}
        {(s.cost_this_period == null && s.balance_remaining == null && s.units_used == null) && (
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
            {s.raw?.note || 'Configured — no balance API.'}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 6 }}>
          {s.snapshot_at ? `Updated ${new Date(s.snapshot_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>
    );
    statusColour = 'var(--positive)';
  }
  const statusClass =
    !s ? '' :
    s.status === 'error' ? 'danger' :
    s.status === 'no_credentials' ? 'warning' :
    'success';
  // Diagnostic — exposes the parsed breakdowns the Anthropic poll captures
  // (_by_cost_type / _by_workspace / _top_5_amounts / _workspaces_seen) so
  // a wrong total can be debugged inline without a DB query.
  const diag = s?.raw;
  const hasDiag = diag && (diag._by_model || diag._by_workspace || diag._top_5_amounts);
  return (
    <div className={`card ${statusClass}`} style={{ padding: 12 }}>
      <div className="caption mb-2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{entry.label}</span>
        {hasDiag && (
          <button type="button" onClick={() => setShowDiag((v) => !v)}
            title="Show raw breakdown from the API response"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-subtle)', padding: 0 }}>
            {showDiag ? '× close' : 'diagnose'}
          </button>
        )}
      </div>
      {body}
      {showDiag && hasDiag && (
        <div style={{ marginTop: 10, padding: 8, background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Workspaces seen ({(diag._workspaces_seen || []).length})</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', marginBottom: 8 }}>{(diag._workspaces_seen || []).join(', ') || '(none)'}</div>
          {diag._by_cost_type && Object.keys(diag._by_cost_type).length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>By cost type</div>
              <pre style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(diag._by_cost_type, null, 2)}</pre>
            </>
          )}
          {diag._by_model && Object.keys(diag._by_model).length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>By model</div>
              <pre style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(diag._by_model, null, 2)}</pre>
            </>
          )}
          {diag._by_workspace && Object.keys(diag._by_workspace).length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>By workspace</div>
              <pre style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(diag._by_workspace, null, 2)}</pre>
            </>
          )}
          {diag._top_5_amounts && diag._top_5_amounts.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Top 5 individual amounts</div>
              <pre style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(diag._top_5_amounts, null, 2)}</pre>
            </>
          )}
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Counters</div>
          <div style={{ fontSize: 10, fontFamily: 'monospace' }}>
            unique_lines={diag._aggregated_unique_lines} · buckets={diag._aggregated_buckets} · pages={diag._aggregated_pages}
          </div>
          {diag._bucket_samples && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>First 2 buckets verbatim</summary>
              <pre style={{ fontFamily: 'monospace', fontSize: 10, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(diag._bucket_samples, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function fmtCurrency(value, currency) {
  if (value == null) return '—';
  const c = currency || 'USD';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(value); }
  catch { return `${c} ${value.toFixed(2)}`; }
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
function CardTitle({ children }) {
  return <h2 className="caption">{children}</h2>;
}
function Field({ label, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <code style={{ color: 'var(--text)' }}>{value}</code>
    </div>
  );
}

// Workspace-wide contact library. The same contact (one row here) can be
// attached to many clients via outreach_contact_clients; this view shows
// every contact with the count + names of the clients they're attached to.
// Database → Tasks — the account exec's action queue for the journalist list:
// find new journalists, archive the ones who've gone quiet, and stay in touch
// with the key ones. Moved out of the Journalists list so that tab stays clean.
function JournalistTasks() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [err, setErr] = useState(null);
  // Discovery
  const [suggestions, setSuggestions] = useState([]);
  const [scoutClientId, setScoutClientId] = useState('');
  const [scoutBusy, setScoutBusy] = useState(false);
  const [mineBusy, setMineBusy] = useState(false);
  const [selSugg, setSelSugg] = useState(() => new Set());
  // Archive review
  const [archiveReview, setArchiveReview] = useState([]);
  // Stay in touch
  const [nudges, setNudges] = useState([]);
  const [nudgeDraft, setNudgeDraft] = useState(null);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  // Maintenance — dedupe, moves, deliverability
  const [dupes, setDupes] = useState([]);
  const [moves, setMoves] = useState([]);
  const [attention, setAttention] = useState({ bounced: [], guessed: [] });

  useEffect(() => {
    api.get('/clients').then(setClients).catch(() => {});
    loadSuggestions();
    loadArchiveReview();
    loadNudges();
    loadDupes();
    loadMoves();
    loadAttention();
  }, []);

  function loadDupes() { api.get('/pr/dedup/journalists/scan').then((r) => setDupes(r.clusters || [])).catch(() => {}); }
  function loadMoves() { api.get('/pr/contact-moves').then((r) => setMoves(r.items || [])).catch(() => {}); }
  function loadAttention() { api.get('/pr/needs-attention').then((r) => setAttention({ bounced: r.bounced || [], guessed: r.guessed || [] })).catch(() => {}); }
  async function mergeDupe(cluster, canonicalId) {
    const memberIds = cluster.members.map((m) => m.id).filter((id) => id !== canonicalId);
    try {
      await api.post('/pr/dedup/journalists/merge', { canonical_id: canonicalId, member_ids: memberIds });
      setDupes((p) => p.filter((c) => c.cluster_key !== cluster.cluster_key));
      toast(`Merged ${memberIds.length + 1} into one.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function dismissDupe(cluster) {
    try {
      await api.post('/pr/dedup/journalists/dismiss', { member_ids: cluster.members.map((m) => m.id) });
      setDupes((p) => p.filter((c) => c.cluster_key !== cluster.cluster_key));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function resolveMove(id, action) {
    try { await api.post(`/pr/contact-moves/${id}/${action}`, {}); setMoves((p) => p.filter((m) => m.id !== id)); if (action === 'apply') toast('Outlet updated.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }

  function loadSuggestions() { api.get('/pr/journalist-suggestions').then((r) => setSuggestions(r.items || [])).catch(() => {}); }
  async function runScout() {
    if (!scoutClientId) { toast('Pick a client to scout for.', 'error'); return; }
    setScoutBusy(true);
    try {
      const r = await api.post(`/pr/clients/${scoutClientId}/scout-journalists`, {});
      toast(r.added ? `Found ${r.found}, added ${r.added} new to review.` : `Scanned the web — nothing new to add right now (checked ${r.found}).`, r.added ? 'success' : 'info');
      loadSuggestions();
    } catch (e) { toast(e.message, 'error'); }
    finally { setScoutBusy(false); }
  }
  async function mineFeeds() {
    setMineBusy(true);
    try {
      const r = await api.post('/pr/feeds/mine', {});
      const bits = [];
      if (r.queued) bits.push(`${r.queued} new journalist${r.queued === 1 ? '' : 's'} from ${r.outlets} feed${r.outlets === 1 ? '' : 's'}`);
      if (r.flagged) bits.push(`${r.flagged} flagged gone-quiet`);
      toast(bits.length ? bits.join(' · ') : 'Feeds processed — nothing new to review right now.', bits.length ? 'success' : 'info');
      loadSuggestions();
      loadArchiveReview();
    } catch (e) { toast(e.message, 'error'); }
    finally { setMineBusy(false); }
  }
  async function approveSuggestion(sid) {
    try {
      await api.post(`/pr/journalist-suggestions/${sid}/approve`, {});
      setSuggestions((p) => p.filter((s) => s.id !== sid));
      setSelSugg((p) => { const n = new Set(p); n.delete(sid); return n; });
      toast('Added to the journalist list.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function dismissSuggestion(sid) {
    try {
      await api.post(`/pr/journalist-suggestions/${sid}/dismiss`, {});
      setSuggestions((p) => p.filter((s) => s.id !== sid));
      setSelSugg((p) => { const n = new Set(p); n.delete(sid); return n; });
    } catch (e) { toast(e.message, 'error'); }
  }
  async function bulkSuggestions(action, all = false) {
    // Group by client (cross-client queue) so each hits its client's endpoint.
    const pick = all ? new Set(suggestions.map((s) => s.id)) : selSugg;
    const byClient = {};
    for (const s of suggestions) if (pick.has(s.id)) (byClient[s.client_id] ||= []).push(s.id);
    try {
      let done = 0;
      for (const [cid, ids] of Object.entries(byClient)) {
        const r = await api.post(`/pr/clients/${cid}/journalist-suggestions/bulk`, { action, ids });
        done += r.done || 0;
      }
      setSuggestions((p) => p.filter((s) => !pick.has(s.id)));
      setSelSugg(new Set());
      toast(`${action === 'approve' ? 'Added' : 'Dismissed'} ${done}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  function toggleSugg(sid) {
    setSelSugg((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  }
  function toggleAllSugg() {
    setSelSugg((p) => p.size === suggestions.length ? new Set() : new Set(suggestions.map((s) => s.id)));
  }

  function loadArchiveReview() { api.get('/pr/archive-review').then((r) => setArchiveReview(r.items || [])).catch(() => {}); }
  async function resolveArchive(cid, action) {
    try { await api.post(`/pr/contacts/${cid}/${action}`, {}); setArchiveReview((list) => list.filter((c) => c.id !== cid)); }
    catch (e) { setErr(e.message); }
  }

  function loadNudges() { api.get('/pr/engagement').then((r) => setNudges(r.items || [])).catch(() => {}); }
  async function openNudge(n) {
    setNudgeDraft({ id: n.id, name: n.name, loading: true });
    try {
      const d = await api.post(`/pr/engagement/${n.id}/draft`, {});
      if (d.error) { setErr(d.error); setNudgeDraft(null); return; }
      setNudgeDraft({ id: n.id, name: n.name, to: d.to || '', subject: d.subject || '', body: d.body || '' });
    } catch (e) { setErr(e.message); setNudgeDraft(null); }
  }
  async function sendNudge() {
    if (!nudgeDraft) return;
    setNudgeBusy(true);
    try {
      const r = await api.post(`/pr/engagement/${nudgeDraft.id}/send`, { subject: nudgeDraft.subject, body: nudgeDraft.body });
      if (r.error) { setErr(r.error); return; }
      setNudges((list) => list.filter((n) => n.id !== nudgeDraft.id));
      setNudgeDraft(null);
    } catch (e) { setErr(e.message); }
    finally { setNudgeBusy(false); }
  }
  async function dismissNudge(id) {
    try { await api.post(`/pr/engagement/${id}/dismiss`, {}); setNudges((list) => list.filter((n) => n.id !== id)); if (nudgeDraft && nudgeDraft.id === id) setNudgeDraft(null); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="stack stack-lg">
      {err && <div style={{ padding: 8, background: 'var(--negative-soft)', color: 'var(--negative)', fontSize: 12, borderRadius: 'var(--r-sm)' }}>{err}</div>}

      {/* Find new journalists */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div className="h3 mb-2">🔭 Find new journalists</div>
            <div className="body-sm text-muted" style={{ marginBottom: 8 }}>
              Two ways in: <strong>scout the web</strong> for journalists who cover a client’s beats, or <strong>mine your RSS feeds</strong> for new bylines already appearing at outlets you track. Nothing’s added until you approve it.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ maxWidth: 260 }} value={scoutClientId} onChange={(e) => setScoutClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: runScout, disabled: scoutBusy || !scoutClientId })}>
                {scoutBusy ? 'Scanning…' : '✦ Find new journalists'}
              </button>
              <button className="btn btn-secondary btn-sm" title="Classify new bylines from every publication's RSS feed into review suggestions, and flag journalists who've gone quiet. Runs nightly too." {...roWrite(readOnly, { onClick: mineFeeds, disabled: mineBusy })}>
                {mineBusy ? 'Mining feeds…' : '🛰 Mine feeds now'}
              </button>
            </div>
          </div>
        </div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{suggestions.length} to review{selSugg.size ? ` · ${selSugg.size} selected` : ''}</span>
              <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: () => bulkSuggestions('approve', true) })}>Add all {suggestions.length}</button>
              {selSugg.size > 0 && <>
                <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => bulkSuggestions('approve') })}>Add selected</button>
                <button className="btn btn-secondary btn-sm" onClick={() => bulkSuggestions('dismiss')}>Dismiss selected</button>
              </>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead><tr><th style={{ width: 28 }}><input type="checkbox" checked={selSugg.size === suggestions.length} onChange={toggleAllSugg} /></th><th>Journalist</th><th>Client</th><th>Outlet</th><th>Beat</th><th>Why</th><th style={{ width: 120 }}></th></tr></thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={selSugg.has(s.id)} onChange={() => toggleSugg(s.id)} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {s.name}
                          {s.source === 'rss' && <span className="chip" style={{ fontSize: 9, marginLeft: 6 }} title="Discovered from this outlet's RSS feed">🛰 via feed</span>}
                        </div>
                        {s.email
                          ? <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{s.email}</div>
                          : s.guessed_email
                            ? <div style={{ fontSize: 11, color: 'var(--danger, #c62828)', fontWeight: 600 }} title="Guessed from this outlet's email pattern — NOT confirmed">{s.guessed_email} <span style={{ fontWeight: 400 }}>· guess</span></div>
                            : <span className="chip" style={{ fontSize: 10 }}>no email</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{s.client_name}</td>
                      <td>{s.outlet || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.beat || '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        {s.why || '—'}
                        {s.source_url && <> · <a href={s.source_url} target="_blank" rel="noopener noreferrer">source ↗</a></>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => approveSuggestion(s.id) })}>Add</button>
                        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 4 }} onClick={() => dismissSuggestion(s.id)} title="Dismiss">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Inactive → archive */}
      <div className="card">
        <div className="h3 mb-2">📉 Inactive journalists {archiveReview.length ? `· ${archiveReview.length}` : ''}</div>
        {archiveReview.length === 0 ? (
          <p className="body-sm text-muted" style={{ margin: 0 }}>Nothing to review — the overnight sweep hasn’t flagged anyone as gone quiet.</p>
        ) : (
          <>
            <p className="body-sm text-muted" style={{ marginBottom: 10 }}>No coverage in 12 months and no recent byline found online. People move on — archive the ones who've left (reversible), keep the rest.</p>
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
              {archiveReview.slice(0, 100).map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                  <div style={{ fontSize: 13 }}><strong>{c.name || '—'}</strong>{c.outlet ? ` · ${c.outlet}` : ''}</div>
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => resolveArchive(c.id, 'archive')}>Archive</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => resolveArchive(c.id, 'unarchive')}>Keep</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Stay in touch */}
      <div className="card">
        <div className="h3 mb-2">💬 Stay in touch {nudges.length ? `· ${nudges.length}` : ''}</div>
        {nudges.length === 0 ? (
          <p className="body-sm text-muted" style={{ margin: 0 }}>No fresh articles from your key journalists to react to right now.</p>
        ) : (
          <>
            <p className="body-sm text-muted" style={{ marginBottom: 10 }}>Read it, then send a genuine note. Claude drafts one specific to the article — you approve and send. (Tier-1 / strong-relationship journalists only.)</p>
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              {nudges.slice(0, 50).map((n) => (
                <div key={n.id} style={{ padding: '8px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
                      <strong>{n.name || '—'}</strong>{n.outlet ? ` · ${n.outlet}` : ''}<br />
                      <a href={n.article_url} target="_blank" rel="noreferrer">{(n.article_title || n.article_url).slice(0, 90)}</a>
                      {n.article_date ? <span className="text-muted"> · {n.article_date}</span> : null}
                    </div>
                    <div style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openNudge(n)}>Draft note</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => dismissNudge(n.id)}>Dismiss</button>
                    </div>
                  </div>
                  {nudgeDraft && nudgeDraft.id === n.id && (
                    <div style={{ marginTop: 8, paddingLeft: 4 }}>
                      {nudgeDraft.loading ? <p className="body-sm text-muted">Drafting…</p> : (
                        <>
                          {!nudgeDraft.to && <div className="body-sm" style={{ color: 'var(--negative)', marginBottom: 6 }}>No real email on file — can't send.</div>}
                          <input className="input" style={{ marginBottom: 6 }} value={nudgeDraft.subject} onChange={(e) => setNudgeDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="Subject" />
                          <textarea className="input" rows={5} style={{ marginBottom: 6 }} value={nudgeDraft.body} onChange={(e) => setNudgeDraft((d) => ({ ...d, body: e.target.value }))} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: sendNudge, disabled: nudgeBusy || !nudgeDraft.to || !nudgeDraft.subject || !nudgeDraft.body })}>{nudgeBusy ? 'Sending…' : 'Send'}</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setNudgeDraft(null)}>Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Possible outlet moves */}
      {moves.length > 0 && (
        <div className="card">
          <div className="h3 mb-2">🔀 Possible outlet moves · {moves.length}</div>
          <p className="body-sm text-muted" style={{ marginBottom: 10 }}>Spotted in the feeds: a journalist you know is now bylined at a different outlet. Apply to move them, or dismiss if it's a namesake.</p>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {moves.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                <div style={{ fontSize: 13 }}>
                  <strong>{m.name || '—'}</strong> · {m.from_outlet || '—'} <span className="text-muted">→</span> <strong>{m.to_outlet || '—'}</strong>
                  {m.article_url && <> · <a href={m.article_url} target="_blank" rel="noreferrer">{(m.article_title || 'byline').slice(0, 60)} ↗</a></>}
                </div>
                <div style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => resolveMove(m.id, 'apply') })}>Apply move</button>{' '}
                  <button className="btn btn-secondary btn-sm" onClick={() => resolveMove(m.id, 'dismiss')}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate journalists */}
      {dupes.length > 0 && (
        <div className="card">
          <div className="h3 mb-2">👥 Duplicate journalists · {dupes.length}</div>
          <p className="body-sm text-muted" style={{ marginBottom: 10 }}>Likely the same person imported twice. Merge keeps all coverage and client links on one record; the suggested keeper has the most history.</p>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            {dupes.map((c) => (
              <div key={c.cluster_key} style={{ padding: '8px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                <div className="body-sm text-muted" style={{ marginBottom: 4 }}>{c.method === 'exact_email' ? 'Same email' : c.method === 'name_and_outlet' ? 'Same name & outlet' : 'Same name & domain'}</div>
                {c.members.map((m) => (
                  <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
                    <div style={{ fontSize: 13 }}>
                      {m.id === c.suggested && <span className="chip" style={{ fontSize: 9, marginRight: 6 }}>keep</span>}
                      <strong>{m.name}</strong>{m.email ? ` · ${m.email}` : ''}{m.outlet ? ` · ${m.outlet}` : ''}
                      <span className="text-muted" style={{ fontSize: 11 }}> · {m.coverage} coverage · {m.clients} client{m.clients === 1 ? '' : 's'}</span>
                    </div>
                    <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => mergeDupe(c, m.id) })} title="Merge the others into this record">Keep this</button>
                  </div>
                ))}
                <div style={{ marginTop: 4 }}>
                  <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => mergeDupe(c, c.suggested) })}>Merge (keep suggested)</button>{' '}
                  <button className="btn btn-secondary btn-sm" onClick={() => dismissDupe(c)}>Not duplicates</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deliverability attention */}
      {(attention.bounced.length > 0 || attention.guessed.length > 0) && (
        <div className="card">
          <div className="h3 mb-2">✉️ Email attention {attention.bounced.length + attention.guessed.length ? `· ${attention.bounced.length + attention.guessed.length}` : ''}</div>
          {attention.bounced.length > 0 && (
            <>
              <div className="body-sm" style={{ fontWeight: 600, marginBottom: 4 }}>Bounced — kept out of sends until fixed ({attention.bounced.length})</div>
              <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 12 }}>
                {attention.bounced.slice(0, 100).map((c) => (
                  <div key={c.id} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                    <strong>{c.name || '—'}</strong>{c.outlet ? ` · ${c.outlet}` : ''} · <span style={{ color: 'var(--danger, #c62828)' }}>{c.email}</span>
                    {c.bounce_reason && <span className="text-muted" style={{ fontSize: 11 }}> · {String(c.bounce_reason).slice(0, 50)}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          {attention.guessed.length > 0 && (
            <>
              <div className="body-sm" style={{ fontWeight: 600, marginBottom: 4 }}>Unconfirmed (guessed) addresses ({attention.guessed.length})</div>
              <p className="body-sm text-muted" style={{ marginTop: 0, marginBottom: 6 }}>Guessed from the outlet's pattern — worth confirming before a big send.</p>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {attention.guessed.slice(0, 100).map((c) => (
                  <div key={c.id} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                    <strong>{c.name || '—'}</strong>{c.outlet ? ` · ${c.outlet}` : ''} · <span style={{ color: 'var(--danger, #c62828)' }}>{c.email}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ContactsLibrary() {
  const { readOnly } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [clients, setClients] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [openContact, setOpenContact] = useState(null);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [bulkTagsToAdd, setBulkTagsToAdd] = useState(() => new Set());

  // Filter state lives in the URL params we send to the server — with
  // 21k+ contacts in the library the old client-side filter was lying
  // (it only filtered the first 1000 returned). Now the server applies
  // search + tags and returns both the page (capped at 1000) and the
  // unbounded match count so the "delete all matching" button is
  // honest about how much it's about to wipe.
  const [total, setTotal] = useState(0);

  const PAGE = 200;
  function buildFilterParams() {
    const p = new URLSearchParams();
    p.set('include_totals', '1');
    p.set('include_count', '1');
    p.set('limit', String(PAGE));
    if (search.trim()) p.set('search', search.trim());
    // This library is the shared journalist/press list only. Leads live
    // per-client in Owned → Email, never in this workspace-wide view.
    p.set('kind', 'media');
    if (activeTags.size) p.set('tags_all', Array.from(activeTags).join(','));
    return p;
  }
  const [loadingMore, setLoadingMore] = useState(false);
  async function loadMore() {
    setLoadingMore(true);
    try {
      const p = buildFilterParams();
      p.delete('include_count');
      p.set('offset', String((rows || []).length));
      const res = await api.get(`/outreach/contacts/library?${p.toString()}`);
      setRows((prev) => [...(prev || []), ...(res.rows || [])]);
    } catch (e) { setErr(e.message); }
    finally { setLoadingMore(false); }
  }

  // Filter parts sent to the server for the by-filter delete — same
  // shape as the list endpoint expects.
  function filterBody() {
    const o = { kind: ['media'] };
    if (search.trim()) o.search = search.trim();
    if (activeTags.size) o.tags_all = Array.from(activeTags);
    return o;
  }

  useEffect(() => {
    Promise.all([
      api.get('/clients'),
      api.get('/outreach/tags'),
    ]).then(([cs, ts]) => {
      setClients(cs);
      setTags(ts);
    }).catch(e => setErr(e.message));
  }, []);

  // Refetch the list when filter changes, debounced.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/outreach/contacts/library?${buildFilterParams().toString()}`);
        setRows(res.rows || []);
        setTotal(res.total ?? (res.rows?.length || 0));
        setSelected(new Set());
      } catch (e) { setErr(e.message); }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeTags]);

  async function reload() {
    try {
      const res = await api.get(`/outreach/contacts/library?${buildFilterParams().toString()}`);
      setRows(res.rows || []);
      setTotal(res.total ?? (res.rows?.length || 0));
      setSelected(new Set());
      // Tags may have changed (bulk-tag adds new ones) — refresh chips too.
      api.get('/outreach/tags').then(setTags).catch(() => {});
    } catch (e) { setErr(e.message); }
  }

  async function exportCsv() {
    // Stream the export via the existing api.raw helper so the Bearer
    // token rides along; convert to a Blob and trigger a download.
    // Server-side endpoint walks every match (no 1000-row cap) so the
    // CSV reflects the filtered total, not just what's on screen.
    try {
      const qs = buildFilterParams();
      qs.delete('include_totals'); qs.delete('include_count');
      const res = await api.raw(`/outreach/contacts/library/export.csv?${qs.toString()}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-library-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { setErr(e.message); }
  }

  async function destroyAllMatching() {
    if (!total) return;
    const filterDesc = (search.trim() ? `matching "${search.trim()}"` : '') +
      (activeTags.size ? ` tagged ${Array.from(activeTags).join(' + ')}` : '') ||
      'in the entire library';
    if (!confirm(`Delete all ${total.toLocaleString()} journalists ${filterDesc.trim()} from the library? This removes them from every client they were attached to and CANNOT be undone.`)) return;
    if (total > 100) {
      const typed = prompt(`This will delete ${total.toLocaleString()} journalists. Type DELETE to confirm.`);
      if (typed !== 'DELETE') return;
    }
    try {
      const res = await api.post('/outreach/contacts/library/delete-by-filter', {
        ...filterBody(),
        expected_count: total,
      });
      setInfo(`Deleted ${res.deleted.toLocaleString()} journalist${res.deleted === 1 ? '' : 's'}.`);
      await reload();
    } catch (e) { setErr(e.message); }
  }

  function toggleTag(t) {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!filtered) return;
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.id)));
  }

  async function attachTo(clientId) {
    if (!selected.size) return;
    try {
      await api.post(`/outreach/clients/${clientId}/contacts/attach`, { contact_ids: Array.from(selected) });
      setAttachOpen(false);
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function destroyContacts() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} journalist${selected.size === 1 ? '' : 's'} from the library entirely? This also removes them from every client they were attached to.`)) return;
    try {
      await api.post('/outreach/contacts/bulk-delete', { ids: Array.from(selected) });
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function destroyOne(contactId) {
    if (!confirm('Delete this journalist from the library entirely? This removes them from every client they were attached to.')) return;
    try {
      await api.delete(`/outreach/contacts/${contactId}`);
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  function addBulkTag(t) {
    const norm = String(t || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!norm) return;
    setBulkTagsToAdd(prev => new Set([...prev, norm]));
    setBulkTagInput('');
  }

  async function applyBulkTags() {
    if (!selected.size || !bulkTagsToAdd.size) return;
    try {
      await api.post('/outreach/contacts/bulk-tags', {
        ids: Array.from(selected),
        add: Array.from(bulkTagsToAdd),
      });
      setBulkTagsOpen(false);
      setBulkTagsToAdd(new Set());
      await reload();
      setInfo(`Tagged ${selected.size} journalist${selected.size === 1 ? '' : 's'}.`);
    } catch (e) { setErr(e.message); }
  }

  const clientNameById = Object.fromEntries(clients.map(c => [c.id, c.name]));
  // Server already applied search + tags filters; just use the rows we got.
  const filtered = rows;

  return (
    <div>
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityLabel="journalist"
        allowClients
        onImported={async () => {
          await reload();
        }}
      />
      {openContact && (
        <EditContactModal
          contact={openContact}
          entityLabel="journalist"
          onClose={() => setOpenContact(null)}
          onSaved={async () => { await reload(); }}
        />
      )}
      <ContactTidyModal
        open={tidyOpen}
        onClose={() => setTidyOpen(false)}
        filterBody={filterBody()}
        totalInFilter={total}
        onApplied={async () => { await reload(); }}
      />
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <CardTitle>Journalists</CardTitle>
            <p className="body-sm text-muted">
              One workspace-wide list of journalists. Each journalist can be attached to as many clients
              as you like — a journalist who unsubscribes from one client's emails stays subscribed
              to the others.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/contacts/cleanup" className="btn btn-secondary btn-sm"
              title="Find and merge duplicates, fold orphaned coverage onto the right person, fix capitalisation/emails/companies, and strip leftover Notion-URL fragments — all in one place.">
              🧹 Cleanup Centre
            </Link>
            <button onClick={exportCsv} disabled={!total} className="btn btn-secondary btn-sm"
              title={total ? `Download ${total.toLocaleString()} journalist${total === 1 ? '' : 's'} matching the current filter` : 'Nothing to export'}>
              ↓ Export CSV
            </button>
            <button onClick={() => setImportOpen(true)} className="btn btn-primary btn-sm">↑ Import CSV</button>
          </div>
        </div>


        <div style={{ marginTop: 14 }}>
          <input
            placeholder="Search by name, email or outlet…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input" style={{ width: '100%' }}
          />
          {!!tags.length && (() => {
            // Filter by the tag-search input (substring, case-insensitive)
            // then collapse to a short default unless expanded. Manage all
            // tags from the Tags tab — this strip is just for filtering.
            const q = tagSearch.trim().toLowerCase();
            const filtered = q ? tags.filter(t => t.tag.toLowerCase().includes(q)) : tags;
            const COLLAPSED = 24;
            const showAll = tagsExpanded || filtered.length <= COLLAPSED;
            const visible = showAll ? filtered : filtered.slice(0, COLLAPSED);
            const hiddenCount = filtered.length - visible.length;
            return (
              <div style={{ marginTop: 10 }}>
                <input
                  placeholder={`Filter ${tags.length} tag${tags.length === 1 ? '' : 's'}…`}
                  value={tagSearch}
                  onChange={e => setTagSearch(e.target.value)}
                  className="input" style={{ padding: '5px 9px', fontSize: 12, maxWidth: 280, marginBottom: 8 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%' }}>
                  {visible.map(t => {
                    const on = activeTags.has(t.tag);
                    return (
                      <span key={t.tag} className="chip" onClick={() => toggleTag(t.tag)}
                        style={{ cursor: 'pointer', border: '1px solid #111', color: on ? '#fff' : '#111', background: on ? '#111' : 'transparent' }}>
                        {t.tag} <span style={{ opacity: 0.6 }}>· {t.count}</span>
                      </span>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button onClick={() => setTagsExpanded(true)} className="chip chip-outline" style={{ fontWeight: 700, color: 'var(--text)',
                     }}>
                      + {hiddenCount} more
                    </button>
                  )}
                  {tagsExpanded && filtered.length > COLLAPSED && (
                    <button onClick={() => setTagsExpanded(false)} className="chip chip-outline" style={{ fontWeight: 700, color: 'var(--text-muted)',
                     }}>
                      show less
                    </button>
                  )}
                  {!filtered.length && (
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', alignSelf: 'center' }}>No tags match "{tagSearch}"</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {err && <div style={{ marginTop: 10, padding: 8, background: 'var(--negative-soft)', borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 12 }}>{err}</div>}
        {info && <div style={{ marginTop: 10, padding: 8, background: 'var(--positive-soft)', borderRadius: 'var(--r-sm)', color: 'var(--positive)', fontSize: 12 }}>{info}</div>}

        {!filtered && <div style={{ marginTop: 16, color: 'var(--text-subtle)' }}>Loading…</div>}
        {filtered && !filtered.length && (
          <div style={{ marginTop: 16, color: 'var(--text-subtle)', fontSize: 13 }}>
            {search.trim() || activeTags.size
              ? 'No journalists match this filter.'
              : `No journalists yet. Use ↑ Import CSV above, or add them from a client's Earned → Pitch — they'll show up here automatically.`}
          </div>
        )}

        {filtered && !!filtered.length && (
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selected.size} selected
                {total > filtered.length
                  ? <> · Showing <strong>{filtered.length.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong> matching</>
                  : <> of <strong>{filtered.length.toLocaleString()}</strong></>}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setBulkTagsOpen(o => !o)} disabled={!selected.size} className="btn btn-secondary btn-sm">
                + Add tags
              </button>
              <button onClick={() => setAttachOpen(o => !o)} disabled={!selected.size} className="btn btn-primary">
                Add to client…
              </button>
              <button onClick={destroyContacts} disabled={!selected.size} className="btn btn-danger btn-sm">
                Delete selected
              </button>
              {total > 0 && (
                <button onClick={destroyAllMatching} className="btn btn-danger btn-sm"
                  title={total > filtered.length ? `Delete all ${total.toLocaleString()} matching, not just the ${filtered.length.toLocaleString()} on screen` : ''}>
                  Delete all {total.toLocaleString()} matching
                </button>
              )}
            </div>

            {bulkTagsOpen && (
              <div style={{ marginBottom: 10, padding: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', background: 'var(--surface-raised)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Add tags to the {selected.size} selected journalist{selected.size === 1 ? '' : 's'}:
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  {Array.from(bulkTagsToAdd).map(t => (
                    <span key={t} className="chip chip-accent" onClick={() => setBulkTagsToAdd(prev => { const n = new Set(prev); n.delete(t); return n; })}>{t} ×</span>
                  ))}
                  <input
                    value={bulkTagInput}
                    onChange={e => setBulkTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addBulkTag(bulkTagInput); } }}
                    placeholder="type a tag and press Enter"
                    className="input" style={{ flex: '1 1 200px', minWidth: 160 }}
                  />
                </div>
                {!!tags.length && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {tags.slice(0, 16).filter(t => !bulkTagsToAdd.has(t.tag)).map(t => (
                      <button key={t.tag} onClick={() => addBulkTag(t.tag)} className="chip chip-outline">
                        {t.tag} <span style={{ opacity: 0.5 }}>· {t.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={applyBulkTags} disabled={!bulkTagsToAdd.size} className="btn btn-primary">
                    Apply to {selected.size}
                  </button>
                  <button onClick={() => { setBulkTagsOpen(false); setBulkTagsToAdd(new Set()); }} className="btn btn-secondary btn-sm">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {attachOpen && (
              <div style={{ marginBottom: 10, padding: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', background: 'var(--surface-raised)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Attach the {selected.size} selected journalist{selected.size === 1 ? '' : 's'} to:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {clients.map(c => (
                    <button key={c.id} onClick={() => attachTo(c.id)} className="btn btn-secondary btn-sm">
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <table className="contacts-list-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                  </th>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th style={{ textAlign: 'left' }}>Email</th>
                  <th style={{ textAlign: 'left' }}>Publication</th>
                  <th style={{ textAlign: 'left' }}>Beat</th>
                  <th style={{ textAlign: 'left' }}>Tags</th>
                  <th style={{ textAlign: 'left' }}>Attached to</th>
                  <th style={{ textAlign: 'left' }}>Engagement</th>
                  <th style={{ width: 28  }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const totalsTip = r.total_sent != null
                    ? `Sent ${r.total_sent} · Opened ${r.total_opened || 0} · Clicked ${r.total_clicked || 0} · Replied ${r.total_replied || 0}` +
                      (r.last_sent_at ? ` · Last sent ${new Date(r.last_sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '')
                    : '';
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }}>
                      <td  onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                      </td>
                      <td  onClick={() => setOpenContact(r)} title={totalsTip}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.name || '(unnamed)'}</span>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>
                        <span style={{ color: 'var(--text-muted)' }}>{r.email || '—'}</span>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>{r.company || r.outlet_name || '—'}</td>
                      <td  onClick={() => setOpenContact(r)}>
                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                          {Array.isArray(r.beats) && r.beats.length ? r.beats.join(', ') : '—'}
                        </span>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {(r.tags || []).map(t => (
                            <span key={t} style={{ cursor: 'default', padding: '1px 7px', fontSize: 10, color: '#111', border: '1px solid #d1d5db', borderRadius: 20, background: 'transparent' }}>{t}</span>
                          ))}
                        </div>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {(r.client_ids || []).length
                            ? (r.client_ids || []).map(cid => clientNameById[cid] || '…').join(', ')
                            : <span style={{ color: 'var(--text-subtle)' }}>library only</span>}
                        </div>
                      </td>
                      <td  onClick={() => setOpenContact(r)} title={totalsTip}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {r.total_sent ? `${r.total_sent} sent · ${r.total_opened || 0} opened` : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                        </div>
                      </td>
                      <td  onClick={e => e.stopPropagation()}>
                        <button onClick={() => destroyOne(r.id)} title="Delete from library"
                          style={{ background: 'none', border: 'none', color: 'var(--negative)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length < total && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button onClick={loadMore} disabled={loadingMore} className="btn btn-secondary btn-sm">
                  {loadingMore ? 'Loading…' : `Load more (${(total - filtered.length).toLocaleString()} more)`}
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Tag manager — lists every tag in the workspace with its contact count,
// and lets the AM rename or delete tags one at a time. Use this to clean
// up the long tail of imported-but-unwanted tags. Operations are scoped
// to the caller's visibility on the backend.
function TagsManager() {
  const { readOnly } = useAuth();
  const [tags, setTags] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('count'); // 'count' | 'name'
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [plan, setPlan] = useState(null);            // { operations: [], tagCount }
  const [selectedOps, setSelectedOps] = useState(() => new Set());
  const [applying, setApplying] = useState(false);

  async function reload() {
    try {
      const t = await api.get('/outreach/tags');
      setTags(t);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { reload(); }, []);

  async function renameTag(tag) {
    const next = prompt(`Rename "${tag}" everywhere it's used to:`, tag);
    if (!next || next.trim().toLowerCase() === tag) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/outreach/tags/rename', { from: tag, to: next });
      setInfo(`Renamed "${tag}" → "${r.to}" on ${r.updated.toLocaleString()} journalist${r.updated === 1 ? '' : 's'}.`);
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function tidyWithClaude() {
    setAnalyzing(true); setErr(null); setInfo(null); setPlan(null); setSelectedOps(new Set());
    try {
      const r = await api.post('/outreach/tags/analyze', {});
      setPlan(r);
      // Pre-tick everything Claude suggested — the AM can untick anything
      // they disagree with. Safer than ticking nothing (would be missed).
      setSelectedOps(new Set((r.operations || []).map((_, i) => i)));
      if (!(r.operations || []).length) setInfo('Claude has no cleanup suggestions — the catalogue looks tidy.');
    } catch (e) { setErr(e.message); }
    finally { setAnalyzing(false); }
  }

  async function applyPlan() {
    if (!plan || !selectedOps.size) return;
    const ops = plan.operations.filter((_, i) => selectedOps.has(i));
    if (!confirm(`Apply ${ops.length} cleanup operation${ops.length === 1 ? '' : 's'}? This rewrites tags on journalists and can't be undone in one click.`)) return;
    setApplying(true); setErr(null);
    try {
      const r = await api.post('/outreach/tags/apply-plan', { operations: ops });
      const totals = (r.results || []).reduce((acc, x) => {
        acc[x.op.type] = (acc[x.op.type] || 0) + (x.updated || 0);
        return acc;
      }, {});
      const summary = Object.entries(totals).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(' · ');
      setInfo(`Applied ${ops.length} operation${ops.length === 1 ? '' : 's'}. ${summary}`);
      setPlan(null); setSelectedOps(new Set());
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setApplying(false); }
  }

  async function deleteTag(tag, count) {
    if (!confirm(`Remove the tag "${tag}" from ${count.toLocaleString()} journalist${count === 1 ? '' : 's'}? The journalists themselves stay; only the tag is stripped.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/outreach/tags/delete', { tag });
      setInfo(`Removed "${tag}" from ${r.updated.toLocaleString()} journalist${r.updated === 1 ? '' : 's'}.`);
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!tags) return <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>;

  const q = search.trim().toLowerCase();
  let filtered = q ? tags.filter(t => t.tag.toLowerCase().includes(q)) : tags;
  if (sort === 'name') filtered = [...filtered].sort((a, b) => a.tag.localeCompare(b.tag));
  else filtered = [...filtered].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <CardTitle>Tags</CardTitle>
            <p className="body-sm text-muted">
              Every tag in the workspace. Rename merges journalists already on the new name; delete strips
              the tag from every journalist (the journalists themselves stay). Use this to clean up junk from
              old CSV imports.
            </p>
          </div>
          <button {...roWrite(readOnly, { onClick: tidyWithClaude, disabled: analyzing || applying, title: 'Send the tag list to Claude and get cleanup suggestions' })} className="btn btn-secondary btn-sm">
            {analyzing ? 'Analysing…' : '✦ Tidy with Claude'}
          </button>
        </div>

        {plan && plan.operations && plan.operations.length > 0 && (
          <div style={{ marginTop: 14, padding: 14, border: '1px solid #ddd6a8', borderRadius: 'var(--r-md)', background: 'var(--warning-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                Claude's cleanup plan — {plan.operations.length} suggestion{plan.operations.length === 1 ? '' : 's'} across {plan.tagCount} tag{plan.tagCount === 1 ? '' : 's'}
              </div>
              <button onClick={() => { setPlan(null); setSelectedOps(new Set()); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-subtle)' }}>×</button>
            </div>
            <p className="body-sm text-muted" style={{ marginBottom: 12  }}>
              Untick anything you disagree with, then apply. Each operation rewrites tags on journalists and can't be undone in one click.
            </p>
            <div style={{ maxHeight: 380, overflowY: 'auto', borderTop: '1px solid #eee' }}>
              {plan.operations.map((op, i) => {
                const ticked = selectedOps.has(i);
                return (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 0', borderBottom: '1px solid #f0eccd', cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={ticked} onChange={() => {
                      setSelectedOps(prev => {
                        const n = new Set(prev);
                        if (n.has(i)) n.delete(i); else n.add(i);
                        return n;
                      });
                    }} style={{ marginTop: 3 }} />
                    <div style={{ flex: 1, fontSize: 12 }}>
                      <div style={{ marginBottom: 3 }}>
                        <span className="chip chip-outline" style={{ padding: '1px 8px', fontSize: 10, marginRight: 6  }}>{op.type}</span>
                        <OpSummary op={op} />
                      </div>
                      {op.why && <div style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>{op.why}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <button onClick={() => setSelectedOps(new Set(plan.operations.map((_, i) => i)))} className="btn btn-secondary btn-sm">Tick all</button>
              <button onClick={() => setSelectedOps(new Set())} className="btn btn-secondary btn-sm">Untick all</button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedOps.size} of {plan.operations.length} ticked</span>
              <button onClick={applyPlan} disabled={!selectedOps.size || applying}
                className="btn btn-primary btn-sm">
                {applying ? 'Applying…' : `Apply ${selectedOps.size} operation${selectedOps.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <input
            placeholder={`Search ${tags.length} tag${tags.length === 1 ? '' : 's'}…`}
            value={search} onChange={e => setSearch(e.target.value)}
            className="input" style={{ flex: '1 1 240px' }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            Sort:
            <button onClick={() => setSort('count')} className="chip" style={{ cursor: 'pointer', border: 'var(--border-w) solid ' + (sort === 'count' ? 'var(--text)' : 'var(--card-border)'), background: sort === 'count' ? 'var(--text)' : 'var(--surface)', color: sort === 'count' ? '#fff' : 'var(--text)' }}>by count</button>
            <button onClick={() => setSort('name')} className="chip" style={{ cursor: 'pointer', border: 'var(--border-w) solid ' + (sort === 'name' ? 'var(--text)' : 'var(--card-border)'), background: sort === 'name' ? 'var(--text)' : 'var(--surface)', color: sort === 'name' ? '#fff' : 'var(--text)' }}>A → Z</button>
          </div>
        </div>

        {err && <div style={{ marginTop: 10, padding: 8, background: 'var(--negative-soft)', borderRadius: 'var(--r-sm)', color: 'var(--negative)', fontSize: 12 }}>{err}</div>}
        {info && <div style={{ marginTop: 10, padding: 8, background: 'var(--positive-soft)', borderRadius: 'var(--r-sm)', color: 'var(--positive)', fontSize: 12 }}>{info}</div>}

        {!filtered.length ? (
          <div style={{ marginTop: 16, color: 'var(--text-subtle)', fontSize: 13 }}>
            {q ? `No tags match "${search}".` : 'No tags yet.'}
          </div>
        ) : (
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th >Tag</th>
                  <th style={{ width: 120, textAlign: 'right'  }}>Journalists</th>
                  <th style={{ width: 200, textAlign: 'right'  }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.tag}>
                    <td >
                      <span className="chip chip-outline" style={{ cursor: 'default', padding: '2px 9px'  }}>{t.tag}</span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums'  }}>
                      {t.count.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap'  }}>
                      <button onClick={() => renameTag(t.tag)} disabled={busy} className="btn btn-secondary btn-sm">
                        Rename
                      </button>
                      <button onClick={() => deleteTag(t.tag, t.count)} disabled={busy}
                        className="btn btn-danger btn-sm" style={{ marginLeft: 6  }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// Claude-driven contact data cleanup. Takes the current Contacts
// library filter, sends matching contacts to Claude in batches, then
// lets the AM tick which per-field fixes to apply. Each accepted fix
// writes an audit row so the change history is visible later from
// the contact's Edit modal.
function ContactTidyModal({ open, onClose, filterBody, totalInFilter, onApplied }) {
  const { readOnly } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | analysing | review | applying | done
  const [result, setResult] = useState(null); // { suggestions, analysed, capped }
  const [selected, setSelected] = useState(new Set());
  const [err, setErr] = useState(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [progress, setProgress] = useState({ processed: 0, total: 0, found: 0 });
  const pollRef = React.useRef(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle'); setResult(null); setSelected(new Set());
      setErr(null); setAppliedCount(0);
      setProgress({ processed: 0, total: 0, found: 0 });
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [open]);

  // Kick off a background run, then poll every 2s until done. The run
  // updates processed + suggestions incrementally so we can show a live
  // progress bar even on a 17k-contact sweep. Closing the modal cancels
  // polling but the run continues server-side; re-opening picks back up.
  async function runAnalyse() {
    setPhase('analysing'); setErr(null);
    setProgress({ processed: 0, total: 0, found: 0 });
    try {
      const r = await api.post('/outreach/contacts/analyze-tidy', { ...filterBody });
      const runId = r.runId;
      setProgress((p) => ({ ...p, total: r.total || 0 }));
      // First poll happens immediately so the bar pops out of zero
      // quickly on tiny runs.
      const tick = async () => {
        try {
          const run = await api.get(`/outreach/contacts/analyze-tidy/runs/${runId}`);
          setProgress({
            processed: run.processed || 0,
            total: run.total || 0,
            found: (run.suggestions || []).length,
          });
          if (run.status === 'done') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            const finalResult = {
              suggestions: run.suggestions || [],
              analysed: run.total || 0,
              capped: false,
            };
            setResult(finalResult);
            setSelected(new Set((finalResult.suggestions || []).map((_, i) => i)));
            setPhase('review');
          } else if (run.status === 'failed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setErr(run.error || 'Run failed');
            setPhase('idle');
          }
        } catch (e) { /* transient — keep polling */ }
      };
      await tick();
      pollRef.current = setInterval(tick, 2000);
    } catch (e) { setErr(e.message); setPhase('idle'); }
  }

  async function apply() {
    if (!result || !selected.size) return;
    const accepted = result.suggestions.filter((_, i) => selected.has(i));
    setPhase('applying'); setErr(null);
    try {
      const r = await api.post('/outreach/contacts/apply-tidy', { suggestions: accepted });
      setAppliedCount(r.applied || 0);
      setPhase('done');
      onApplied?.();
    } catch (e) { setErr(e.message); setPhase('review'); }
  }

  if (!open) return null;

  // Group suggestions by contact so the AM can see "this row needs 3 fixes"
  // rather than 3 unrelated lines.
  const grouped = result ? groupByContact(result.suggestions) : [];

  return (
    <div style={tidyStyles.overlay} onClick={onClose}>
      <div style={tidyStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={tidyStyles.header}>
          <div>
            <div style={tidyStyles.eyebrow}>Tidy with Claude</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Journalist data cleanup</h2>
          </div>
          <button onClick={onClose} style={tidyStyles.closeBtn}>×</button>
        </div>

        {err && <div style={tidyStyles.err}>{err}</div>}

        {phase === 'idle' && (
          <div>
            <p style={tidyStyles.hint}>
              Claude will look at the journalists matching your current filter and propose fixes:
              capitalisation, missing company derived from email domain, lowercase emails, URL
              schemes, name splits, and similar. You review each suggestion before anything
              changes — every applied change writes an audit row so you can see what happened
              later.
            </p>
            <div style={tidyStyles.summary}>
              <div><strong>{(totalInFilter || 0).toLocaleString()}</strong> journalists will be analysed</div>
              <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 4 }}>
                Runs in the background — you can close this modal and come back. Roughly ~$1 per 500 journalists in Claude API spend.
              </div>
            </div>
            <div style={tidyStyles.footer}>
              <button onClick={onClose} style={tidyStyles.ghostBtn}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button {...roWrite(readOnly, { onClick: runAnalyse })} style={tidyStyles.btn}>Start analysis</button>
            </div>
          </div>
        )}

        {phase === 'analysing' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Claude is reading the journalists in batches of 40 — {progress.processed.toLocaleString()} of {(progress.total || totalInFilter || 0).toLocaleString()} done.
            </div>
            <div style={{ background: 'var(--surface-raised)', borderRadius: 999, height: 8, overflow: 'hidden', margin: '8px auto 12px', maxWidth: 420 }}>
              <div style={{
                background: 'var(--accent)',
                height: '100%',
                width: progress.total ? `${Math.min(100, (progress.processed / progress.total) * 100)}%` : '4%',
                transition: 'width 400ms ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              {progress.found.toLocaleString()} suggestion{progress.found === 1 ? '' : 's'} found so far · You can close this modal — the run continues in the background.
            </div>
          </div>
        )}

        {phase === 'review' && result && (
          <div>
            <div style={tidyStyles.summary}>
              <div>Analysed <strong>{result.analysed.toLocaleString()}</strong> journalist{result.analysed === 1 ? '' : 's'} — Claude proposes <strong>{result.suggestions.length}</strong> change{result.suggestions.length === 1 ? '' : 's'} across <strong>{grouped.length}</strong> record{grouped.length === 1 ? '' : 's'}.</div>
              {result.capped && (
                <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 4 }}>
                  Hit the 500-journalist cap — re-run with a narrower filter to cover the rest.
                </div>
              )}
            </div>
            {!result.suggestions.length ? (
              <div style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13, textAlign: 'center' }}>
                Nothing to clean up — the records in this filter look healthy.
              </div>
            ) : (
              <div style={{ maxHeight: 460, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 0 }}>
                {grouped.map(g => (
                  <div key={g.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f1f1f1' }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>
                      {g.label}
                    </div>
                    {g.suggestions.map(({ idx, s }) => {
                      const ticked = selected.has(idx);
                      return (
                        <label key={idx} style={{ display: 'flex', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                          <input type="checkbox" checked={ticked} onChange={() => {
                            setSelected(prev => {
                              const n = new Set(prev);
                              if (n.has(idx)) n.delete(idx); else n.add(idx);
                              return n;
                            });
                          }} style={{ marginTop: 3 }} />
                          <div style={{ flex: 1 }}>
                            <div>
                              <code style={tidyStyles.fieldChip}>{s.field}</code>{' '}
                              <span style={{ color: 'var(--text-subtle)' }}>{s.before ? `"${s.before}"` : <em>empty</em>}</span>
                              {' → '}
                              <span style={{ color: 'var(--positive)', fontWeight: 700 }}>"{s.new_value}"</span>
                            </div>
                            {s.why && <div style={{ color: 'var(--text-subtle)', fontStyle: 'italic', fontSize: 11 }}>{s.why}</div>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <div style={tidyStyles.footer}>
              {!!result.suggestions.length && (
                <>
                  <button onClick={() => setSelected(new Set(result.suggestions.map((_, i) => i)))} style={tidyStyles.ghostBtn}>Tick all</button>
                  <button onClick={() => setSelected(new Set())} style={tidyStyles.ghostBtn}>Untick all</button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} of {result.suggestions.length} ticked</span>
              <button onClick={apply} disabled={!selected.size}
                style={!selected.size ? { ...tidyStyles.btn, opacity: 0.5 } : tidyStyles.btn}>
                Apply {selected.size} change{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        {phase === 'applying' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Applying…</div>
        )}

        {phase === 'done' && (
          <div>
            <div style={{ padding: 14, background: 'var(--positive-soft)', border: '1px solid #b6dcc1', borderRadius: 'var(--r-md)', color: 'var(--positive)', fontSize: 13 }}>
              ✓ Applied {appliedCount.toLocaleString()} field change{appliedCount === 1 ? '' : 's'}. The journalist audit history records what changed, by whom, and why.
            </div>
            <div style={tidyStyles.footer}>
              <div style={{ flex: 1 }} />
              <button onClick={onClose} style={tidyStyles.btn}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Build a per-contact view of a flat suggestions list. Preserves the
// original index so checkbox state stays in sync with the source array.
function groupByContact(suggestions) {
  const byId = new Map();
  suggestions.forEach((s, idx) => {
    if (!byId.has(s.id)) byId.set(s.id, { id: s.id, label: contactLabel(s), suggestions: [] });
    byId.get(s.id).suggestions.push({ idx, s });
  });
  return Array.from(byId.values());
}
function contactLabel(s) {
  // Use whichever identifying field appears first in the bundle's
  // metadata so the AM can recognise the row at a glance.
  return s.contact_email || s.contact_name || `Journalist ${s.id.slice(0, 8)}…`;
}

const tidyStyles = {
  // Overlay was rgba(0,0,0,0.5) + modal on var(--accent-soft) (yellow tint).
  // The yellow modal sat on a half-opaque black scrim against a light page,
  // and from a distance the body copy looked greyed-out and unreadable.
  // Solid white modal + a darker, blurred scrim gives proper contrast.
  overlay: { position: 'fixed', inset: 0, background: 'rgba(20,20,24,0.72)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1100, overflowY: 'auto' },
  modal: { background: '#fff', color: 'var(--text)', borderRadius: 'var(--r-md)', width: '100%', maxWidth: 760, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', border: '1px solid var(--card-border)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  eyebrow: { fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 3 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-subtle)', lineHeight: 1, padding: 4 },
  hint: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 },
  summary: { background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 14, fontSize: 13, marginTop: 12 },
  footer: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee' },
  btn: { background: 'var(--accent)', color: 'var(--text)', border: 'none', borderRadius: 'var(--r-pill)', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { background: 'var(--accent-soft)', color: 'var(--text)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)', padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  err: { padding: 10, background: 'var(--negative-soft)', border: '1px solid #f5c6cb', color: 'var(--negative)', borderRadius: 'var(--r-sm)', fontSize: 12, marginBottom: 12 },
  fieldChip: { background: 'var(--warning-soft)', padding: '1px 6px', borderRadius: 'var(--r-sm)', fontSize: 11, fontFamily: 'inherit', fontWeight: 700, color: 'var(--warning)' },
};

// Human-readable summary of a single tag-tidy operation. Rendered
// alongside the checkbox in the plan panel.
function OpSummary({ op }) {
  const chip = (txt) => <code style={{ background: 'var(--warning-soft)', padding: '1px 5px', borderRadius: 'var(--r-sm)', fontSize: 11 }}>{txt}</code>;
  if (op.type === 'rename') return <span>Rename {chip(op.from)} → {chip(op.to)}</span>;
  if (op.type === 'merge') return <span>Merge {op.from.map((t, i) => <React.Fragment key={t}>{i > 0 && ', '}{chip(t)}</React.Fragment>)} → {chip(op.into)}</span>;
  if (op.type === 'delete') return <span>Delete {chip(op.tag)} everywhere</span>;
  if (op.type === 'add_parent') return <span>Add parent {chip(op.parent)} to every journalist tagged {chip(op.child)}</span>;
  return <span>{op.type}</span>;
}


// Cost log — surfaces WHICH features are spending the credits.
// Reads /settings/usage/cost-log which aggregates api_cost_events: every
// paid API call records a row (provider, feature, $) so the AM can see
// "report_narrative cost $14 this week, ai_data_analyst_chat $8" rather
// than just a single combined total. Helps spot a runaway loop or a
// feature that's quietly eating spend.
function CostLogPanel() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/settings/usage/cost-log?days=${days}`).then(setData).catch((e) => setErr(e.message));
  }, [days]);

  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  const totalUsd = data ? data.by_feature.reduce((s, r) => s + (r.cost_usd || 0), 0) : 0;
  const dailyAvg = data && data.daily.length ? totalUsd / Math.min(days, data.daily.length) : 0;
  const burnFlag = dailyAvg > 15 ? 'red' : dailyAvg > 5 ? 'amber' : 'green';
  const flagColor = burnFlag === 'red' ? 'var(--negative)' : burnFlag === 'amber' ? 'var(--warning)' : 'var(--positive)';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <h2 className="caption">Cost log · where credits are going</h2>
          <p className="body-sm text-muted">Per-call API spend grouped by feature. Captures Claude (chat, report narratives, contact tidy, briefings) and grows as more providers are instrumented.</p>
        </div>
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {err && <div style={{ color: 'var(--negative)', fontSize: 12 }}>{err}</div>}
      {!data ? <p className="body-sm text-muted">Loading…</p> : (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
            <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Total · last {days} days</div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(totalUsd)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Daily average</div><div style={{ fontSize: 22, fontWeight: 800, color: flagColor }}>{fmt(dailyAvg)}<span style={{ fontSize: 11, marginLeft: 8, color: flagColor }}>● {burnFlag}</span></div></div>
          </div>

          <h3 className="h3 mb-2">By feature</h3>
          {data.by_feature.length === 0 ? (
            <p className="body-sm text-muted">No cost events recorded yet in this window. Once features run (a report, a chat, a tidy sweep), they'll show up here with their spend.</p>
          ) : (
            <table className="table" style={{ marginBottom: 14 }}>
              <thead><tr><th>Provider</th><th>Feature</th><th style={{ textAlign: 'right' }}>Calls</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
              <tbody>
                {data.by_feature.map((r) => (
                  <tr key={`${r.provider}:${r.feature}`}>
                    <td style={{ color: 'var(--text-muted)' }}>{r.provider}</td>
                    <td style={{ fontWeight: 600 }}>{r.feature}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{Number(r.calls).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.recent.length > 0 && (
            <>
              <h3 className="h3 mb-2">Most recent calls</h3>
              <table className="table">
                <thead><tr><th>When</th><th>Feature</th><th>Model</th><th style={{ textAlign: 'right' }}>Tokens (in / out)</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
                <tbody>
                  {data.recent.slice(0, 30).map((r) => (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(r.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ fontWeight: 600 }}>{r.feature}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.meta?.model || r.provider}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{Number(r.meta?.input_tokens || 0).toLocaleString()} / {Number(r.meta?.output_tokens || 0).toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
