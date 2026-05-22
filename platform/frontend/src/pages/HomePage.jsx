import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const YELLOW = '#E7CD41';
const DARK = '#0f0f0f';
const GREY = '#6b7280';
const LIGHT_BG = '#f9fafb';
const BORDER = '#e5e7eb';

const integrations = [
  { name: 'Google Analytics 4', icon: '📊' },
  { name: 'Google Ads', icon: '🎯' },
  { name: 'Google Search Console', icon: '🔍' },
  { name: 'Google Merchant Center', icon: '🛍️' },
  { name: 'Meta Ads', icon: '📱' },
  { name: 'Instagram', icon: '📸' },
  { name: 'Shopify', icon: '🛒' },
  { name: 'Shopify Email', icon: '📧' },
  { name: 'Klaviyo', icon: '💌' },
  { name: 'Brevo', icon: '✉️' },
  { name: 'Zoho Inventory', icon: '📦' },
  { name: 'Cin7', icon: '🏭' },
];

const features = [
  {
    icon: '🤖',
    title: 'AI Report Chat',
    desc: "Ask Claude anything about your client's performance. Get instant answers from live connector data — no spreadsheets, no waiting.",
  },
  {
    icon: '📡',
    title: '20+ Integrations',
    desc: 'Connect Google, Meta, Shopify, Klaviyo, inventory systems and more. All data in one place, always fresh.',
  },
  {
    icon: '📋',
    title: 'Automated Reports',
    desc: 'Weekly and monthly reports generated and emailed automatically. Branded, data-driven, ready to send.',
  },
  {
    icon: '🔎',
    title: 'SEO Rank Tracking',
    desc: 'Track keyword positions daily across all your clients. Spot gains and losses before anyone else does.',
  },
  {
    icon: '📈',
    title: 'Ads Performance',
    desc: 'Unified view of Google Ads and Meta Ads. Spend, revenue, ROAS — with an AI advisor to suggest improvements.',
  },
  {
    icon: '⚡',
    title: 'Anomaly Detection',
    desc: 'Claude monitors your data and flags unusual changes in traffic, spend, or conversions before they become problems.',
  },
  {
    icon: '🏢',
    title: 'Multi-Client Management',
    desc: 'Built for agencies. Manage unlimited clients, each with their own connectors, reports, and chat history.',
  },
  {
    icon: '📦',
    title: 'Inventory Insights',
    desc: 'Pull stock levels and sales orders from Zoho Inventory or Cin7 directly into your reports.',
  },
];

const plans = [
  {
    name: 'Starter',
    price: '£149',
    period: '/mo',
    desc: 'For small agencies or in-house teams getting started.',
    features: [
      'Up to 3 clients',
      '10 integrations per client',
      'AI Report Chat',
      'Automated weekly reports',
      'SEO rank tracking (100 keywords)',
      'Email support',
    ],
    cta: 'Join waitlist',
    highlight: false,
  },
  {
    name: 'Agency',
    price: '£349',
    period: '/mo',
    desc: 'The full platform for growing agencies.',
    features: [
      'Unlimited clients',
      'All 20+ integrations',
      'AI Report Chat + Ads Advisor',
      'Weekly & monthly automated reports',
      'SEO rank tracking (unlimited)',
      'Anomaly detection & alerts',
      'Priority support',
    ],
    cta: 'Join waitlist',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For large agencies and in-house marketing teams.',
    features: [
      'Everything in Agency',
      'White-label reports',
      'Custom integrations',
      'Dedicated onboarding',
      'SLA & uptime guarantee',
      'Team access & permissions',
    ],
    cta: 'Get in touch',
    highlight: false,
  },
];

export default function HomePage() {
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);

  async function handleWaitlist(e) {
    e.preventDefault();
    if (!waitlistEmail) return;
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitlistEmail }),
      });
    } catch {
      // Still confirm to the visitor — don't block on a notification failure.
    }
    setWaitlistDone(true);
  }

  return (
    <div className="home" style={{ fontFamily: 'Inter, system-ui, sans-serif', color: DARK, lineHeight: 1.6 }}>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${BORDER}`, padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo-yellow.gif" alt="October" style={{ height: 28 }} />
          <span className="home-brandtext" style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>Performance Marketing Platform</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <a className="home-navlink" href="#features" style={{ fontSize: 14, color: GREY, textDecoration: 'none' }}>Features</a>
          <a className="home-navlink" href="#integrations" style={{ fontSize: 14, color: GREY, textDecoration: 'none' }}>Integrations</a>
          <a className="home-navlink" href="#pricing" style={{ fontSize: 14, color: GREY, textDecoration: 'none' }}>Pricing</a>
          <Link to="/login" style={{ fontSize: 14, color: DARK, textDecoration: 'none', fontWeight: 600, padding: '8px 18px', border: `1.5px solid ${DARK}`, borderRadius: 8 }}>
            Log in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ background: DARK, color: '#fff', padding: '100px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', background: YELLOW, color: DARK, fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, marginBottom: 24, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Built for performance marketers
          </div>
          <h1 style={{ fontSize: 'clamp(36px, 6vw, 68px)', fontWeight: 800, margin: '0 0 24px', lineHeight: 1.1, letterSpacing: -1.5 }}>
            One platform.<br />
            <span style={{ color: YELLOW }}>All your client data.</span>
          </h1>
          <p style={{ fontSize: 20, color: 'rgba(255,255,255,0.7)', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.6 }}>
            Connect Google, Meta, Shopify and 20+ more. Generate AI-powered reports, track SEO, and chat with your data — across every client.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#pricing" style={{ background: YELLOW, color: DARK, padding: '14px 32px', borderRadius: 10, fontWeight: 700, fontSize: 16, textDecoration: 'none' }}>
              Join the waitlist
            </a>
            <a href="#features" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', padding: '14px 32px', borderRadius: 10, fontWeight: 600, fontSize: 16, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)' }}>
              See what it does →
            </a>
          </div>
        </div>
      </section>

      {/* Social proof strip */}
      <div style={{ background: '#f3f4f6', borderBottom: `1px solid ${BORDER}`, padding: '16px 40px', textAlign: 'center', fontSize: 13, color: GREY }}>
        Trusted by performance marketing agencies · Connects to the tools you already use · Reports your clients actually read
      </div>

      {/* Features */}
      <section id="features" style={{ padding: '100px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 16px', letterSpacing: -1 }}>Everything in one place</h2>
          <p style={{ fontSize: 18, color: GREY, maxWidth: 520, margin: '0 auto' }}>No more tab-switching. No more manual exports. Your whole reporting workflow, automated.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          {features.map((f, i) => (
            <div key={i} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '28px 24px', transition: 'box-shadow 0.2s' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px' }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: GREY, margin: 0, lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI Chat highlight */}
      <section style={{ background: DARK, color: '#fff', padding: '100px 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
          <div>
            <div style={{ color: YELLOW, fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>AI Report Chat</div>
            <h2 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 20px', letterSpacing: -1, lineHeight: 1.15 }}>Talk to your clients&apos; data</h2>
            <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.7)', marginBottom: 24, lineHeight: 1.7 }}>
              Ask Claude anything: "Why did traffic drop last week?", "Which campaigns have the best ROAS?", "Summarise this month's performance for the board meeting."
            </p>
            <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7 }}>
              Claude reads live data from all connected sources, spots anomalies, and helps you build reports in seconds — not hours.
            </p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'monospace', fontSize: 13 }}>
            {[
              { role: 'user', text: 'How did Shopify perform last month?' },
              { role: 'ai', text: '📊 Revenue was £42,180 across 318 orders (AOV £132.65). Up 18% vs prior period. Top-performing product: Cast Iron Skillet. Conversion rate held at 3.2%. One anomaly: traffic from paid search dropped 22% week 3 — worth investigating Google Ads.' },
              { role: 'user', text: 'What should we do about the paid search drop?' },
              { role: 'ai', text: '🎯 Google Ads data shows spend was flat but impressions fell. Likely cause: Quality Score drop or increased competition on brand terms. Recommend auditing negative keywords and checking for bid strategy changes around that date.' },
            ].map((m, i) => (
              <div key={i} style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: m.role === 'user' ? YELLOW : '#a3e635', whiteSpace: 'nowrap', marginTop: 2 }}>
                  {m.role === 'user' ? 'YOU' : 'CLAUDE'}
                </span>
                <span style={{ color: m.role === 'user' ? '#e5e7eb' : 'rgba(255,255,255,0.75)', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section id="integrations" style={{ padding: '100px 40px', background: LIGHT_BG }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 16px', letterSpacing: -1 }}>Connects to everything</h2>
          <p style={{ fontSize: 18, color: GREY, marginBottom: 56 }}>OAuth and API key integrations — no developers needed.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {integrations.map((int, i) => (
              <div key={i} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{int.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: DARK }}>{int.name}</div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 32, fontSize: 14, color: GREY }}>More integrations added regularly. Don&apos;t see yours? <a href="mailto:hello@octobercomms.com" style={{ color: DARK, fontWeight: 600 }}>Let us know.</a></p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ padding: '100px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 16px', letterSpacing: -1 }}>Simple, transparent pricing</h2>
          <p style={{ fontSize: 18, color: GREY }}>No setup fees. Cancel anytime. Launching soon — join the waitlist for early access.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 24 }}>
          {plans.map((plan, i) => (
            <div key={i} style={{
              background: plan.highlight ? DARK : '#fff',
              border: plan.highlight ? `2px solid ${YELLOW}` : `1px solid ${BORDER}`,
              borderRadius: 16, padding: '36px 32px',
              color: plan.highlight ? '#fff' : DARK,
              position: 'relative',
            }}>
              {plan.highlight && (
                <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: YELLOW, color: DARK, fontSize: 11, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                  Most popular
                </div>
              )}
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{plan.name}</div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: -2 }}>{plan.price}</span>
                <span style={{ fontSize: 16, color: plan.highlight ? 'rgba(255,255,255,0.6)' : GREY }}>{plan.period}</span>
              </div>
              <p style={{ fontSize: 14, color: plan.highlight ? 'rgba(255,255,255,0.65)' : GREY, marginBottom: 28 }}>{plan.desc}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plan.features.map((f, j) => (
                  <li key={j} style={{ fontSize: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: YELLOW, fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <span style={{ color: plan.highlight ? 'rgba(255,255,255,0.85)' : DARK }}>{f}</span>
                  </li>
                ))}
              </ul>
              <a href="#waitlist" style={{
                display: 'block', textAlign: 'center', padding: '13px 24px', borderRadius: 10, fontWeight: 700, fontSize: 15, textDecoration: 'none',
                background: plan.highlight ? YELLOW : DARK,
                color: plan.highlight ? DARK : '#fff',
              }}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Waitlist CTA */}
      <section id="waitlist" style={{ background: DARK, color: '#fff', padding: '100px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 16px', letterSpacing: -1 }}>Get early access</h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.65)', marginBottom: 40 }}>
            We're opening to a small group of agencies first. Join the waitlist and we'll be in touch.
          </p>
          {waitlistDone ? (
            <div style={{ background: 'rgba(231,205,65,0.15)', border: `1px solid ${YELLOW}`, borderRadius: 12, padding: '20px 24px', color: YELLOW, fontWeight: 600, fontSize: 16 }}>
              ✓ You're on the list! We'll be in touch soon.
            </div>
          ) : (
            <form onSubmit={handleWaitlist} style={{ display: 'flex', gap: 10, maxWidth: 460, margin: '0 auto' }}>
              <input
                type="email"
                required
                value={waitlistEmail}
                onChange={e => setWaitlistEmail(e.target.value)}
                placeholder="your@agency.com"
                style={{ flex: 1, padding: '14px 18px', borderRadius: 10, border: 'none', fontSize: 15, outline: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
              />
              <button type="submit" style={{ background: YELLOW, color: DARK, padding: '14px 24px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Join waitlist
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: '#0a0a0a', color: 'rgba(255,255,255,0.4)', padding: '40px', textAlign: 'center', fontSize: 13 }}>
        <div style={{ marginBottom: 16 }}>
          <img src="/logo-black.gif" alt="October" style={{ height: 24, opacity: 0.5 }} />
        </div>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <a href="#features" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Features</a>
          <a href="#pricing" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Pricing</a>
          <Link to="/login" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Log in</Link>
          <a href="mailto:hello@octobercomms.com" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Contact</a>
        </div>
        <div>© {new Date().getFullYear()} October Communications Ltd. All rights reserved.</div>
      </footer>

    </div>
  );
}
