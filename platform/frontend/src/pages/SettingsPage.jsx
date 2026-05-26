import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const KEY_GROUPS = [
  {
    title: 'Claude AI',
    category: 'AI & Email',
    hint: 'Used for generating executive summaries and recommendations in reports.',
    keys: [
      { key: 'CLAUDE_API_KEY', label: 'Claude API Key', placeholder: 'sk-ant-…', type: 'password' },
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
    keys: [
      { key: 'META_APP_ID', label: 'App ID', placeholder: '1234567890', type: 'text' },
      { key: 'META_APP_SECRET', label: 'App Secret', placeholder: '…', type: 'password' },
      { key: 'META_REDIRECT_URI', label: 'Redirect URI (must match Meta app config)', placeholder: 'https://your-platform.com/auth/meta/callback', type: 'text' },
    ],
  },
  {
    title: 'Shopify',
    category: 'Ecommerce & Inventory',
    hint: 'Required for Shopify connectors. Create a custom app in the Shopify Partners dashboard (partners.shopify.com → Apps → Create app → Public app). Set the redirect URL to your platform URL + /auth/shopify/callback. Paste the API key and secret below.',
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
    title: 'Alerts',
    category: 'Other',
    hint: 'Email address for platform alerts — connector failures, token expiry, and daily health check summaries.',
    keys: [
      { key: 'ALERT_EMAIL', label: 'Alert Email', placeholder: 'you@octobercomms.com', type: 'text' },
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
  { title: 'Other', description: 'Webhooks and platform alerts.' },
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
  const [account, setAccount] = useState({ username: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountMsg, setAccountMsg] = useState('');
  const [testingDfs, setTestingDfs] = useState(false);
  const [dfsTestMsg, setDfsTestMsg] = useState(null);
  const [openCategories, setOpenCategories] = useState({});

  useEffect(() => {
    api.get('/settings/platform-keys').then(data => setValues(data));
    api.get('/settings/account').then(data => setAccount(prev => ({ ...prev, username: data.username || '' }))).catch(() => {});
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
      for (const k of group.keys) {
        const v = values[k.key];
        if (v && v !== '••••••••') body[k.key] = v;
      }
      if (Object.keys(body).length === 0) {
        setSectionResult({ title: group.title, ok: false, message: 'Enter a value first' });
        return;
      }
      await api.post('/settings/platform-keys', body);
      const fresh = await api.get('/settings/platform-keys');
      setValues(fresh);
      setVisibleKeys({});
      setSectionResult({ title: group.title, ok: true, message: 'Saved' });
      setTimeout(() => setSectionResult(r => (r && r.title === group.title ? null : r)), 4000);
    } catch (err) {
      setSectionResult({ title: group.title, ok: false, message: err.message });
    } finally {
      setSavingSection(null);
    }
  }

  async function handleSaveAccount(e) {
    e.preventDefault();
    if (account.newPassword && account.newPassword !== account.confirmPassword) {
      setAccountMsg('New passwords do not match.');
      return;
    }
    setSavingAccount(true);
    setAccountMsg('');
    try {
      await api.post('/settings/account', {
        username: account.username,
        currentPassword: account.currentPassword,
        newPassword: account.newPassword || undefined,
      });
      setAccountMsg('Account updated.');
      setAccount(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
    } catch (err) {
      setAccountMsg(`Error: ${err.message}`);
    } finally {
      setSavingAccount(false);
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

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      {/* Always-visible essentials: platform info + account */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start', marginBottom: 16 }}>
        <Card>
          <CardTitle>Platform</CardTitle>
          <InfoRow label="Platform URL" value={window.location.origin} />
          <InfoRow label="Environment" value={import.meta.env.MODE} />
        </Card>

        <Card>
          <CardTitle>Account</CardTitle>
          <p style={styles.hint}>Change your login username or password.</p>
          <form onSubmit={handleSaveAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <Field label="Username">
              <input type="text" style={styles.input} value={account.username} onChange={e => setAccount(p => ({ ...p, username: e.target.value }))} autoComplete="username" />
            </Field>
            <Field label="Current Password">
              <input type="password" style={styles.input} value={account.currentPassword} onChange={e => setAccount(p => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" required />
            </Field>
            <Field label={<>New Password <span style={{ fontWeight: 400, textTransform: 'none', color: '#888' }}>(leave blank to keep current)</span></>}>
              <input type="password" style={styles.input} value={account.newPassword} onChange={e => setAccount(p => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" />
            </Field>
            {account.newPassword && (
              <Field label="Confirm New Password">
                <input type="password" style={styles.input} value={account.confirmPassword} onChange={e => setAccount(p => ({ ...p, confirmPassword: e.target.value }))} autoComplete="new-password" />
              </Field>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="submit" style={styles.btn} disabled={savingAccount}>{savingAccount ? 'Saving…' : 'Update Account'}</button>
              {accountMsg && <span style={{ fontSize: 13, color: accountMsg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>{accountMsg}</span>}
            </div>
          </form>
        </Card>
      </div>

      <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
        Tap a category to expand its integrations. Each block has its own Save button.
      </p>

      {/* Categorised integration cards — collapsible, multi-column grid */}
      <form onSubmit={e => e.preventDefault()} autoComplete="off">
        {/* Dummy fields to prevent browser autofill from hitting real inputs */}
        <input type="text" name="username" style={{ display: 'none' }} autoComplete="username" readOnly />
        <input type="password" name="password" style={{ display: 'none' }} autoComplete="current-password" readOnly />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
          {CATEGORIES.map(cat => {
            const groupsInCat = KEY_GROUPS.filter(g => g.category === cat.title);
            const open = !!openCategories[cat.title];
            const configuredCount = groupsInCat.filter(g => g.keys.some(k => values[k.key] === '••••••••')).length;

            return (
              <Card key={cat.title}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.title)}
                  style={styles.categoryToggle}
                >
                  <div>
                    <div style={styles.categoryTitle}>{cat.title}</div>
                    {cat.description && <div style={styles.categoryDesc}>{cat.description}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={styles.countPill}>{configuredCount} / {groupsInCat.length}</span>
                    <span style={{ fontSize: 14, color: '#666' }}>{open ? '▾' : '▸'}</span>
                  </div>
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
                    {groupsInCat.map(group => (
                      <div key={group.title} style={styles.subSection}>
                        <div style={styles.subSectionTitle}>{group.title}</div>
                        {group.hint && <p style={styles.hint}>{group.hint}</p>}
                        {group.note && (
                          <div style={styles.note}><strong>Developer app required.</strong> {group.note}</div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: group.hint || group.note ? 12 : 0 }}>
                          {group.keys.map(({ key, label, placeholder, type }) => (
                            <div key={key} style={styles.field}>
                              <label style={styles.label}>{label}</label>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  type={visibleKeys[key] ? 'text' : type}
                                  style={{ ...styles.input, flex: 1 }}
                                  value={values[key] === '••••••••' ? '' : (values[key] || '')}
                                  placeholder={values[key] === '••••••••' ? 'Already set — enter new value to change' : placeholder}
                                  onChange={e => handleChange(key, e.target.value)}
                                  autoComplete="new-password"
                                />
                                {type === 'password' && (
                                  <button
                                    type="button"
                                    onClick={() => toggleReveal(key)}
                                    style={styles.eyeBtn}
                                    title={visibleKeys[key] ? 'Hide' : 'Show'}
                                  >
                                    {visibleKeys[key] ? '🙈' : '👁️'}
                                  </button>
                                )}
                              </div>
                              <span style={styles.envHint}><code>{key}</code></span>
                            </div>
                          ))}
                        </div>
                        {group.test === 'dataforseo' && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleTestDataForSEO} disabled={testingDfs}
                                style={{ ...styles.btn, padding: '7px 14px', fontSize: 12 }}>
                                {testingDfs ? 'Testing…' : 'Test connection'}
                              </button>
                              {dfsTestMsg && (
                                <span style={{ fontSize: 12, color: dfsTestMsg.ok ? '#2e7d32' : '#c62828' }}>
                                  {dfsTestMsg.ok ? '✓ ' : '✗ '}{dfsTestMsg.message}
                                </span>
                              )}
                            </div>
                            {dfsTestMsg && dfsTestMsg.sent && (
                              <div style={{ fontSize: 11, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
                                Sent login <code>{dfsTestMsg.sent.login}</code>, password {dfsTestMsg.sent.passwordLength} chars ({dfsTestMsg.sent.passwordPreview}){dfsTestMsg.code != null ? `. DataForSEO code ${dfsTestMsg.code}` : ''}.
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                          <button type="button" onClick={() => handleSaveSection(group)} disabled={savingSection === group.title}
                            style={{ ...styles.btn, padding: '7px 14px', fontSize: 12 }}>
                            {savingSection === group.title ? 'Saving…' : 'Save'}
                          </button>
                          {sectionResult && sectionResult.title === group.title && (
                            <span style={{ fontSize: 12, fontWeight: 600, color: sectionResult.ok ? '#2e7d32' : '#c62828' }}>
                              {sectionResult.ok ? '✓ Saved' : `✗ ${sectionResult.message}`}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}

                    {cat.hasTestEmail && (
                      <div style={styles.subSection}>
                        <div style={styles.subSectionTitle}>Send Test Email</div>
                        <p style={styles.hint}>Verify your email provider after saving credentials above.</p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <input
                            type="email" placeholder="Send test email to…"
                            value={testEmail} onChange={e => setTestEmail(e.target.value)}
                            style={{ ...styles.input, flex: '1 1 200px' }}
                          />
                          <button type="button" onClick={handleTestEmail} style={{ ...styles.btn, padding: '7px 14px', fontSize: 12 }} disabled={sendingTest}>
                            {sendingTest ? 'Sending…' : 'Send Test'}
                          </button>
                        </div>
                        {testMsg && <div style={{ marginTop: 6, fontSize: 12, color: testMsg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>{testMsg}</div>}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </form>
    </div>
  );
}

function Card({ children }) {
  return <div style={styles.card}>{children}</div>;
}
function CardTitle({ children }) {
  return <h2 style={styles.cardTitle}>{children}</h2>;
}
function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
      <span style={{ color: '#666' }}>{label}</span>
      <code style={{ color: '#1a1a1a' }}>{value}</code>
    </div>
  );
}

const styles = {
  card: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 8, padding: '18px 20px' },
  cardTitle: { fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: '#1a1a1a' },
  categoryToggle: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
    padding: 0, textAlign: 'left',
  },
  categoryTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a1a' },
  categoryDesc: { fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.5 },
  countPill: {
    background: '#f1f1f1', border: '1px solid #e0e0e0', borderRadius: 12,
    padding: '2px 9px', fontSize: 11, color: '#666', fontWeight: 600,
  },
  subSection: { borderTop: '1px solid #f0f0f0', paddingTop: 14 },
  subSectionTitle: { fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 },
  hint: { fontSize: 12, color: '#666', lineHeight: 1.5, margin: 0 },
  note: { background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 4, padding: '8px 12px', fontSize: 12, lineHeight: 1.5, marginTop: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 10, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, fontFamily: 'Brockmann, sans-serif' },
  eyeBtn: { background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '6px 9px', cursor: 'pointer', fontSize: 13, lineHeight: 1 },
  envHint: { fontSize: 10, color: '#aaa' },
  btn: { background: '#E7CD41', color: '#1a1a1a', border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Brockmann, sans-serif' },
};
