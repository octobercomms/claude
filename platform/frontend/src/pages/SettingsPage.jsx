import React, { useState } from 'react';
import { api } from '../utils/api';

export default function SettingsPage() {
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [msg, setMsg] = useState('');

  async function handleTestEmail(e) {
    e.preventDefault();
    setSendingTest(true);
    setMsg('');
    try {
      await api.post('/api/settings/test-email', { to: testEmail });
      setMsg('Test email sent successfully.');
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 640 }}>

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

        <Section title="Email (Gmail SMTP)">
          <p style={styles.hint}>
            Outbound email uses <code>octobercommsreports@gmail.com</code> via Gmail App Password.
            Configure <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> in <code>.env</code>.
          </p>
          <form onSubmit={handleTestEmail} style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input
              type="email" placeholder="Send test email to…" required
              value={testEmail} onChange={e => setTestEmail(e.target.value)}
              style={styles.input}
            />
            <button type="submit" style={styles.btn} disabled={sendingTest}>
              {sendingTest ? 'Sending…' : 'Send Test'}
            </button>
          </form>
          {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>{msg}</div>}
        </Section>

        <Section title="Connectors & API Keys">
          <p style={styles.hint}>
            All connector API keys and OAuth credentials are stored encrypted in PostgreSQL.
            The encryption key is set via <code>ENCRYPTION_KEY</code> in <code>.env</code>.
            Google and Meta credentials are managed per-client via the Clients page.
          </p>
          <EnvVar name="GOOGLE_CLIENT_ID" />
          <EnvVar name="GOOGLE_CLIENT_SECRET" />
          <EnvVar name="META_APP_ID" />
          <EnvVar name="META_APP_SECRET" />
          <EnvVar name="CLAUDE_API_KEY" />
          <EnvVar name="DATAFORSEO_LOGIN" />
          <EnvVar name="DATAFORSEO_PASSWORD" />
          <EnvVar name="AMAZON_CLIENT_ID" />
        </Section>

        <Section title="n8n Integration">
          <p style={styles.hint}>
            Set <code>N8N_WEBHOOK_BASE_URL</code> to your n8n instance URL for webhook-triggered data pulls.
          </p>
        </Section>

        <Section title="Amazon SP-API Note">
          <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 4, padding: '12px 16px', fontSize: 13 }}>
            <strong>Developer app required.</strong> Amazon SP-API requires a registered developer application
            approved by Amazon before credentials can be generated. This is a separate process from standard
            API key setup — see{' '}
            <a href="https://developer-docs.amazon.com/sp-api/docs/registering-your-application" target="_blank" rel="noreferrer" style={{ color: '#e65100' }}>
              Amazon SP-API documentation
            </a>.
          </div>
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

function EnvVar({ name }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12 }}>
      <code style={{ color: '#555' }}>{name}</code>
      <span style={{ color: '#999' }}>Set in .env</span>
    </div>
  );
}

const styles = {
  section: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, padding: '20px 24px' },
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: '0 0 16px', color: '#1a1a1a' },
  hint: { fontSize: 13, color: '#666', lineHeight: 1.6, margin: 0 },
  input: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, flex: 1 },
  btn: { background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};
