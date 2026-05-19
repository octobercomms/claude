import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const KEY_GROUPS = [
  {
    title: 'Claude AI',
    hint: 'Used for generating executive summaries and recommendations in reports.',
    keys: [
      { key: 'CLAUDE_API_KEY', label: 'Claude API Key', placeholder: 'sk-ant-…', type: 'password' },
    ],
  },
  {
    title: 'Email Provider',
    hint: 'Choose whether to send reports via Gmail or Amazon SES. SES is recommended for production.',
    keys: [
      { key: 'EMAIL_PROVIDER', label: 'Provider', placeholder: 'gmail or ses', type: 'text' },
    ],
  },
  {
    title: 'Gmail SMTP',
    hint: 'Used when EMAIL_PROVIDER is set to "gmail". Requires a Gmail App Password — Google Account → Security → 2-Step Verification → App passwords.',
    keys: [
      { key: 'GMAIL_USER', label: 'Gmail Address', placeholder: 'octobercommsreports@gmail.com', type: 'text' },
      { key: 'GMAIL_APP_PASSWORD', label: 'Gmail App Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password' },
    ],
  },
  {
    title: 'Amazon SES',
    hint: 'Used when EMAIL_PROVIDER is set to "ses". Generate SMTP credentials in the SES console: Verified identities → SMTP settings → Create SMTP credentials.',
    keys: [
      { key: 'SES_FROM_EMAIL', label: 'From Email (verified in SES)', placeholder: 'reports@octobercomms.com', type: 'text' },
      { key: 'SES_REGION', label: 'AWS Region', placeholder: 'eu-west-1', type: 'text' },
      { key: 'SES_SMTP_USER', label: 'SMTP Username', placeholder: 'AKIA…', type: 'text' },
      { key: 'SES_SMTP_PASS', label: 'SMTP Password', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Google OAuth',
    hint: 'Required for GA4, Google Search Console, Google Ads and Merchant Center connectors. Create credentials at console.cloud.google.com.',
    keys: [
      { key: 'GOOGLE_CLIENT_ID', label: 'Client ID', placeholder: '…apps.googleusercontent.com', type: 'text' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', placeholder: 'GOCSPX-…', type: 'password' },
    ],
  },
  {
    title: 'Meta',
    hint: 'Required for Meta Ads and Instagram connectors. Create an app at developers.facebook.com.',
    keys: [
      { key: 'META_APP_ID', label: 'App ID', placeholder: '1234567890', type: 'text' },
      { key: 'META_APP_SECRET', label: 'App Secret', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'DataForSEO',
    hint: 'Used for keyword rank tracking. Get credentials at dataforseo.com.',
    keys: [
      { key: 'DATAFORSEO_LOGIN', label: 'Login (email)', placeholder: 'you@example.com', type: 'text' },
      { key: 'DATAFORSEO_PASSWORD', label: 'Password', placeholder: '…', type: 'password' },
    ],
  },
  {
    title: 'Amazon SP-API',
    hint: null,
    note: 'Amazon SP-API requires a registered developer application approved by Amazon before credentials can be generated. This is a separate process from standard API key setup.',
    keys: [
      { key: 'AMAZON_CLIENT_ID', label: 'Client ID', placeholder: 'amzn1.application-oa2-client.…', type: 'text' },
    ],
  },
  {
    title: 'n8n Integration',
    hint: 'Set your n8n instance URL to enable webhook-triggered data pulls.',
    keys: [
      { key: 'N8N_WEBHOOK_BASE_URL', label: 'Webhook Base URL', placeholder: 'https://your-n8n.example.com', type: 'text' },
    ],
  },
];

export default function SettingsPage() {
  const [values, setValues] = useState({});
  const [revealed, setRevealed] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    api.get('/settings/platform-keys').then(data => setValues(data));
  }, []);

  async function toggleReveal(key) {
    if (!revealed) {
      // First reveal — fetch all decrypted values
      const data = await api.get('/settings/platform-keys/values');
      setValues(data);
      setRevealed(true);
    }
    setVisibleKeys(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    try {
      const { updated } = await api.post('/settings/platform-keys', values);
      setSaveMsg(updated.length ? `Saved: ${updated.join(', ')}` : 'No changes to save.');
      const fresh = await api.get('/settings/platform-keys');
      setValues(fresh);
      setRevealed(false);
      setVisibleKeys({});
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
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

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680 }}>

        <Section title="Platform">
          <InfoRow label="Platform URL" value={window.location.origin} />
          <InfoRow label="Environment" value={import.meta.env.MODE} />
        </Section>

        <Section title="Authentication">
          <p style={styles.hint}>
            Admin credentials are set via the <code>.env</code> file on the server.
            Change <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> and restart the service.
          </p>
        </Section>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {KEY_GROUPS.map(group => (
            <Section key={group.title} title={group.title}>
              {group.hint && <p style={styles.hint}>{group.hint}</p>}
              {group.note && (
                <div style={styles.note}><strong>Developer app required.</strong> {group.note}</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: group.hint || group.note ? 16 : 0 }}>
                {group.keys.map(({ key, label, placeholder, type }) => (
                  <div key={key} style={styles.field}>
                    <label style={styles.label}>{label}</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type={visibleKeys[key] ? 'text' : type}
                        style={{ ...styles.input, flex: 1 }}
                        value={values[key] || ''}
                        placeholder={!revealed && values[key] === '••••••••' ? 'Already set — enter new value to change' : placeholder}
                        onChange={e => handleChange(key, e.target.value)}
                        autoComplete="off"
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
            </Section>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="submit" style={styles.btn} disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {saveMsg && (
              <span style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>
                {saveMsg}
              </span>
            )}
          </div>
        </form>

        <Section title="Send Test Email">
          <p style={styles.hint}>Verify your email provider is working after saving credentials above.</p>
          <form onSubmit={handleTestEmail} style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input
              type="email" placeholder="Send test email to…" required
              value={testEmail} onChange={e => setTestEmail(e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
            <button type="submit" style={styles.btn} disabled={sendingTest}>
              {sendingTest ? 'Sending…' : 'Send Test'}
            </button>
          </form>
          {testMsg && <div style={{ marginTop: 8, fontSize: 13, color: testMsg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>{testMsg}</div>}
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
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
  section: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, padding: '20px 24px' },
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: '#1a1a1a' },
  hint: { fontSize: 13, color: '#666', lineHeight: 1.6, margin: 0 },
  note: { background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 4, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, fontFamily: 'Brockmann, sans-serif' },
  eyeBtn: { background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontSize: 14, lineHeight: 1 },
  envHint: { fontSize: 11, color: '#aaa' },
  btn: { background: '#000000', color: 'white', border: 'none', borderRadius: 4, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Brockmann, sans-serif' },
};
