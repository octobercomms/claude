import React, { useState } from 'react';
import { Link } from 'react-router-dom';

// Sister-site treatment to octobercomms.com — black-dominated layout,
// single yellow accent, geometric patterns between content sections,
// lowercase typography. All emojis stripped out so the design reads as
// a deliberate family member rather than a generic SaaS landing page.

const YELLOW = '#E7CD41';
const BLACK = '#0d0d0d';
const WHITE = '#ffffff';
const MUTED = 'rgba(255,255,255,0.55)';
const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

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
    <div style={{ fontFamily: FONT, color: WHITE, background: BLACK, lineHeight: 1.5 }}>

      {/* Brand strip — top */}
      <header style={styles.topBar}>
        <div style={styles.topBarInner}>
          <span style={styles.brandTag}>october communications</span>
          <nav style={{ display: 'flex', gap: 18, fontSize: 13 }}>
            <a href="#what" style={styles.topLink}>what it does</a>
            <a href="#how" style={styles.topLink}>how it works</a>
            <a href="#pricing" style={styles.topLink}>pricing</a>
            <Link to="/login" style={{ ...styles.topLink, color: YELLOW, fontWeight: 700 }}>log in ↗</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroInner}>
          <div style={styles.eyebrow}>marketing intelligence</div>
          <h1 style={styles.h1}>
            every client's data,<br/>
            <span style={{ color: YELLOW }}>in one place,</span><br/>
            with claude on top.
          </h1>
          <p style={styles.heroLede}>
            a platform built by october communications for ambitious marketing teams.
            ecommerce, sales, email, seo, ads and outreach — pulled live from the tools you already use,
            then turned into reports, social, ad creative and answers you can actually use.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 36 }}>
            <a href="#waitlist" style={styles.pillPrimary}>join the waitlist ↗</a>
            <a href="#what" style={styles.pillGhost}>see what it does</a>
          </div>
        </div>
      </section>

      {/* Yellow pattern break — checkerboard */}
      <CheckerboardBreak />

      {/* Audience nav strip */}
      <section style={styles.audienceStrip}>
        <div style={styles.audienceInner}>
          <span style={styles.audienceArrow}>↗</span>
          {['agencies', 'in-house teams', 'consultancies', 'studios', 'founders'].map(a => (
            <span key={a} style={styles.audienceChip}>{a}</span>
          ))}
        </div>
      </section>

      {/* What it does — three columns of copy on black */}
      <section id="what" style={styles.copyBlock}>
        <div style={styles.copyInner}>
          <div style={styles.colSmall}>
            <h2 style={styles.h2}>
              one platform.<br/>
              <span style={{ color: YELLOW }}>every client.</span>
            </h2>
            <a href="#waitlist" style={styles.pillSmall}>book a call</a>
            <div style={{ marginTop: 14 }}>
              <a href="#pricing" style={{ ...styles.topLink, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: YELLOW, fontWeight: 700 }}>↗</span> pricing
              </a>
            </div>
          </div>
          <div style={styles.colMid}>
            <p style={styles.body}>
              we are the only platform that connects your client's data sources, runs ai-grounded analysis,
              and turns the output into reports, social, ad creative and outreach — all in one login.
            </p>
            <p style={styles.body}>
              the work that took your team a week now takes an afternoon. the analysis that needed a senior analyst
              now happens in plain english. and the strategy that hid behind dashboards now sits in one tab.
            </p>
          </div>
          <div style={styles.colMid}>
            <p style={styles.body}>
              we are deeply passionate about marketing operations and their potential to transform agencies.
              we don't pretend to replace strategy — we replace the work that gets in the way of it.
            </p>
            <p style={styles.body}>
              every connector, every model, every prompt is built to give creative directors, account managers
              and founders back the time they should be spending on the work that actually moves the needle.
            </p>
          </div>
        </div>
      </section>

      {/* Triangles pattern break */}
      <TrianglesBreak />

      {/* Testimonial-ish — what people say */}
      <section style={styles.quoteBlock}>
        <div style={styles.quoteInner}>
          <div style={styles.quoteCard}>
            <div style={styles.caseBadge}>case</div>
            <p style={styles.quoteText}>
              "we worked closely with october communications on reporting, ai analysis, ecommerce and seo —
              and saw a great return on the investment. we highly recommend october."
            </p>
          </div>
          <div style={styles.quoteCard}>
            <p style={styles.quoteText}>
              "the team are great professionals to collaborate with — they are responsive, creative
              and always open to exploring together new ideas, and take constructive feedback on board."
            </p>
            <div style={{ marginTop: 24, fontSize: 12, color: MUTED, letterSpacing: 0.5 }}>
              scenario / architecture
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={styles.copyBlock}>
        <div style={styles.howInner}>
          <h2 style={{ ...styles.h2, marginBottom: 32 }}>
            three things, in sequence.
          </h2>
          <div style={styles.howGrid}>
            <HowStep n="01" title="connect" body="oauth or paste an api key. one click to wire up google, meta, shopify, klaviyo, brevo, amazon, zoho — and a dozen more. one connection unlocks every tool inside that family." />
            <HowStep n="02" title="ask" body="the ai data analyst answers questions in plain english. 'why did traffic drop last week?' 'which campaign is dropping in roas?' 'summarise this month for the board.' real numbers, cited." />
            <HowStep n="03" title="ship" body="reports written by claude and sent by the platform. social posts with full storyboards. ad creative across every aspect ratio. cold outreach with auto-classified replies. one login, every deliverable." />
          </div>
        </div>
      </section>

      {/* Stars / sparkle pattern break */}
      <SparkleBreak />

      {/* Capability grid */}
      <section style={styles.copyBlock}>
        <div style={styles.copyInner}>
          <div style={{ width: '100%' }}>
            <h2 style={styles.h2}>
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
        </div>
      </section>

      {/* AI chat showcase — black on black with yellow accent */}
      <section style={{ ...styles.copyBlock, paddingTop: 60 }}>
        <div style={styles.aiInner}>
          <div style={styles.colSmall}>
            <div style={styles.eyebrow}>ai data analyst</div>
            <h2 style={styles.h2}>
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
              <div key={i} style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: m.role === 'you' ? YELLOW : '#a3e635', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 50 }}>{m.role}</span>
                <span style={{ color: m.role === 'you' ? '#e5e7eb' : MUTED, fontSize: 13, lineHeight: 1.55 }}>{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Big yellow dots composition */}
      <DotsBreak />

      {/* Integrations */}
      <section style={styles.copyBlock}>
        <div style={styles.copyInner}>
          <div style={{ width: '100%' }}>
            <h2 style={styles.h2}>connects to what you already use.</h2>
            <div style={styles.integGrid}>
              {INTEGRATIONS.map(name => (
                <div key={name} style={styles.integCell}>{name}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={styles.copyBlock}>
        <div style={styles.copyInner}>
          <div style={{ width: '100%' }}>
            <h2 style={styles.h2}>
              pricing.
              <span style={{ color: YELLOW, fontSize: 22, fontWeight: 400, marginLeft: 18, letterSpacing: 0 }}>
                no setup fees. cancel anytime.
              </span>
            </h2>
            <div style={styles.priceGrid}>
              {PLANS.map(p => (
                <div key={p.name} style={{
                  ...styles.priceCard,
                  ...(p.highlight ? styles.priceCardHi : {}),
                }}>
                  {p.highlight && <div style={styles.priceFlag}>most popular</div>}
                  <div style={styles.priceName}>{p.name}</div>
                  <div style={styles.priceFig}>
                    <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: -2 }}>{p.price}</span>
                    <span style={{ fontSize: 16, color: MUTED, marginLeft: 4 }}>{p.period}</span>
                  </div>
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 26 }}>{p.blurb}</div>
                  <ul style={styles.priceList}>
                    {p.features.map(f => <li key={f} style={styles.priceFeat}><span style={{ color: YELLOW }}>↗</span> {f}</li>)}
                  </ul>
                  <a href="#waitlist" style={p.highlight ? styles.pillPrimary : styles.pillGhost}>{p.cta} ↗</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" style={{ ...styles.copyBlock, paddingTop: 100, paddingBottom: 100, textAlign: 'center' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <h2 style={{ ...styles.h2, textAlign: 'center' }}>
            get early access.
          </h2>
          <p style={{ ...styles.body, textAlign: 'center', marginBottom: 36 }}>
            we're opening to a small group of agencies first. drop your email and we'll be in touch.
          </p>
          {done ? (
            <div style={{ background: 'rgba(231,205,65,0.1)', border: `1px solid ${YELLOW}`, borderRadius: 4, padding: '18px 24px', color: YELLOW, fontWeight: 600 }}>
              you're on the list. we'll be in touch.
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', gap: 8, maxWidth: 480, margin: '0 auto' }}>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@agency.com"
                style={styles.emailInput}
              />
              <button type="submit" style={styles.pillPrimary}>join waitlist ↗</button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, fontSize: 12, color: MUTED }}>
            <div>october communications · octobercomms.com</div>
            <a href="#what" style={{ color: MUTED, textDecoration: 'none' }}>what it does</a>
            <a href="#how" style={{ color: MUTED, textDecoration: 'none' }}>how it works</a>
            <a href="#pricing" style={{ color: MUTED, textDecoration: 'none' }}>pricing</a>
            <Link to="/login" style={{ color: MUTED, textDecoration: 'none' }}>log in</Link>
            <a href="mailto:hello@octobercomms.com" style={{ color: MUTED, textDecoration: 'none' }}>contact</a>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 22 }}>
            © {new Date().getFullYear()} october communications ltd. company no. 8816416. vat no. gb 176 6335 82.
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── PATTERN BREAKS (decorative svg) ──────────────────────────────────────

function CheckerboardBreak() {
  const cell = 60;
  const rows = 3, cols = 18;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const fill = (x + y) % 2 === 0 ? YELLOW : 'transparent';
      cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fill} />);
    }
  }
  return (
    <div style={{ background: BLACK, lineHeight: 0 }}>
      <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="none">
        {cells}
      </svg>
    </div>
  );
}

function TrianglesBreak() {
  const cell = 80;
  const rows = 2, cols = 14;
  const tris = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const isYellow = (x + y) % 2 === 0;
      const fill = isYellow ? YELLOW : 'transparent';
      // Right-triangle, alternating orientation
      const flipped = (x + y) % 4 < 2;
      const p = flipped
        ? `${x * cell},${y * cell} ${(x + 1) * cell},${y * cell} ${x * cell},${(y + 1) * cell}`
        : `${(x + 1) * cell},${y * cell} ${(x + 1) * cell},${(y + 1) * cell} ${x * cell},${(y + 1) * cell}`;
      tris.push(<polygon key={`${x}-${y}`} points={p} fill={fill} />);
    }
  }
  return (
    <div style={{ background: BLACK, lineHeight: 0 }}>
      <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="none">
        {tris}
      </svg>
    </div>
  );
}

function SparkleBreak() {
  // Four-point yellow stars scattered across a band — feels like the
  // octobercomms.com "original thinkers" lead-in.
  const points = [];
  const rng = (i) => Math.sin(i * 9301 + 49297) * 233280;
  const r = (i) => ((rng(i) - Math.floor(rng(i))) + 1) % 1;
  for (let i = 0; i < 22; i++) {
    const cx = 5 + r(i) * 95;
    const cy = 15 + r(i + 1) * 70;
    const s = 12 + r(i + 2) * 14;
    points.push({ cx, cy, s });
  }
  return (
    <div style={{ background: BLACK, lineHeight: 0, padding: '40px 0' }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: 120, display: 'block' }} preserveAspectRatio="none">
        {points.map((p, i) => (
          <g key={i} transform={`translate(${p.cx} ${p.cy}) scale(${p.s / 100})`}>
            {/* 4-point star = two crossed diamonds approximated with a curve */}
            <path d="M0,-30 C5,-5 5,-5 30,0 C5,5 5,5 0,30 C-5,5 -5,5 -30,0 C-5,-5 -5,-5 0,-30 Z" fill={YELLOW} />
          </g>
        ))}
      </svg>
    </div>
  );
}

function DotsBreak() {
  // Composition of overlapping yellow circles — references the big
  // "1101" graphic from the site.
  const dots = [
    { cx: 18, cy: 50, r: 36 },
    { cx: 38, cy: 50, r: 36 },
    { cx: 58, cy: 50, r: 36 },
    { cx: 78, cy: 50, r: 36 },
  ];
  return (
    <div style={{ background: BLACK, lineHeight: 0, padding: '20px 0' }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: 220, display: 'block' }} preserveAspectRatio="none">
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={YELLOW} />
        ))}
        {/* Centres cut out for the inner ring effect */}
        {dots.map((d, i) => (
          <circle key={`c${i}`} cx={d.cx} cy={d.cy} r={d.r * 0.55} fill={BLACK} />
        ))}
      </svg>
    </div>
  );
}

// ─── REUSABLE BITS ────────────────────────────────────────────────────────

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
  topBar: { background: BLACK, borderBottom: `1px solid rgba(255,255,255,0.08)` },
  topBarInner: { maxWidth: 1240, margin: '0 auto', padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  brandTag: { fontSize: 12, color: MUTED, letterSpacing: 0.5 },
  topLink: { color: WHITE, textDecoration: 'none', fontWeight: 400 },

  hero: { background: BLACK, padding: '90px 32px 110px' },
  heroInner: { maxWidth: 1240, margin: '0 auto' },
  eyebrow: { fontSize: 12, color: YELLOW, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 20 },
  h1: { fontSize: 'clamp(40px, 6.2vw, 84px)', fontWeight: 800, margin: 0, letterSpacing: -2.5, lineHeight: 1.02 },
  heroLede: { fontSize: 'clamp(15px, 1.2vw, 18px)', color: MUTED, maxWidth: 720, marginTop: 32, lineHeight: 1.55 },
  pillPrimary: { display: 'inline-block', background: YELLOW, color: BLACK, padding: '11px 22px', borderRadius: 999, fontWeight: 700, fontSize: 13, textDecoration: 'none', border: 'none', cursor: 'pointer', letterSpacing: 0 },
  pillGhost: { display: 'inline-block', background: 'transparent', color: WHITE, padding: '10px 22px', borderRadius: 999, fontWeight: 600, fontSize: 13, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.35)', cursor: 'pointer' },
  pillSmall: { display: 'inline-block', background: YELLOW, color: BLACK, padding: '9px 18px', borderRadius: 999, fontWeight: 700, fontSize: 12, textDecoration: 'none' },

  audienceStrip: { background: BLACK, padding: '24px 32px', borderTop: `1px solid rgba(255,255,255,0.08)`, borderBottom: `1px solid rgba(255,255,255,0.08)` },
  audienceInner: { maxWidth: 1240, margin: '0 auto', display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' },
  audienceArrow: { color: YELLOW, fontWeight: 700, fontSize: 18 },
  audienceChip: { fontSize: 14, color: WHITE, letterSpacing: 0.2 },

  copyBlock: { background: BLACK, padding: '90px 32px' },
  copyInner: { maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 1fr 1fr', gap: 48 },
  colSmall: { },
  colMid: { },
  h2: { fontSize: 'clamp(32px, 4.4vw, 58px)', fontWeight: 800, margin: '0 0 24px', letterSpacing: -1.8, lineHeight: 1.05 },
  body: { fontSize: 14, color: MUTED, lineHeight: 1.75, margin: '0 0 18px' },

  quoteBlock: { background: BLACK, padding: '0 32px 90px' },
  quoteInner: { maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' },
  quoteCard: { background: BLACK, padding: 38, position: 'relative' },
  caseBadge: { position: 'absolute', top: 24, right: 24, background: YELLOW, color: BLACK, fontSize: 11, fontWeight: 800, padding: '4px 14px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 },
  quoteText: { fontSize: 18, color: WHITE, lineHeight: 1.5, margin: 0, letterSpacing: -0.3, fontWeight: 500 },

  howInner: { maxWidth: 1240, margin: '0 auto' },
  howGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, marginTop: 32 },
  howStep: { background: BLACK, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: 28 },
  howN: { fontSize: 11, color: YELLOW, fontWeight: 800, letterSpacing: 1.5, marginBottom: 18 },
  howTitle: { fontSize: 26, fontWeight: 800, color: WHITE, letterSpacing: -0.8, marginBottom: 12 },
  howBody: { fontSize: 14, color: MUTED, lineHeight: 1.7, margin: 0 },

  aiInner: { maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 1.6fr', gap: 48, alignItems: 'flex-start' },
  chatPanel: { background: '#161616', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: 22 },

  capGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)', marginTop: 18 },
  capCard: { background: BLACK, padding: 26, minHeight: 140 },
  capDot: { width: 10, height: 10, borderRadius: 5, background: YELLOW, marginBottom: 14 },
  capTitle: { fontSize: 16, fontWeight: 700, color: WHITE, marginBottom: 8, letterSpacing: -0.2 },
  capDesc: { fontSize: 13, color: MUTED, lineHeight: 1.6 },

  integGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)', marginTop: 18 },
  integCell: { background: BLACK, padding: '20px 18px', fontSize: 13, color: WHITE, fontWeight: 500 },

  priceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 22, marginTop: 28 },
  priceCard: { background: BLACK, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: 32, position: 'relative' },
  priceCardHi: { borderColor: YELLOW, background: '#0f0f0f' },
  priceFlag: { position: 'absolute', top: -10, left: 24, background: YELLOW, color: BLACK, fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceName: { fontSize: 13, fontWeight: 700, color: YELLOW, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 },
  priceFig: { display: 'flex', alignItems: 'baseline', marginBottom: 6 },
  priceList: { listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 8 },
  priceFeat: { fontSize: 13, color: MUTED, display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 },

  emailInput: { flex: 1, padding: '12px 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)', color: WHITE, fontSize: 14, outline: 'none', fontFamily: FONT },

  footer: { background: BLACK, borderTop: '1px solid rgba(255,255,255,0.08)', padding: '40px 32px' },
  footerInner: { maxWidth: 1240, margin: '0 auto' },
};
