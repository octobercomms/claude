import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

// Integrations hub: how each client integration works, the files/apps to
// install, and the tools to set them up (GTM container download + pairing
// token generator). Per-client connecting (Connect Google, pair a store)
// happens on each client's Setup → Connectors tab; this page is the
// explainer + the shared artifacts.

const SECTIONS = [
  {
    id: 'overview',
    title: 'Overview — the three ways clients connect',
    summary: 'Durable Google auth, push-based apps/plugins, and the tracking container.',
    body: [
      'The platform pulls ~15 third-party tools per client. Three patterns now make those connections far more durable:',
      '**1. Durable Google auth.** Google connectors (GA4, Search Console, Merchant Center, Ads) no longer depend only on a member of staff staying signed in. They can authenticate with a **platform service account** (or, for Ads, a **manager-account / MCC link**) that never expires.',
      '**2. Push-based apps & plugins.** Instead of us polling a client\'s WooCommerce/WordPress or Shopify (which hosting WAFs block), the client installs our **WordPress plugin** or **Shopify app**, and *it* pushes data out to us. Outbound traffic is never WAF-challenged, so it just works.',
      '**3. The tracking container.** A pre-built **Google Tag Manager** container the account manager imports into a client\'s GTM — GA4, Meta, TikTok, LinkedIn and the October MI pixel, all wired up in one import.',
      'Per-client connecting happens on **Clients → (pick a client) → Setup → Connectors**. This page explains each one and gives you the files + tools.',
    ],
  },
  {
    id: 'admin-setup',
    title: 'Before you start (admin, once)',
    summary: 'Three platform-wide keys to set in Settings.',
    body: [
      'Set these once in **[Settings → Platform keys](/settings)**; every client then reuses them:',
      '**`GOOGLE_SERVICE_ACCOUNT_JSON`** — paste the full service-account key file (JSON). This powers the durable service-account auth for GA4 / Search Console / Merchant Center.',
      '**`GOOGLE_ADS_MANAGER_REFRESH_TOKEN`** — a one-time OAuth refresh token for your Google Ads **manager (MCC)** account. Powers the durable Ads path. (`GOOGLE_ADS_MCC_ID` should already be set.)',
      '**`OMI_FORWARD_SECRET`** — a shared secret the Shopify app signs its forwarded webhooks with. Generate any long random string and set the **same value** in the Shopify app\'s environment.',
      'The **service-account email** clients need to grant access to is shown on each connector\'s **Diagnose** panel once the JSON is set (it looks like `october-mi@<project>.iam.gserviceaccount.com`).',
    ],
  },
  {
    id: 'google',
    title: 'Google connectors — durable auth (no more expiring logins)',
    summary: 'Service account for GA4/GSC/Merchant; MCC link for Ads.',
    body: [
      'On a client\'s **Setup → Connectors** tab, click **Connect Google** (or **Connect** next to a specific Google connector). A modal offers two paths:',
      '**Durable (recommended) — never expires.** For GA4, Search Console and Merchant Center this uses the platform **service account**; for Google Ads it uses the **MCC link**.',
      '**Sign in with Google.** The classic one-click OAuth — still there, but it breaks when staff change passwords or leave.',
      'After choosing durable, the modal shows the exact next step:',
      '• **GA4** — add the service-account email as a **Viewer** on the GA4 property.',
      '• **Search Console** — add it as a **user with Restricted access** on the property.',
      '• **Merchant Center** — add it as a **user** (Settings → Users) on the account.',
      '• **Google Ads** — accept the **manager (MCC) link request** in the client\'s Google Ads account; the platform reaches the account through your MCC.',
      'Then pick the property/account in the connector row and hit **Diagnose** — it runs a live check and, on a permissions error, tells you exactly which email to add. That\'s it: the connection no longer depends on anyone staying logged in.',
    ],
  },
  {
    id: 'wordpress',
    title: 'WordPress / WooCommerce plugin',
    summary: 'Install the plugin, paste a pairing token — data flows out to us.',
    body: [
      'For WooCommerce/WordPress clients, the **October Marketing Intelligence** plugin replaces fragile REST polling: the site pushes orders, customers, products, inventory, content and SEO scores out to the platform (and can receive draft posts back).',
      '**Get the file:** use **Download WordPress plugin** in the Tools panel above (served straight from the platform).',
      '**Install (on the client\'s WordPress):** Plugins → Add New → Upload Plugin → choose the ZIP → Activate.',
      '**Updates are automatic:** the plugin updates itself from the platform — no token, no re-upload. When a new version is deployed here, paired sites pick it up on the WordPress Updates screen and install it on schedule.',
      '**Pair it:** in WP admin go to **Tools → October Marketing Intelligence**, paste a **pairing token**, and click Connect. Generate the token below (Tools panel → pick the client → WordPress).',
      '**Verify:** the plugin\'s admin screen shows "Connected to [client name]", last sync, and a count of events pushed. The connector also appears on the client\'s Connectors tab.',
      'Publishing back: the Organic → Publish step can push drafts straight into the client\'s WordPress through the plugin (bypassing the WAF). Pick the plugin connector as the WordPress target.',
    ],
  },
  {
    id: 'shopify',
    title: 'Shopify app',
    summary: 'Install from the App Store, pair with a token — webhooks flow in.',
    body: [
      'For Shopify clients, the **October Marketing Intelligence** app syncs orders, customers, products, inventory, themes and abandoned checkouts in real time via webhooks, and handles the mandatory GDPR webhooks.',
      '**Get the app:** the public **App Store listing is pending review**. Until it\'s live, install via the Partner dashboard preview link (ask the admin). The app code lives in `dev/october-mi-shopify/` for reference.',
      '**Pair it:** after install, the app\'s embedded admin asks for a **pairing token**. Generate one below (Tools panel → pick the client → Shopify) and paste it in. The admin then shows "Connected to [client name]".',
      '**Verify:** the connector appears on the client\'s Connectors tab and starts receiving order/customer/product events.',
    ],
  },
  {
    id: 'gtm',
    title: 'Google Tag Manager container',
    summary: 'One import sets up GA4, Meta, TikTok, LinkedIn + the OMI pixel.',
    body: [
      'A pre-built GTM container with GA4 enhanced-ecommerce events, Meta Pixel, TikTok Pixel, LinkedIn Insight Tag and the October MI tracking pixel — all parameterised so the same file works for every client.',
      '**Get the file:** use **Download GTM container** in the Tools panel below (`october-mi-v1.json`).',
      '**Import (in the client\'s GTM):** Admin → Import Container → upload the JSON → choose the **Merge** option → confirm.',
      '**Set the five values** GTM prompts for: GA4 measurement ID, Meta pixel ID, TikTok pixel ID, LinkedIn Partner ID, and the October MI client ID.',
      '**Preview, then Publish.** Re-importing a later version with **Merge** updates the tags without wiping the client\'s own values.',
      'Full step-by-step is in `docs/october-mi-gtm/INSTALL.md`.',
    ],
  },
];

export default function IntegrationsPage({ embedded = false }) {
  const [open, setOpen] = useState(() => new Set(['overview']));
  function toggle(id) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return (
    <div>
      {!embedded && (
        <>
          <div className="kicker"><span className="pip" />Setup &amp; installation</div>
          <header className="hero">
            <h1 className="display">Integrations</h1>
            <p className="body mt-4">
              How each client integration works, the files and apps to install, and the tools to set them up.
              Per-client connecting lives on each client&rsquo;s <strong>Setup → Connectors</strong> tab.
            </p>
          </header>
        </>
      )}
      {embedded && (
        <p className="body-sm text-muted" style={{ marginTop: 0, marginBottom: 18 }}>
          How each client integration works, the files and apps to install, and the tools to set them up.
          Per-client connecting lives on each client&rsquo;s <strong>Setup → Connectors</strong> tab.
        </p>
      )}

      <IntegrationTools />

      <div className="row wrap mb-5" style={{ marginTop: 24 }}>
        <button onClick={() => setOpen(new Set(SECTIONS.map(s => s.id)))} className="btn btn-secondary btn-sm">Expand all</button>
        <button onClick={() => setOpen(new Set())} className="btn btn-secondary btn-sm">Collapse all</button>
      </div>

      <div className="stack stack-sm">
        {SECTIONS.map(s => (
          <AccordionItem key={s.id} section={s} isOpen={open.has(s.id)} onToggle={() => toggle(s.id)} />
        ))}
      </div>
    </div>
  );
}

// ── Tools: downloads + pairing-token generator ──────────────────────────────
function IntegrationTools() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [token, setToken] = useState(null);   // { value, surface }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/clients').then(rows => {
      setClients(rows || []);
      if (rows && rows.length) setClientId(rows[0].id);
    }).catch(() => {});
  }, []);

  async function generate(surface) {
    if (!clientId) { setErr('Pick a client first.'); return; }
    setBusy(true); setErr(null); setToken(null); setCopied(false);
    try {
      const path = surface === 'shopify'
        ? `/connectors/client/${clientId}/shopify/pairing-token`
        : `/connectors/client/${clientId}/wp/pairing-token`;
      const res = await api.post(path, {});
      setToken({ value: res.token, surface, days: res.expires_in_days });
    } catch (e) {
      setErr(e.message || 'Could not generate a token.');
    } finally {
      setBusy(false);
    }
  }

  const clientName = clients.find(c => c.id === clientId)?.name || '';

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="h3" style={{ marginBottom: 4 }}>Tools</div>
      <div className="body-sm text-muted" style={{ marginBottom: 16 }}>Downloads and the pairing-token generator.</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <a className="btn btn-secondary btn-sm" href="/api/integrations/gtm-container" download>
          ↓ Download GTM container (october-mi-v1.json)
        </a>
        <a className="btn btn-secondary btn-sm" href="/api/integrations/wordpress-plugin" download>
          ↓ Download WordPress plugin (.zip)
        </a>
      </div>

      <div style={{ borderTop: 'var(--border-w) solid var(--card-border)', paddingTop: 16 }}>
        <div className="caption mb-2" style={{ fontSize: 10 }}>Generate a pairing token</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select
            value={clientId}
            onChange={e => { setClientId(e.target.value); setToken(null); }}
            className="input"
            style={{ minWidth: 200 }}
          >
            {!clients.length && <option value="">No clients</option>}
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => generate('wordpress')} className="btn btn-secondary btn-sm" disabled={busy || !clientId}>
            WordPress token
          </button>
          <button onClick={() => generate('shopify')} className="btn btn-secondary btn-sm" disabled={busy || !clientId}>
            Shopify token
          </button>
        </div>

        {err && <div className="body-sm" style={{ color: 'var(--danger, #b91c1c)', marginTop: 10 }}>{err}</div>}

        {token && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
            <div className="body-sm text-muted" style={{ marginBottom: 6 }}>
              {token.surface === 'shopify' ? 'Shopify' : 'WordPress'} pairing token for <strong>{clientName}</strong> — single use, valid {token.days || 7} days. Paste it into the {token.surface === 'shopify' ? 'app’s embedded admin' : 'plugin’s Tools → October Marketing Intelligence screen'}.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" readOnly value={token.value} onFocus={e => e.target.select()} style={{ fontFamily: 'monospace' }} />
              <button className="btn btn-secondary btn-sm" onClick={() => { try { navigator.clipboard.writeText(token.value); setCopied(true); } catch { /* clipboard unavailable */ } }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccordionItem({ section, isOpen, onToggle }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button onClick={onToggle} style={{
        width: '100%', textAlign: 'left', padding: '16px 20px', background: 'transparent',
        border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14,
      }}>
        <div>
          <div className="h3">{section.title}</div>
          <div className="body-sm text-muted mt-2">{section.summary}</div>
        </div>
        <span className="text-muted" style={{ fontSize: 18, flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>⌄</span>
      </button>
      {isOpen && (
        <div style={{ padding: '4px 20px 20px', borderTop: 'var(--border-w) solid var(--card-border)' }}>
          <ul className="body-sm" style={{ margin: 0, padding: '8px 0 0 18px', lineHeight: 1.65 }}>
            {section.body.map((line, i) => (
              <li key={i} style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: render(line) }} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Tiny markdown-ish renderer: escapes angle brackets, then supports
// [text](url) links, **bold** and `code`. Links open in a new tab.
function render(s) {
  return String(s)
    .replace(/[<>]/g, c => ({ '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent,#2563eb);text-decoration:underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
