import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import ImportWizard from '../components/ImportWizard';
import EditContactModal from '../components/EditContactModal';
import ManageUsersPage from './ManageUsersPage';
import IntegrationsPage from './IntegrationsPage';

const KEY_GROUPS = [
  {
    title: 'Claude AI',
    category: 'AI & Email',
    hint: 'Used for generating executive summaries, social posts, ad creative and report narratives. The Admin key is optional — if set, the Costs panel pulls monthly spend from the Anthropic usage API; without it, Anthropic spend is tracked via your dashboard.',
    keys: [
      { key: 'CLAUDE_API_KEY', label: 'Claude API Key', placeholder: 'sk-ant-…', type: 'password' },
      { key: 'ANTHROPIC_ADMIN_KEY', label: 'Anthropic Admin Key (optional — for cost tracking)', placeholder: 'sk-ant-admin-…', type: 'password' },
    ],
  },
  {
    title: 'Replicate (Flux 1.1 Pro)',
    category: 'AI & Email',
    hint: 'Used by the Social tab to generate post images. Pay-per-call, around $0.04 per image. Get a token at replicate.com/account/api-tokens.',
    keys: [
      { key: 'REPLICATE_API_TOKEN', label: 'Replicate API Token', placeholder: 'r8_…', type: 'password' },
    ],
  },
  {
    title: 'Ideogram',
    category: 'AI & Email',
    hint: 'Alternative image generator used by the Social tab — best when the post needs clean legible on-image text. Around $0.08 per image. Get a key at ideogram.ai/manage-api.',
    keys: [
      { key: 'IDEOGRAM_API_KEY', label: 'Ideogram API Key', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Adobe (Firefly + Photoshop)',
    category: 'AI & Email',
    hint: 'Third image option, commercially-safe training data — good for regulated clients. Photoshop generative resize fans one image out to every aspect ratio. Set up a Firefly Services project at developer.adobe.com → Console.',
    keys: [
      { key: 'ADOBE_CLIENT_ID', label: 'Adobe Client ID', placeholder: '…', type: 'text' },
      { key: 'ADOBE_CLIENT_SECRET', label: 'Adobe Client Secret', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Arcads (UGC video)',
    category: 'AI & Email',
    hint: 'UGC-style talking-head video from a script. ~$2 per video. Used per-post on the Social tab — the storyboard\'s voiceover lines become the script by default.',
    keys: [
      { key: 'ARCADS_API_KEY', label: 'Arcads API Key', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'ElevenLabs (voiceover)',
    category: 'AI & Email',
    hint: 'Text-to-speech voiceovers for storyboards. Pay-per-character (~$0.30/min at creator tier).',
    keys: [
      { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Apify (TikTok trending sounds)',
    category: 'AI & Email',
    hint: 'Powers the "Refresh trending sounds" action on the Social tab. ~$0.25 per scrape; cached for 7 days so weekly refreshes are plenty.',
    keys: [
      { key: 'APIFY_API_TOKEN', label: 'Apify API Token', placeholder: 'apify_api_…', type: 'password' },
    ],
  },
  {
    title: 'Email Provider',
    category: 'AI & Email',
    hint: 'Choose whether to send reports via Gmail or Amazon SES. SES is recommended for production.',
    keys: [
      { key: 'EMAIL_PROVIDER', label: 'Provider', placeholder: 'gmail or ses', type: 'text' },
    ],
  },
  {
    title: 'Gmail SMTP',
    category: 'AI & Email',
    hint: 'Used when EMAIL_PROVIDER is set to "gmail". Requires a Gmail App Password — Google Account → Security → 2-Step Verification → App passwords.',
    keys: [
      { key: 'GMAIL_USER', label: 'Gmail Address', placeholder: 'octobercommsreports@gmail.com', type: 'text' },
      { key: 'GMAIL_APP_PASSWORD', label: 'Gmail App Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password' },
    ],
  },
  {
    title: 'Amazon SES',
    category: 'AI & Email',
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
    title: 'October Outreach',
    category: 'Outreach',
    hint: 'Contact-finding APIs for the Outreach module. Hunter and Serper each need one key. Icypeas needs all three (API Key, API Secret and User ID) — copy them from icypeas.com → Settings → API.',
    keys: [
      { key: 'HUNTER_API_KEY', label: 'Hunter API Key', placeholder: 'Hunter.io API key', type: 'password' },
      { key: 'ICYPEAS_API_KEY', label: 'Icypeas API Key', placeholder: 'Icypeas API key', type: 'password' },
      { key: 'ICYPEAS_API_SECRET', label: 'Icypeas API Secret', placeholder: 'Icypeas API secret', type: 'password' },
      { key: 'ICYPEAS_USER_ID', label: 'Icypeas User ID', placeholder: 'Icypeas account user ID', type: 'text' },
      { key: 'SERPER_API_KEY', label: 'Serper API Key', placeholder: 'Serper.dev API key', type: 'password' },
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
  { title: 'AI & Email', description: 'Claude for report generation; email transport for reports and outreach.', hasTestEmail: true },
  { title: 'Ad Platforms', description: 'Google Ads, Meta Ads and Instagram Insights.' },
  { title: 'Ecommerce & Inventory', description: 'Shopify, Amazon Seller and Zoho Inventory.' },
  { title: 'SEO', description: 'Keyword rank tracking, backlinks and search volume.' },
  { title: 'Outreach', description: 'Contact-finding, AI-drafted emails and reply tracking for cold outreach.' },
  { title: 'Other', description: 'Webhooks, stealth scraping and platform alerts.' },
];

export default function SettingsPage() {
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
  const [openCategories, setOpenCategories] = useState({});
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'general');

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

  return (
    <div>
      <div className="kicker"><span className="pip" />Admin</div>
      <header className="hero">
        <h1 className="display">Settings</h1>
      </header>

      <div className="tabs">
        {[
          { key: 'general', label: 'General' },
          { key: 'integrations', label: 'Integrations' },
          { key: 'contacts', label: 'Contacts' },
          { key: 'publications', label: 'Publications' },
          { key: 'tags', label: 'Tags' },
          { key: 'users', label: 'Users & access' },
        ].map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`tab ${tab === t.key ? "active" : ""}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'integrations' && <IntegrationsPage embedded />}
      {tab === 'contacts' && <ContactsLibrary />}
      {tab === 'publications' && <PublicationsPanel />}
      {tab === 'tags' && <TagsManager />}
      {tab === 'users' && <ManageUsersPage embedded />}
      {tab !== 'contacts' && tab !== 'publications' && tab !== 'users' && tab !== 'tags' && tab !== 'integrations' && (<>
      <CostsPanel />
      <KeywordSpendPanel />
      <PrAddonPanel />

      <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '0 0 12px' }}>
        Tap a category to expand its integrations. Each block has its own Save button.
      </p>

      {/* Categorised integration cards — collapsible, multi-column grid */}
      <form onSubmit={e => e.preventDefault()} autoComplete="off">
        {/* Dummy fields to prevent browser autofill from hitting real inputs */}
        <input type="text" name="username" style={{ display: 'none' }} autoComplete="username" readOnly />
        <input type="password" name="password" style={{ display: 'none' }} autoComplete="current-password" readOnly />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
          {CATEGORIES.map(cat => {
            const groupsInCat = KEY_GROUPS.filter(g => g.category === cat.title);
            const open = !!openCategories[cat.title];
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
                    <span className="chip chip-accent">{configuredCount} / {groupsInCat.length}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                  </div>
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
                    {groupsInCat.map(group => (
                      <div key={group.title} style={{ borderTop: "2px solid var(--accent-soft)", paddingTop: 14 }}>
                        <div className="h3 mb-2">{group.title}</div>
                        {group.hint && <p className="body-sm text-muted">{group.hint}</p>}
                        {group.note && (
                          <div className="callout callout-warning"><strong>Developer app required.</strong> {group.note}</div>
                        )}
                        {group.scopes && <ScopesBlock scopes={group.scopes} />}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: group.hint || group.note ? 12 : 0 }}>
                          {group.keys.map(({ key, label, placeholder, type }) => (
                            <div key={key} className="field">
                              <label className="field-label">{label}</label>
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
                            </div>
                          ))}
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
                    ))}

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
                          <button type="button" onClick={handleTestEmail} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12 }} disabled={sendingTest}>
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

// Publications — the shared outlet list behind press coverage. Today this is the
// de-duplication tool (Dezeen / Dezeen.com), moved here from the old top-level
// Press page so all contact/publication management lives in Settings.
function PublicationsPanel() {
  const [clusters, setClusters] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [ai, setAi] = useState(false);
  const [chosen, setChosen] = useState({});
  const [done, setDone] = useState({});
  const [err, setErr] = useState(null);
  const [outlets, setOutlets] = useState(null);
  const [outletSearch, setOutletSearch] = useState('');

  // Reload on every search-term change. Server-side ILIKE means the user
  // finds zero-coverage outlets (Vogue.nl etc.) that fall outside the
  // top-2000-by-coverage window the unfiltered list returns. Debounce so
  // we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const path = outletSearch.trim() ? `/pr/outlets?q=${encodeURIComponent(outletSearch.trim())}` : '/pr/outlets';
      api.get(path).then((r) => setOutlets(r.items || [])).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [outletSearch]);
  async function setTier(id, tier) {
    setOutlets((list) => list.map((o) => (o.id === id ? { ...o, tier } : o)));
    try { await api.patch(`/pr/outlets/${id}`, { tier }); } catch (e) { setErr(e.message); }
  }

  function badge(method, confidence) {
    if (method === 'exact') return <span className="chip" style={{ background: '#dcfce7', color: '#166534' }}>Exact · safe</span>;
    if (method === 'ai') return <span className="chip chip-accent">AI confirmed · {Math.round(confidence * 100)}%</span>;
    return <span className="chip">Possible · review</span>;
  }
  async function scan() {
    setScanning(true); setClusters(null); setDone({}); setErr(null);
    try {
      const r = await api.get('/pr/dedup/outlets/scan');
      setClusters(r.clusters || []);
      setAi(!!r.ai);
      const pick = {};
      (r.clusters || []).forEach((c, i) => {
        const m = c.members.find((x) => x.name === c.suggested) || c.members[0];
        if (m) pick[i] = m.id;
      });
      setChosen(pick);
    } catch (e) { setErr(e.message); }
    finally { setScanning(false); }
  }
  async function merge(ci) {
    const cluster = clusters[ci];
    const canonId = chosen[ci];
    if (!canonId) { setErr('Pick which publication to keep.'); return; }
    const memberIds = cluster.members.map((m) => m.id).filter((x) => x !== canonId);
    try {
      const r = await api.post('/pr/dedup/outlets/merge', { canonical_id: canonId, member_ids: memberIds });
      setDone((d) => ({ ...d, [ci]: r.merged }));
    } catch (e) { setErr(e.message); }
  }
  async function mergeAllExact() {
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].method === 'exact' && !done[i]) await merge(i);
    }
  }

  const TIERS = [['', '—'], ['1', 'T1 · premium'], ['2', 'T2 · broad'], ['3', 'T3 · blog']];
  const visibleOutlets = (outlets || []).filter((o) => !outletSearch.trim() || (o.name || '').toLowerCase().includes(outletSearch.trim().toLowerCase()));

  return (
    <>
    <Card style={{ marginBottom: 16 }}>
      <CardTitle>Publications</CardTitle>
      <p className="body-sm text-muted">
        The outlets behind your coverage, shared across all clients. Set a <strong>tier</strong> — T1 premium
        titles, T2 broad, T3 blogs/microbloggers — to prioritise targeting and reporting. (Tier is the
        publication's; a contact inherits it.)
      </p>
      <input className="input" placeholder="Search publications…" value={outletSearch} onChange={(e) => setOutletSearch(e.target.value)} style={{ maxWidth: 320, margin: '10px 0' }} />
      {!outlets ? <p className="body-sm text-muted">Loading…</p> : (
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="table">
            <thead><tr><th>Publication</th><th>Coverage</th><th style={{ width: 150 }}>Tier</th></tr></thead>
            <tbody>
              {visibleOutlets.slice(0, 500).map((o) => (
                <tr key={o.id}>
                  <td><a href={`/media/outlet/${o.id}`}>{o.name}</a></td>
                  <td>{o.coverage}</td>
                  <td>
                    <select className="input" value={o.tier || ''} onChange={(e) => setTier(o.id, e.target.value)}>
                      {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {!visibleOutlets.length && <tr><td colSpan={3} style={{ color: 'var(--text-subtle)', padding: 20 }}>No publications{outletSearch ? ' match that search' : ' yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <CardTitle>Merge duplicates</CardTitle>
          <p className="body-sm text-muted">
            Scanning finds duplicates (e.g. <em>Dezeen</em> / <em>Dezeen.com</em>); exact matches are safe to
            merge, fuzzy ones are confirmed by Claude. Merging keeps one record and repoints all coverage to it.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" disabled={scanning} onClick={scan}>{scanning ? 'Scanning…' : '🔍 Find duplicates'}</button>
      </div>
      {err && <div style={{ color: 'var(--negative)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {clusters && clusters.length > 0 && (
        <div style={{ margin: '14px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!ai && <span className="chip">Claude not available — fuzzy matches are heuristic; review carefully</span>}
          {clusters.some((c) => c.method === 'exact') && <button className="btn btn-secondary btn-sm" onClick={mergeAllExact}>Merge all exact matches</button>}
        </div>
      )}
      {clusters && clusters.length === 0 && (
        <p style={{ color: 'var(--text-subtle)', marginTop: 14 }}>No duplicates found — your publications look clean.</p>
      )}
      {clusters && clusters.map((c, ci) => (
        <div key={ci} className="card" style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>{badge(c.method, c.confidence)}</div>
          {done[ci] != null ? (
            <p style={{ color: 'var(--text-subtle)' }}>✓ Merged {done[ci]} duplicate(s).</p>
          ) : (
            <>
              <table className="table" style={{ marginBottom: 10 }}>
                <thead><tr><th style={{ width: 70 }}>Keep</th><th>Publication</th></tr></thead>
                <tbody>
                  {c.members.map((m) => (
                    <tr key={m.id}>
                      <td><input type="radio" name={`canon-${ci}`} checked={chosen[ci] === m.id} onChange={() => setChosen((s) => ({ ...s, [ci]: m.id }))} /></td>
                      <td>{m.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-primary btn-sm" onClick={() => merge(ci)}>Merge into selected</button>
            </>
          )}
        </div>
      ))}
    </Card>
    </>
  );
}

// PR Gmail add-on — surfaces the API base URL + shared key to paste into the
// Google Apps Script add-on's config, with a Regenerate (rotate) button.
function PrAddonPanel() {
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
        <button onClick={regenerate} disabled={busy} className="btn btn-primary" style={{ padding: '6px 14px' }}>{busy ? 'Generating…' : (key ? 'Regenerate' : 'Generate key')}</button>
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

  async function load() {
    try { setRows(await api.get('/settings/usage')); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setRefreshing(true);
    setErr(null);
    try {
      const { snapshots } = await api.post('/settings/usage/refresh', {});
      setRows(snapshots);
    } catch (e) { setErr(e.message); }
    finally { setRefreshing(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <h2 className="caption">Costs &amp; usage</h2>
          <p className="body-sm text-muted">Latest balance / usage reading from each pay-per-use provider. Auto-refreshes every night at 02:00.</p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="btn btn-primary" style={{ padding: '6px 14px' }}>
          {refreshing ? 'Polling…' : 'Refresh now'}
        </button>
      </div>
      {err && <div style={{ color: 'var(--negative)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {!rows && <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 10 }}>Loading…</div>}
      {rows && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {rows.map(r => <ProviderCard key={r.name} entry={r} />)}
        </div>
      )}
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
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
            {fmtCurrency(s.balance_remaining, s.currency)}
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 400, marginLeft: 4 }}>remaining</span>
          </div>
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
  // Same status-coloured-bento pattern as the Connectors tab — the
  // whole tile turns green when balance / usage came back cleanly,
  // red on error, amber on missing creds, default accent for "no
  // data yet". The AM can spot a broken provider from across the
  // page, not just by reading the inline label.
  const statusClass =
    !s ? '' :
    s.status === 'error' ? 'danger' :
    s.status === 'no_credentials' ? 'warning' :
    'success';
  return (
    <div className={`card ${statusClass}`} style={{ padding: 12 }}>
      <div className="caption mb-2">{entry.label}</div>
      {body}
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
function ContactsLibrary() {
  const [rows, setRows] = useState(null);
  const [clients, setClients] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all'); // all | press | prospect
  const [archiveReview, setArchiveReview] = useState([]);

  function loadArchiveReview() { api.get('/pr/archive-review').then((r) => setArchiveReview(r.items || [])).catch(() => {}); }
  async function resolveArchive(cid, action) {
    try { await api.post(`/pr/contacts/${cid}/${action}`, {}); setArchiveReview((list) => list.filter((c) => c.id !== cid)); }
    catch (e) { setErr(e.message); }
  }

  const [nudges, setNudges] = useState([]);
  const [nudgeDraft, setNudgeDraft] = useState(null); // { id, name, to, subject, body }
  const [nudgeBusy, setNudgeBusy] = useState(false);
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
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [openContact, setOpenContact] = useState(null);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
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
    if (kindFilter === 'press') p.set('kind', 'media,industry');
    else if (kindFilter === 'prospect') p.set('kind', 'prospect');
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
    const o = {};
    if (search.trim()) o.search = search.trim();
    if (kindFilter === 'press') o.kind = ['media', 'industry'];
    else if (kindFilter === 'prospect') o.kind = ['prospect'];
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
    loadArchiveReview();
    loadNudges();
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
  }, [search, activeTags, kindFilter]);

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
    if (!confirm(`Delete all ${total.toLocaleString()} contacts ${filterDesc.trim()} from the library? This removes them from every client they were attached to and CANNOT be undone.`)) return;
    if (total > 100) {
      const typed = prompt(`This will delete ${total.toLocaleString()} contacts. Type DELETE to confirm.`);
      if (typed !== 'DELETE') return;
    }
    try {
      const res = await api.post('/outreach/contacts/library/delete-by-filter', {
        ...filterBody(),
        expected_count: total,
      });
      setInfo(`Deleted ${res.deleted.toLocaleString()} contact${res.deleted === 1 ? '' : 's'}.`);
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
    if (!confirm(`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'} from the library entirely? This also removes them from every client they were attached to.`)) return;
    try {
      await api.post('/outreach/contacts/bulk-delete', { ids: Array.from(selected) });
      await reload();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function destroyOne(contactId) {
    if (!confirm('Delete this contact from the library entirely? This removes them from every client they were attached to.')) return;
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
      setInfo(`Tagged ${selected.size} contact${selected.size === 1 ? '' : 's'}.`);
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
        allowClients
        onImported={async () => {
          await reload();
        }}
      />
      {openContact && (
        <EditContactModal
          contact={openContact}
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
      <ContactDedupModal
        open={dedupOpen}
        onClose={() => setDedupOpen(false)}
        onMerged={async () => { await reload(); }}
      />
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <CardTitle>Contacts</CardTitle>
            <p className="body-sm text-muted">
              One workspace-wide list of contacts. Each contact can be attached to as many clients
              as you like — a journalist who unsubscribes from one client's emails stays subscribed
              to the others.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setTidyOpen(true)} className="btn btn-secondary btn-sm"
              title="Ask Claude to spot fixes on the contacts matching the current filter">
              ✦ Tidy with Claude
            </button>
            <button onClick={() => setDedupOpen(true)} className="btn btn-secondary btn-sm"
              title="Find duplicate contacts (same email, or same name at the same outlet) and merge them into one record.">
              🔍 Find duplicates
            </button>
            <button
              onClick={async () => {
                if (!confirm('Strip leftover Notion-URL fragments from every contact + outlet name? Safe to run multiple times.')) return;
                try {
                  const r = await api.post('/pr/repair-imported-names', {});
                  setInfo(`Repaired ${r.contacts} contact${r.contacts === 1 ? '' : 's'} and ${r.outlets} outlet${r.outlets === 1 ? '' : 's'}.`);
                  load();
                } catch (e) { setErr(e.message); }
              }}
              className="btn btn-secondary btn-sm"
              title="Clean up journalists and outlets whose names still contain raw (https://app.notion.com/…) trails from earlier Notion-export imports.">
              ✦ Repair imported names
            </button>
            <button onClick={exportCsv} disabled={!total} className="btn btn-secondary btn-sm"
              title={total ? `Download ${total.toLocaleString()} contact${total === 1 ? '' : 's'} matching the current filter` : 'Nothing to export'}>
              ↓ Export CSV
            </button>
            <button onClick={() => setImportOpen(true)} className="btn btn-primary btn-sm">↑ Import CSV</button>
          </div>
        </div>

        {archiveReview.length > 0 && (
          <div className="card" style={{ marginTop: 12, borderLeft: '3px solid var(--accent)' }}>
            <div className="h3 mb-2">📉 {archiveReview.length} contact{archiveReview.length === 1 ? '' : 's'} look inactive — archive?</div>
            <p className="body-sm text-muted" style={{ marginBottom: 10 }}>No coverage in 12 months and no recent byline found online. People move on — archive the ones who've left (reversible), keep the rest.</p>
            <div style={{ maxHeight: 220, overflow: 'auto' }}>
              {archiveReview.slice(0, 50).map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--card-border, #eee)' }}>
                  <div style={{ fontSize: 13 }}><strong>{c.name || '—'}</strong>{c.outlet ? ` · ${c.outlet}` : ''}</div>
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => resolveArchive(c.id, 'archive')}>Archive</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => resolveArchive(c.id, 'unarchive')}>Keep</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nudges.length > 0 && (
          <div className="card" style={{ marginTop: 12, borderLeft: '3px solid var(--accent)' }}>
            <div className="h3 mb-2">💬 Stay in touch — {nudges.length} fresh article{nudges.length === 1 ? '' : 's'} from your key journalists</div>
            <p className="body-sm text-muted" style={{ marginBottom: 10 }}>Read it, then send a genuine note. Claude drafts one specific to the article — you approve and send. (Tier-1 / strong-relationship journalists only.)</p>
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
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
                            <button className="btn btn-primary btn-sm" disabled={nudgeBusy || !nudgeDraft.to || !nudgeDraft.subject || !nudgeDraft.body} onClick={sendNudge}>{nudgeBusy ? 'Sending…' : 'Send'}</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setNudgeDraft(null)}>Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {[['all', 'All'], ['press', 'Press'], ['prospect', 'Prospects']].map(([v, l]) => (
            <button key={v} onClick={() => setKindFilter(v)}
              className={'btn btn-sm ' + (kindFilter === v ? 'btn-primary' : 'btn-secondary')}>{l}</button>
          ))}
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
              ? 'No contacts match this filter.'
              : `No contacts yet. Use ↑ Import CSV above, or add some from a client's Contacts tab — they'll show up here automatically.`}
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
                  Add tags to the {selected.size} selected contact{selected.size === 1 ? '' : 's'}:
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
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Attach the {selected.size} selected contact{selected.size === 1 ? '' : 's'} to:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {clients.map(c => (
                    <button key={c.id} onClick={() => attachTo(c.id)} className="btn btn-secondary btn-sm">
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                  </th>
                  <th style={{ textAlign: 'left' }}>Name</th>
                  <th style={{ textAlign: 'left' }}>Email</th>
                  <th style={{ textAlign: 'left' }}>{kindFilter === 'press' ? 'Publication' : kindFilter === 'prospect' ? 'Company' : 'Publication / company'}</th>
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
                        <strong style={{ color: 'var(--text)' }}>{r.name || '(unnamed)'}</strong>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>
                        <span style={{ color: 'var(--text-muted)' }}>{r.email || '—'}</span>
                      </td>
                      <td  onClick={() => setOpenContact(r)}>{r.company || '—'}</td>
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
      setInfo(`Renamed "${tag}" → "${r.to}" on ${r.updated.toLocaleString()} contact${r.updated === 1 ? '' : 's'}.`);
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
    if (!confirm(`Apply ${ops.length} cleanup operation${ops.length === 1 ? '' : 's'}? This rewrites tags on contacts and can't be undone in one click.`)) return;
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
    if (!confirm(`Remove the tag "${tag}" from ${count.toLocaleString()} contact${count === 1 ? '' : 's'}? The contacts themselves stay; only the tag is stripped.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/outreach/tags/delete', { tag });
      setInfo(`Removed "${tag}" from ${r.updated.toLocaleString()} contact${r.updated === 1 ? '' : 's'}.`);
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
              Every tag in the workspace. Rename merges contacts already on the new name; delete strips
              the tag from every contact (the contacts themselves stay). Use this to clean up junk from
              old CSV imports.
            </p>
          </div>
          <button onClick={tidyWithClaude} disabled={analyzing || applying} className="btn btn-secondary btn-sm"
            title="Send the tag list to Claude and get cleanup suggestions">
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
              Untick anything you disagree with, then apply. Each operation rewrites tags on contacts and can't be undone in one click.
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
                  <th style={{ width: 120, textAlign: 'right'  }}>Contacts</th>
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
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Contact data cleanup</h2>
          </div>
          <button onClick={onClose} style={tidyStyles.closeBtn}>×</button>
        </div>

        {err && <div style={tidyStyles.err}>{err}</div>}

        {phase === 'idle' && (
          <div>
            <p style={tidyStyles.hint}>
              Claude will look at the contacts matching your current filter and propose fixes:
              capitalisation, missing company derived from email domain, lowercase emails, URL
              schemes, name splits, and similar. You review each suggestion before anything
              changes — every applied change writes an audit row so you can see what happened
              later.
            </p>
            <div style={tidyStyles.summary}>
              <div><strong>{(totalInFilter || 0).toLocaleString()}</strong> contacts will be analysed</div>
              <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 4 }}>
                Runs in the background — you can close this modal and come back. Roughly ~$1 per 500 contacts in Claude API spend.
              </div>
            </div>
            <div style={tidyStyles.footer}>
              <button onClick={onClose} style={tidyStyles.ghostBtn}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button onClick={runAnalyse} style={tidyStyles.btn}>Start analysis</button>
            </div>
          </div>
        )}

        {phase === 'analysing' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Claude is reading the contacts in batches of 40 — {progress.processed.toLocaleString()} of {(progress.total || totalInFilter || 0).toLocaleString()} done.
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
              <div>Analysed <strong>{result.analysed.toLocaleString()}</strong> contact{result.analysed === 1 ? '' : 's'} — Claude proposes <strong>{result.suggestions.length}</strong> change{result.suggestions.length === 1 ? '' : 's'} across <strong>{grouped.length}</strong> record{grouped.length === 1 ? '' : 's'}.</div>
              {result.capped && (
                <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 4 }}>
                  Hit the 500-contact cap — re-run with a narrower filter to cover the rest.
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
              ✓ Applied {appliedCount.toLocaleString()} field change{appliedCount === 1 ? '' : 's'}. The contact audit history records what changed, by whom, and why.
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

// Find-duplicate-contacts modal. Mirrors the outlet dedup UX in the
// Publications panel — scan groups contacts that are almost certainly the
// same person, AM picks a canonical per cluster, merge repoints every
// reference to the canonical and soft-deletes the losers.
function ContactDedupModal({ open, onClose, onMerged }) {
  const [phase, setPhase] = useState('idle'); // idle | scanning | review | merging
  const [clusters, setClusters] = useState([]);
  const [chosen, setChosen] = useState({});
  const [done, setDone] = useState({});
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle'); setClusters([]); setChosen({}); setDone({}); setErr(null);
    }
  }, [open]);

  async function scan() {
    setPhase('scanning'); setErr(null); setDone({});
    try {
      const r = await api.get('/outreach/contacts/dedup/scan');
      setClusters(r.clusters || []);
      // Pre-select the server's suggested canonical per cluster.
      const pick = {};
      (r.clusters || []).forEach((c, i) => { if (r.suggested?.[i]) pick[i] = r.suggested[i]; });
      setChosen(pick);
      setPhase('review');
    } catch (e) { setErr(e.message); setPhase('idle'); }
  }

  async function mergeOne(ci) {
    const cluster = clusters[ci];
    const canon = chosen[ci];
    if (!canon) { setErr('Pick which contact to keep.'); return; }
    if (!confirm(`Merge ${cluster.members.length - 1} duplicate${cluster.members.length === 2 ? '' : 's'} into the selected contact? Cannot be undone.`)) return;
    const memberIds = cluster.members.map((m) => m.id).filter((id) => id !== canon);
    try {
      const r = await api.post('/outreach/contacts/dedup/merge', { canonical_id: canon, member_ids: memberIds });
      setDone((d) => ({ ...d, [ci]: r.merged }));
      if (onMerged) onMerged();
    } catch (e) { setErr(e.message); }
  }

  async function mergeAllExactEmail() {
    if (!confirm('Auto-merge every "same email" cluster using the suggested canonical? Cannot be undone.')) return;
    setPhase('merging'); setErr(null);
    try {
      let total = 0;
      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].method !== 'exact_email' || done[i]) continue;
        const canon = chosen[i]; if (!canon) continue;
        const ids = clusters[i].members.map((m) => m.id).filter((id) => id !== canon);
        const r = await api.post('/outreach/contacts/dedup/merge', { canonical_id: canon, member_ids: ids });
        total += r.merged || 0;
        setDone((d) => ({ ...d, [i]: r.merged }));
      }
      if (onMerged) onMerged();
      setErr(null);
      // Re-scan so cleared clusters fall out and any newly-revealed groups appear.
      await scan();
      // scan flips back to 'review'; if there's nothing left it'll show that too.
      // Tell the AM what just happened.
      if (total) alert(`Merged ${total} duplicate contact${total === 1 ? '' : 's'}.`);
    } catch (e) { setErr(e.message); setPhase('review'); }
  }

  if (!open) return null;

  const remaining = clusters.filter((_, i) => !done[i]);
  const exactCount = clusters.filter((c, i) => c.method === 'exact_email' && !done[i]).length;

  function badge(method) {
    if (method === 'exact_email') return <span className="chip" style={{ background: '#dcfce7', color: '#166534' }}>Same email · safe</span>;
    if (method === 'name_and_domain') return <span className="chip" style={{ background: '#fff1d6', color: '#8c5a00' }}>Same name + email domain · review</span>;
    return <span className="chip" style={{ background: '#fff1d6', color: '#8c5a00' }}>Same name + outlet · review</span>;
  }

  return (
    <div style={tidyStyles.overlay} onClick={onClose}>
      <div style={{ ...tidyStyles.modal, maxWidth: 880 }} onClick={(e) => e.stopPropagation()}>
        <div style={tidyStyles.header}>
          <div>
            <div style={tidyStyles.eyebrow}>Find duplicates</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Duplicate contacts</h2>
          </div>
          <button onClick={onClose} style={tidyStyles.closeBtn}>×</button>
        </div>

        {err && <div style={tidyStyles.err}>{err}</div>}

        {phase === 'idle' && (
          <div>
            <p style={tidyStyles.hint}>
              Scans every contact in your workspace and groups likely duplicates by three signals: <strong>same email</strong> (almost certainly the same person), <strong>same full name at the same outlet</strong>, or <strong>same full name and email domain</strong> when the outlet isn't set. Single-first-name matches are skipped — three different "Simons" aren't the same person. Merging keeps one record and repoints every coverage entry, client membership, audit row and tag to it; the losers are soft-deleted, not destroyed, so nothing in your history disappears.
            </p>
            <div style={tidyStyles.footer}>
              <button onClick={onClose} style={tidyStyles.ghostBtn}>Cancel</button>
              <div style={{ flex: 1 }} />
              <button onClick={scan} style={tidyStyles.btn}>Start scan</button>
            </div>
          </div>
        )}

        {phase === 'scanning' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Scanning the contact library…</div>
        )}

        {phase === 'merging' && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Merging…</div>
        )}

        {phase === 'review' && (
          <div>
            {!clusters.length ? (
              <div style={{ padding: 24, background: 'var(--positive-soft)', border: '1px solid #b6dcc1', borderRadius: 'var(--r-md)', color: 'var(--positive)', fontSize: 13 }}>
                ✓ No duplicates found. Your contact library is already deduped.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {remaining.length} cluster{remaining.length === 1 ? '' : 's'} found
                    {exactCount ? ` · ${exactCount} same-email (safe to auto-merge)` : ''}
                  </span>
                  <div style={{ flex: 1 }} />
                  {exactCount > 0 && (
                    <button onClick={mergeAllExactEmail} style={tidyStyles.btn}>Merge all same-email clusters</button>
                  )}
                </div>
                <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {clusters.map((c, i) => done[i] ? null : (
                    <div key={i} style={{ border: '1px solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                        {badge(c.method)}
                        <button onClick={() => mergeOne(i)} className="btn btn-secondary btn-sm">Merge {c.members.length - 1} into selected →</button>
                      </div>
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase' }}>
                            <th style={{ textAlign: 'left', width: 28 }}>Keep</th>
                            <th style={{ textAlign: 'left' }}>Name</th>
                            <th style={{ textAlign: 'left' }}>Email</th>
                            <th style={{ textAlign: 'left' }}>Outlet</th>
                            <th style={{ textAlign: 'right' }}>Coverage</th>
                            <th style={{ textAlign: 'right' }}>Clients</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.members.map((m) => (
                            <tr key={m.id} style={{ borderTop: '1px solid var(--card-border)' }}>
                              <td><input type="radio" name={`dedup_${i}`} checked={chosen[i] === m.id} onChange={() => setChosen((s) => ({ ...s, [i]: m.id }))} /></td>
                              <td style={{ padding: '6px 4px', fontWeight: 600 }}>{m.name || '—'}</td>
                              <td style={{ padding: '6px 4px', color: 'var(--text-muted)' }}>{m.email || '—'}</td>
                              <td style={{ padding: '6px 4px', color: 'var(--text-muted)' }}>{m.outlet || '—'}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>{m.coverage}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>{m.clients}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={tidyStyles.footer}>
              <button onClick={scan} style={tidyStyles.ghostBtn}>Re-scan</button>
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
  return s.contact_email || s.contact_name || `Contact ${s.id.slice(0, 8)}…`;
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
  if (op.type === 'add_parent') return <span>Add parent {chip(op.parent)} to every contact tagged {chip(op.child)}</span>;
  return <span>{op.type}</span>;
}

