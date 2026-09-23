import React, { useState } from 'react';
import { Link } from 'react-router-dom';

// Sister-site treatment to octobercomms.com. Black-dominated layout,
// white buttons (no yellow CTAs anywhere), lowercase typography, all
// content bounded to a 1140px column. Pattern breaks between sections
// are hand-authored Müller-Brockmann-style SVGs served from /public/
// patterns/ so the brand team can drop in finals later by replacing
// the files at those paths.

const YELLOW = 'var(--accent)';
const BLACK = '#0d0d0d';
const WHITE = '#ffffff';
const MUTED = 'rgba(255,255,255,0.55)';
const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MAX_W = 1140;

// White arrow component — thicker stroke, used in every CTA / link so
// the brand mark for "interactive" stays consistent. SVG so the weight
// renders crisply at any size.
function Arrow({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 'var(--s2)', flexShrink: 0 }}>
      <path d="M3 11 L11 3 M5.5 3 H11 V8.5" stroke={WHITE} strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
function DarkArrow({ size = 14 }) {
  // Variant for the one place an arrow sits on a white pill — needs
  // dark stroke to remain visible.
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 'var(--s2)', flexShrink: 0 }}>
      <path d="M3 11 L11 3 M5.5 3 H11 V8.5" stroke={BLACK} strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email) return;
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* don't block on notification failure */ }
    setDone(true);
  }

  return (
    <div className="home" style={{ fontFamily: FONT, color: WHITE, background: BLACK, lineHeight: 1.5 }}>

      {/* Header bar */}
      <header style={styles.topBar}>
        <div style={styles.container}>
          <div style={styles.topBarInner}>
            <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              <img src="/logo-black.gif" alt="October Communications" style={{ height: 32, display: 'block' }} />
            </Link>
            <nav style={{ display: 'flex', gap: 'var(--s6)', fontSize: 'var(--fs-body)', alignItems: 'center' }}>
              <a href="#what" style={styles.topLink}>what it does</a>
              <a href="#how" style={styles.topLink}>how it works</a>
              <a href="#pricing" style={styles.topLink}>pricing</a>
              <Link to="/login" style={styles.pillWhiteSm}>log in<DarkArrow /></Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section style={styles.section}>
        <div style={styles.container}>
          <div style={styles.eyebrow}>marketing intelligence</div>
          <h1 style={styles.h1}>
            every client&apos;s data,<br/>
            <span style={{ color: YELLOW }}>in one place,</span><br/>
            with claude on top.
          </h1>
          <p style={styles.heroLede}>
            a platform built by october communications for ambitious marketing teams.
            ecommerce, sales, email, seo, ads and outreach — pulled live from the tools you already use,
            then turned into reports, social, ad creative and answers you can actually use.
          </p>
          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', marginTop: 'var(--s8)' }}>
            <a href="#waitlist" style={styles.pillWhite}>join the waitlist<DarkArrow /></a>
            <a href="#what" style={styles.pillOutline}>see what it does<Arrow /></a>
          </div>
        </div>
      </section>

      {/* SVG 1 — checkerboard (kept) */}
      <CheckerboardBreak />

      {/* Audience nav strip */}
      <section style={styles.thinSection}>
        <div style={styles.container}>
          <div style={styles.audienceInner}>
            <Arrow size={16} />
            {['agencies', 'in-house teams', 'consultancies', 'studios', 'founders'].map(a => (
              <span key={a} style={styles.audienceChip}>{a}</span>
            ))}
          </div>
        </div>
      </section>

      {/* What we do — three-column copy */}
      <section id="what" style={styles.section}>
        <div style={styles.container}>
          <div style={styles.threeCol}>
            <div>
              <h2 className="h2">
                one platform.<br/>
                <span style={{ color: YELLOW }}>every client.</span>
              </h2>
              <a href="#waitlist" style={styles.pillWhiteSm}>join waitlist<DarkArrow /></a>
              <div style={{ marginTop: 'var(--s4)' }}>
                <a href="#pricing" style={{ ...styles.topLink, display: 'inline-flex', alignItems: 'center' }}>
                  pricing<Arrow size={12} />
                </a>
              </div>
            </div>
            <div>
              <p style={styles.body}>
                we are the only platform that connects your client&apos;s data sources, runs ai-grounded analysis,
                and turns the output into reports, social, ad creative and outreach — all in one login.
              </p>
              <p style={styles.body}>
                the work that took your team a week now takes an afternoon. the analysis that needed a senior analyst
                now happens in plain english. and the strategy that hid behind dashboards now sits in one tab.
              </p>
            </div>
            <div>
              <p style={styles.body}>
                we are deeply passionate about marketing operations and their potential to transform agencies.
                we don&apos;t pretend to replace strategy — we replace the work that gets in the way of it.
              </p>
              <p style={styles.body}>
                every connector, every model, every prompt is built to give creative directors, account managers
                and founders back the time they should be spending on the work that actually moves the needle.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SVG 2 — Müller-Brockmann triangles */}
      <PatternImage src="/patterns/muller-brockmann-triangles.svg" alt="" />

      {/* How it works */}
      <section id="how" style={styles.section}>
        <div style={styles.container}>
          <h2 className="h2" style={{ marginBottom: 'var(--s8)' }}>
            three things, in sequence.
          </h2>
          <div style={styles.howGrid}>
            <HowStep n="01" title="connect" body="oauth or paste an api key. one click to wire up google, meta, shopify, klaviyo, brevo, amazon, zoho — and a dozen more. one connection unlocks every tool inside that family." />
            <HowStep n="02" title="ask" body="the ai data analyst answers questions in plain english. 'why did traffic drop last week?' 'which campaign is dropping in roas?' 'summarise this month for the board.' real numbers, cited." />
            <HowStep n="03" title="ship" body="reports written by claude and sent by the platform. social posts with full storyboards. ad creative across every aspect ratio. cold outreach with auto-classified replies. one login, every deliverable." />
          </div>
        </div>
      </section>

      {/* SVG 3 — Müller-Brockmann dots (concentric rings) */}
      <PatternImage src="/patterns/muller-brockmann-dots.svg" alt="" />

      {/* What it actually does */}
      <section style={styles.section}>
        <div style={styles.container}>
          <h2 className="h2" style={{ marginBottom: 'var(--s8)' }}>
            what it actually does.
          </h2>
          <div style={styles.capGrid}>
            {CAPABILITIES.map(c => (
              <div key={c.title} style={styles.capCard}>
                <div style={styles.capDot} />
                <div style={styles.capTitle}>{c.title}</div>
                <div style={styles.capDesc}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI chat showcase */}
      <section style={{ ...styles.section, paddingTop: 'var(--s9)' }}>
        <div style={styles.container}>
          <div style={styles.aiGrid}>
            <div>
              <div style={styles.eyebrow}>ai data analyst</div>
              <h2 className="h2">
                talk to the<br/>
                <span style={{ color: YELLOW }}>numbers.</span>
              </h2>
              <p style={styles.body}>
                every connector you wire up becomes a tool claude can read.
                ask a question in plain english, get a cited answer in seconds.
              </p>
            </div>
            <div style={styles.chatPanel}>
              {[
                { role: 'you', text: 'how did shopify perform last month?' },
                { role: 'claude', text: 'revenue was £42,180 across 318 orders (aov £132.65). up 18% vs prior period. top product: cast iron skillet. conversion held at 3.2%. one anomaly — paid search traffic dropped 22% in week 3, worth investigating google ads.' },
                { role: 'you', text: 'what should we do about it?' },
                { role: 'claude', text: 'google ads spend was flat but impressions fell. likely quality score drop or competition on brand terms. audit negatives, check bid-strategy changes around 14th.' },
              ].map((m, i) => (
                <div key={i} style={{ marginBottom: 'var(--s4)', display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: m.role === 'you' ? YELLOW : '#a3e635', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 50 }}>{m.role}</span>
                  <span style={{ color: m.role === 'you' ? '#e5e7eb' : MUTED, fontSize: 'var(--fs-body)', lineHeight: 1.55 }}>{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SVG 4 — Müller-Brockmann check grid (replaces the large logo) */}
      <PatternImage src="/patterns/muller-brockmann-check.svg" alt="" />

      {/* Integrations */}
      <section style={styles.section}>
        <div style={styles.container}>
          <h2 className="h2" style={{ marginBottom: 'var(--s8)' }}>connects to what you already use.</h2>
          <div style={styles.integGrid}>
            {INTEGRATIONS.map(name => (
              <div key={name} style={styles.integCell}>{name}</div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={styles.section}>
        <div style={styles.container}>
          <h2 className="h2" style={{ marginBottom: 'var(--s2)' }}>pricing.</h2>
          <div style={{ ...styles.body, marginBottom: 'var(--s7)', color: YELLOW }}>
            no setup fees. cancel anytime.
          </div>
          <div style={styles.priceGrid}>
            {PLANS.map(p => (
              <div key={p.name} style={{
                ...styles.priceCard,
                ...(p.highlight ? styles.priceCardHi : {}),
              }}>
                {p.highlight && <div style={styles.priceFlag}>most popular</div>}
                <div style={styles.priceName}>{p.name}</div>
                <div style={styles.priceFig}>
                  <span style={{ fontSize: 'var(--fs-display)', fontWeight: 800, letterSpacing: -2 }}>{p.price}</span>
                  <span style={{ fontSize: 'var(--fs-title)', color: MUTED, marginLeft: 'var(--s1)' }}>{p.period}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-body)', color: MUTED, marginBottom: 'var(--s6)' }}>{p.blurb}</div>
                <ul style={styles.priceList}>
                  {p.features.map(f => <li key={f} style={styles.priceFeat}><Arrow size={11} /> <span>{f}</span></li>)}
                </ul>
                <a href="#waitlist" style={p.highlight ? styles.pillWhite : styles.pillOutline}>
                  {p.cta}{p.highlight ? <DarkArrow /> : <Arrow />}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" style={{ ...styles.section, paddingTop: 'var(--s10)', paddingBottom: 'var(--s10)', textAlign: 'center' }}>
        <div style={{ ...styles.container, maxWidth: 620 }}>
          <h2 className="h2" style={{ textAlign: 'center' }}>
            get early access.
          </h2>
          <p style={{ ...styles.body, textAlign: 'center', marginBottom: 'var(--s8)' }}>
            we&apos;re opening to a small group of agencies first. drop your email and we&apos;ll be in touch.
          </p>
          {done ? (
            <div style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${WHITE}`, borderRadius: 'var(--r-sm)', padding: 'var(--s5) var(--s6)', color: WHITE, fontWeight: 600 }}>
              you&apos;re on the list. we&apos;ll be in touch.
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', gap: 'var(--s2)', maxWidth: 480, margin: '0 auto' }}>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@agency.com"
                style={styles.emailInput}
              />
              <button type="submit" style={styles.pillWhite}>join waitlist<DarkArrow /></button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="row end">
        <div style={styles.container}>
          <img src="/logo-black.gif" alt="October Communications" style={{ height: 40, display: 'block', marginBottom: 'var(--s6)' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s7)', fontSize: 'var(--fs-caption)', color: MUTED }}>
            <div>october communications · octobercomms.com</div>
            <a href="#what" style={{ color: MUTED, textDecoration: 'none' }}>what it does</a>
            <a href="#how" style={{ color: MUTED, textDecoration: 'none' }}>how it works</a>
            <a href="#pricing" style={{ color: MUTED, textDecoration: 'none' }}>pricing</a>
            <Link to="/login" style={{ color: MUTED, textDecoration: 'none' }}>log in</Link>
            <a href="mailto:hello@octobercomms.com" style={{ color: MUTED, textDecoration: 'none' }}>contact</a>
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'rgba(255,255,255,0.3)', marginTop: 'var(--s6)' }}>
            © {new Date().getFullYear()} october communications ltd. company no. 8816416. vat no. gb 176 6335 82.
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── PATTERN BREAKS ──────────────────────────────────────────────────────

// Bounded to the same 1140px container as the rest of the page so the
// pattern reads as part of the layout rather than a full-bleed banner.
function PatternImage({ src, alt }) {
  return (
    <div style={{ background: BLACK }}>
      <div style={styles.container}>
        <img src={src} alt={alt} style={{ width: '100%', display: 'block' }} />
      </div>
    </div>
  );
}

function CheckerboardBreak() {
  // Kept as inline SVG — the user explicitly approved the original
  // ("first svg - the squares you have") so the implementation stays
  // identical, just bounded to 1140 like everything else.
  const cell = 60;
  const rows = 3, cols = 19;     // 19 × 60 = 1140
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const fill = (x + y) % 2 === 0 ? YELLOW : 'transparent';
      cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fill} />);
    }
  }
  return (
    <div style={{ background: BLACK }}>
      <div style={styles.container}>
        <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
          {cells}
        </svg>
      </div>
    </div>
  );
}

// ─── REUSABLE BITS ───────────────────────────────────────────────────────

function HowStep({ n, title, body }) {
  return (
    <div style={styles.howStep}>
      <div style={styles.howN}>{n}</div>
      <div style={styles.howTitle}>{title}</div>
      <p style={styles.howBody}>{body}</p>
    </div>
  );
}

// ─── CONTENT ─────────────────────────────────────────────────────────────

const CAPABILITIES = [
  { title: 'ai data analyst', desc: 'plain-english chat over every connector. cited answers in seconds.' },
  { title: 'automated reports', desc: 'monthly and weekly pdfs written by claude, sent on schedule. branded, on-message.' },
  { title: 'social storyboards', desc: 'nine posts at a time, frame-by-frame, grounded in trends and your past winners.' },
  { title: 'ad creative', desc: 'concepts in pas/aida/social-proof frameworks. rendered across every aspect ratio.' },
  { title: 'seo suite', desc: 'rank tracking, search console, ai overview presence, content gaps, planning briefs.' },
  { title: 'outreach', desc: 'cold-email sequences written by claude. ai-classified replies. unsubscribe handled.' },
  { title: 'video templates', desc: 'remotion renders your intro / word cards / outro — one click, on brand.' },
  { title: 'approval flow', desc: 'shareable preview links. clients approve per post or per concept without logging in.' },
];

const INTEGRATIONS = [
  'google analytics 4', 'google ads', 'google search console', 'google merchant center',
  'meta ads', 'instagram insights', 'shopify', 'amazon seller central',
  'klaviyo', 'brevo', 'shopify email', 'zoho inventory',
  'cin7', 'dataforseo', 'apify', 'replicate',
  'ideogram', 'adobe firefly', 'elevenlabs', 'arcads',
];

const PLANS = [
  {
    name: 'starter', price: '£149', period: '/mo', highlight: false,
    blurb: 'for small agencies or in-house teams getting started.',
    features: ['up to 3 clients', '10 integrations per client', 'ai data analyst', 'weekly + monthly reports', 'seo rank tracking (100 keywords)', 'email support'],
    cta: 'join waitlist',
  },
  {
    name: 'agency', price: '£349', period: '/mo', highlight: true,
    blurb: 'the full platform for growing agencies.',
    features: ['unlimited clients', 'all integrations', 'ai data analyst + ads advisor', 'social + ad creative generation', 'video templates via remotion', 'seo rank tracking (unlimited)', 'priority support'],
    cta: 'join waitlist',
  },
  {
    name: 'enterprise', price: 'custom', period: '', highlight: false,
    blurb: 'for large agencies and in-house teams.',
    features: ['everything in agency', 'white-label reports', 'custom integrations', 'dedicated onboarding', 'sla & uptime guarantee', 'team access & permissions'],
    cta: 'get in touch',
  },
];

// ─── STYLES ──────────────────────────────────────────────────────────────

const styles = {
  // Single container for the whole page — header, content, footer all
  // share the same 1140px max-width with consistent side padding.
  container: { maxWidth: MAX_W, margin: '0 auto', padding: '0 var(--s6)', width: '100%', boxSizing: 'border-box' },

  topBar: { background: BLACK, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  topBarInner: { padding: 'var(--s4) 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  topLink: { color: WHITE, textDecoration: 'none', fontWeight: 400 },

  section: { background: BLACK, padding: 'var(--s10) 0' },
  thinSection: { background: BLACK, padding: 'var(--s5) 0', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' },

  eyebrow: { fontSize: 'var(--fs-caption)', color: YELLOW, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 'var(--s5)' },
  h1: { fontSize: 'clamp(40px, 6vw, 78px)', fontWeight: 800, margin: 0, letterSpacing: -2.5, lineHeight: 1.02 },
  h2: { fontSize: 'clamp(32px, 4.2vw, 56px)', fontWeight: 800, margin: '0 0 var(--s6)', letterSpacing: -1.8, lineHeight: 1.05 },
  heroLede: { fontSize: 'clamp(15px, 1.2vw, 18px)', color: MUTED, maxWidth: 720, marginTop: 'var(--s7)', lineHeight: 1.55 },
  body: { fontSize: 'var(--fs-body)', color: MUTED, lineHeight: 1.75, margin: '0 0 var(--s5)' },

  // White CTA pill — solid white background, dark text. The primary
  // action everywhere.
  pillWhite: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: WHITE, color: BLACK, padding: 'var(--s3) var(--s6)', borderRadius: 'var(--r-pill)',
    fontWeight: 700, fontSize: 'var(--fs-body)', textDecoration: 'none', border: 'none',
    cursor: 'pointer', fontFamily: FONT,
  },
  pillWhiteSm: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: WHITE, color: BLACK, padding: 'var(--s2) var(--s4)', borderRadius: 'var(--r-pill)',
    fontWeight: 700, fontSize: 'var(--fs-caption)', textDecoration: 'none', border: 'none',
    cursor: 'pointer', fontFamily: FONT,
  },
  // White-outlined pill — used as the secondary action throughout.
  pillOutline: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: WHITE, padding: 'var(--s3) var(--s6)', borderRadius: 'var(--r-pill)',
    fontWeight: 600, fontSize: 'var(--fs-body)', textDecoration: 'none',
    border: `1.5px solid ${WHITE}`, cursor: 'pointer', fontFamily: FONT,
  },

  audienceInner: { display: 'flex', gap: 'var(--s7)', alignItems: 'center', flexWrap: 'wrap' },
  audienceChip: { fontSize: 'var(--fs-body)', color: WHITE, letterSpacing: 0.2 },

  threeCol: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 1fr 1fr', gap: 'var(--s9)' },

  howGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s6)' },
  howStep: { background: BLACK, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--r-sm)', padding: 'var(--s7)' },
  howN: { fontSize: 'var(--fs-caption)', color: YELLOW, fontWeight: 800, letterSpacing: 1.5, marginBottom: 'var(--s5)' },
  howTitle: { fontSize: 'var(--fs-section)', fontWeight: 800, color: WHITE, letterSpacing: -0.8, marginBottom: 'var(--s3)' },
  howBody: { fontSize: 'var(--fs-body)', color: MUTED, lineHeight: 1.7, margin: 0 },

  aiGrid: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 1.6fr', gap: 'var(--s9)', alignItems: 'flex-start' },
  chatPanel: { background: '#161616', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--r-sm)', padding: 'var(--s6)' },

  capGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--s1)',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  capCard: { background: BLACK, padding: 'var(--s6)', minHeight: 140 },
  capDot: { width: 10, height: 10, borderRadius: 'var(--r-sm)', background: YELLOW, marginBottom: 'var(--s4)' },
  capTitle: { fontSize: 'var(--fs-title)', fontWeight: 700, color: WHITE, marginBottom: 'var(--s2)', letterSpacing: -0.2 },
  capDesc: { fontSize: 'var(--fs-body)', color: MUTED, lineHeight: 1.6 },

  integGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--s1)',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  integCell: { background: BLACK, padding: 'var(--s5) var(--s5)', fontSize: 'var(--fs-body)', color: WHITE, fontWeight: 500 },

  priceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 'var(--s6)' },
  priceCard: { background: BLACK, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--r-sm)', padding: 'var(--s7)', position: 'relative' },
  priceCardHi: { boxShadow: `inset 0 0 0 2px ${WHITE}` },
  priceFlag: { position: 'absolute', top: -10, left: 24, background: WHITE, color: BLACK, fontSize: 'var(--fs-caption)', fontWeight: 800, padding: 'var(--s1) var(--s3)', borderRadius: 'var(--r-pill)', textTransform: 'uppercase', letterSpacing: 0.5 },
  priceName: { fontSize: 'var(--fs-body)', fontWeight: 700, color: YELLOW, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 'var(--s3)' },
  priceFig: { display: 'flex', alignItems: 'baseline', marginBottom: 'var(--s2)' },
  priceList: { listStyle: 'none', padding: 0, margin: '0 0 var(--s7)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' },
  priceFeat: { fontSize: 'var(--fs-body)', color: MUTED, display: 'flex', gap: 'var(--s1)', alignItems: 'center', lineHeight: 1.5 },

  emailInput: { flex: 1, padding: 'var(--s3) var(--s5)', borderRadius: 'var(--r-pill)', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)', color: WHITE, fontSize: 'var(--fs-body)', outline: 'none', fontFamily: FONT },

  footer: { background: BLACK, borderTop: '1px solid rgba(255,255,255,0.08)', padding: 'var(--s8) 0' },
};
