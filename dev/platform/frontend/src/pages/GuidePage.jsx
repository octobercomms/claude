import React, { useState } from 'react';

// Operator's manual for the platform. Available to every signed-in user
// — viewers benefit from understanding what the AM sees too. Bullets,
// not prose; accordions per page so it's easy to jump to a specific
// area without scrolling through the whole guide. Inline SVG workflow
// diagrams on the pages where the data flow is non-obvious.

const WORKFLOWS = {
  paidBuild: {
    title: 'Paid → Build (ad creative)',
    steps: [
      { label: 'Brief',   sub: 'One-line ask, grounded in the brand kit' },
      { label: 'Draft',   sub: 'Claude → concepts (PAS / AIDA / …)' },
      { label: 'Render',  sub: 'Images & video, or upload your own' },
      { label: 'Approve', sub: 'No-login client review link' },
      { label: 'Launch',  sub: 'Export to Meta / Google' },
    ],
  },
  sharedBuild: {
    title: 'Shared → Build (social)',
    steps: [
      { label: 'Ideas',     sub: '9 posts: brand + trends + competitors + winners' },
      { label: 'Brief',     sub: 'Pick one, refine the angle' },
      { label: 'Workbench', sub: 'Storyboard · images · voiceover · reels' },
      { label: 'Plan',      sub: 'Bulk-schedule across channels' },
      { label: 'Publish',   sub: 'Autopilot posts; paste the URL back' },
      { label: 'Learn',     sub: 'Winners feed the next batch' },
    ],
  },
  earned: {
    title: 'Earned (PR pipeline)',
    steps: [
      { label: 'Pitch', sub: 'Find journalists, draft the pitch' },
      { label: 'Build', sub: 'Press release / story angle' },
      { label: 'Track', sub: 'Log coverage as it lands' },
      { label: 'Share', sub: 'Coverage report to the client' },
    ],
  },
  report: {
    title: 'Report generation',
    steps: [
      { label: 'Template',   sub: 'Edit-with-Claude builder, lock when right' },
      { label: 'Preview',    sub: 'Live data + narratives, no PDF, no email' },
      { label: 'Generate',   sub: 'Same pipeline + PDF render + email send' },
      { label: 'Recipients', sub: 'Per-client list, monthly + weekly separate' },
    ],
  },
  vss: {
    title: 'Video Style System sequence',
    steps: [
      { label: 'A · Hook',   sub: '2-4s text on black' },
      { label: 'B · Talk',   sub: '10-15s talking head' },
      { label: 'C · Word',   sub: '1-2s punctuation' },
      { label: 'B · Talk',   sub: 'cut back to anchor' },
      { label: 'E · B-roll', sub: '5-12s voiceover over footage' },
      { label: 'B · Talk',   sub: 'anchor again' },
      { label: 'F · Prop',   sub: '3-6s tactile close-up' },
      { label: 'G · CTA',    sub: '3-5s kinetic close' },
    ],
  },
};

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'What OMI is, in 30 seconds.',
    body: [
      'OMI (October Marketing Intelligence) is one workspace per client that plans, makes and measures marketing across every channel — grounded in that client\'s own brand, strategy and live data.',
      'Two roles: **Admin** (you) sees everything and Settings; **Viewer** (e.g. a client login or a demo user) sees only the clients you assign, and no admin config.',
      'It pulls **live data** when you click — it doesn\'t store dashboards. Every view is "as of right now", never stale, but live API calls cost real money.',
      'Most actions are **pay-per-use** (Claude, DataForSEO, Replicate, Ideogram…) not subscription. Watch spend on **Settings → Connections → Spend (Costs & usage)**.',
      'Everything is **deep-linkable** — the active tab lives in the URL (`?tab=…`), so you can bookmark or share a link straight to any page. It reflows on mobile too.',
    ],
  },
  {
    id: 'workspace',
    title: 'How the workspace is organised',
    summary: 'The PESO map, and the shape every suite shares.',
    body: [
      'The sidebar is **Dashboard → Workspace → Settings → Guide**. Workspace is the selected client; switch clients from the header dropdown.',
      'A client\'s Workspace is split by the **PESO** model — plus Data and Admin:',
      '**Data** — the numbers (GA4 + e-commerce) and the AI Data Analyst.',
      '**Paid** — ads: spend, ROAS and Claude-made ad creative.',
      '**Earned** — PR: journalists, pitches, coverage.',
      '**Shared** — social: batches of on-brand posts, mostly on autopilot.',
      '**Owned** — SEO, content, local and the client\'s own channels (incl. email outreach).',
      '**Admin** (agency-only) — set the client up: brief, brand kit, connectors, strategy, report templates.',
      'Every suite follows the **same shape**: an **Overview** (what this suite does + a map), then a row of **stepped rails** that walk you through each group of tabs left-to-right, ending in **Measure**.',
      'On a rail, a **✓ (green)** means that step is genuinely done — derived from real data (e.g. keywords tracked, a render created, emails sent). A **number** means it\'s not done yet; an **ⓘ** marks a read-out you look at rather than a step you complete.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    summary: 'Your morning standup — every active client at a glance.',
    body: [
      'One card per active client: last report sent, connector health, and next scheduled report.',
      'Alert strip flags expired Meta / Google tokens — click to re-authorise from that client\'s **Admin → Connectors**.',
      '**API spend this month** banner (admin) — combined pay-per-use spend plus each provider\'s remaining **balance / quota** (DataForSEO credit, Hunter searches…), so you catch a low balance before it bites. **Breakdown →** opens Settings → Spend.',
      'Use it as a standup: spot anything red, fix it before the reports run.',
    ],
  },
  {
    id: 'admin',
    title: 'Admin — set a client up once',
    summary: 'Brief, brand kit, connectors, strategy, reports. Powers everything else.',
    body: [
      'Agency-only. Tabs: **Overview · Setup · Connectors · Strategy · Reports**. What you define here grounds every other suite — so ads stay on-brand, content stays on-message, and the weekly report writes itself.',
      '**Quick Start** (top of the **Setup** tab) — one click drafts the empty setup from the domain + brief: the About-this-client paragraph, the monthly focus, competitors, and starter keywords. Nothing you\'ve already filled is touched; everything is a draft to edit.',
      '**Setup** — client name, slug, **domain** (required for SEO, AI-Overview tracking and any "research this brand" action), an active/inactive toggle, and the **About this client** paragraph Claude reads on every report, post, ad and chat reply. Be specific — a weak brief = generic output. Set the **monthly focus** at the start of each month; it threads through narratives. The **brand kit** (logos, product photos, fonts, palette, guidelines, B-roll and prop libraries) lives here too and grounds every Paid + Shared generation.',
      '**Connectors** — wire up data sources once. OAuth providers (Google, Meta, Shopify, Amazon…) → **Connect** → popup → pick the property/account. One Google OAuth unlocks GA4, GSC, Ads and Merchant Center together. API-key providers → paste credentials. **Diagnose** shows the scopes actually granted.',
      '**Strategy** — the thinking behind the work: exec summary, personas, SWOT, competitor map and objectives. **✦ Tailor with Claude** adapts a house template to this client.',
      '**Reports** — the cross-channel client report builder (see the Reports section below). Report **recipients + schedule** live here; the **ads gross-margin** assumption lives on the Paid → Measure page.',
    ],
  },
  {
    id: 'data',
    title: 'Data',
    summary: 'GA4 + e-commerce, and the AI Data Analyst.',
    body: [
      'Tabs: **Overview · Dashboard · Analyst**.',
      '**Dashboard** — GA4 sessions next to Shopify / Amazon revenue, with a date-range picker and a channels breakdown so you can see what\'s actually converting.',
      '**Analyst** — a chat backed by tool-using Claude. Ask "compare Shopify revenue last 4 weeks vs the prior 4" or "which campaign is dropping in ROAS?" and get real, **cited** numbers (connector + period), not vibes. It can read every connector configured for the client.',
      'Prefix a message with **/report** to format the answer as a downloadable PDF + Word doc, and drag in a screenshot or PDF for Claude to read alongside the live data.',
      'Use it to **investigate** before changing strategy — faster than clicking around dashboards, and the answers are sourced.',
    ],
  },
  {
    id: 'paid',
    title: 'Paid',
    summary: 'Spend, ROAS, and Claude-made ad creative.',
    workflow: WORKFLOWS.paidBuild,
    body: [
      'Groups: **Overview · Advise · Build · Measure**.',
      '**Advise** — the thinking before you spend. **Briefing** is a weekly analyst read (this period vs last, with a tick-off to-do list). **Audiences** builds targetable segments from an uploaded customer-list CSV (emails/phones hashed on upload, never stored raw) or postcode data from a connected Shopify / WooCommerce store, exported as Meta Custom Audience CSVs. **Competitors** watches rival ads.',
      '**Build** — the ad-creative pipeline: **Brief → Draft → Render → Approve → Launch**. A brief produces on-brand concepts (PAS / AIDA / Before-After / Social Proof / FOMO); render images or video per aspect ratio, or **⬆ Upload your own** to use the brand\'s real photography/footage; **Approve** mints a no-login client review link; **Launch** is the export hand-off.',
      'New clients get a **worked example** batch on the Brief step — a real set of concepts drawn from the client\'s profile, badged "Example", so you can see (and show a client) what each step produces before generating your own.',
      '**Measure** — live Google Ads + Meta Ads numbers (spend, revenue, ROAS, profit). The gross-margin field flows into the profit calc.',
    ],
  },
  {
    id: 'earned',
    title: 'Earned',
    summary: 'PR — never pitch from memory or lose a hit again.',
    workflow: WORKFLOWS.earned,
    body: [
      'Groups: **Overview · Track · Pitch · Build · Share**.',
      '**Pitch** — find and profile journalists/outlets, then draft a tailored pitch with Claude.',
      '**Build** — write the press release or shape the story angle.',
      '**Track** — log coverage as it lands; the count on the tab is your live hit list. A **Coverage Monitor** watches for new mentions (needs a Serper key).',
      '**Share** — a coverage report for the client.',
    ],
  },
  {
    id: 'shared',
    title: 'Shared',
    summary: 'A month of on-brand content, mostly on autopilot.',
    workflow: WORKFLOWS.sharedBuild,
    body: [
      'Groups: **Overview · Capture · Build · Engage · Measure**.',
      '**Capture** — the swipe file: paste a reel you like, save it as an idea card, then "Use as brief" jumps into Build with the brief pre-filled.',
      '**Build** — the social factory: **Ideas → Brief → Workbench → Plan → Publish**. "Generate 9 posts" grounds a batch in the brief, Google Trends, competitor handles, trending sounds and past winners. Each post carries a **frame-by-frame storyboard** (A–G style codes — see Video Style System). Render images, voiceover (ElevenLabs), A/C/G reel clips (Remotion) or a UGC talking-head; bulk-schedule; the autopilot posts and you paste the live URL back.',
      '**Engage** — two steps: **DM bot** (configure the Instagram auto-reply persona + templates) and **Discover** (find and engage accounts).',
      '**Measure** — reads as a sequence: **Review** (your headline numbers) → **Learn** (top posts + the Hook Vault of winning hooks to reuse) → **Compare** (competitor benchmark) → **Improve** (Claude\'s "what to change next", refreshed weekly).',
      'Publishing runs on **autopilot** unless paused from the top bar.',
    ],
  },
  {
    id: 'vss',
    title: 'Video Style System (reference)',
    summary: 'The 7-style grammar Claude uses to storyboard reels.',
    workflow: WORKFLOWS.vss,
    body: [
      '**A** opens every reel: bold text on black, 2-4s. No filming.',
      '**B** is the anchor: talking head, fixed setup, 10-15s per section.',
      '**C** is punctuation: a 1-word slate between B sections. 2-3 per reel max.',
      '**D** is evidence: a 4-8s screen close-up. Once per reel max.',
      '**E** is context: 5-12s of B-roll with the voiceover continuing. Use uploaded clips from the brand B-roll bank.',
      '**F** is tactile: 3-6s hand-with-prop close-up. Use uploaded props from the brand library.',
      '**G** closes every reel: animated CTA on black, 3-5s, brand-coloured.',
      'Sequence rule: A opens, G closes. Between them B is the anchor; cut away to C/D/E/F so no shot runs more than ~15s.',
    ],
  },
  {
    id: 'owned',
    title: 'Owned',
    summary: 'Get found where buyers look — SEO, content, local, email.',
    body: [
      'The widest suite. Groups: **Overview · Search · Optimise · Build · Localise · Convert · Email**. Each group is a stepped rail; titles read as **verbs** (what you do), with the tool name in the sub-line.',
      '**Search** — where you rank and get cited: **Review** (the headline read — ranks, rank distribution, intent split, AI-Overview coverage) · **Keywords** (rank tracking via DataForSEO, every ~4 days) · **Search Console** (real Google clicks) · **AI Visibility** (share-of-voice across Claude / ChatGPT / Gemini / Perplexity) · **Authority** (domain strength) · **Backlinks** (who links to you) · **Watch** = SEO **Drift**.',
      '**Drift** ("Watch") = a saved *before* snapshot of your SEO (ranks, audit health, backlinks, authority). Capture one **before** a migration/redesign/big content change, then "Compare to now" flags anything that dropped, severity-coded — so a change can\'t quietly tank rankings unnoticed.',
      '**Optimise** — fixes that move the needle: **Scan** (site audit) · **Grade** (content audit of one page) · **Map** (keyword footprint) · **Win** (Quick wins — keywords sitting #11–20, one refresh from page 1) · **Sharpen** (CTR/title boosters) · **Target** (AI keyword targets) · **Prep** (agent readiness).',
      '**Build** — the content pipeline: **Find → Brief → Draft → Publish → Promote** (Claude-written briefs and drafts for a target keyword).',
      '**Localise** — the local-SEO toolkit (competition gap, schema audit, buyer-intent keywords, competitor X-ray, GBP ranking playbook, ranking outliers, GBP posts).',
      '**Convert** — page conversion: **CRO** (a Microsoft Clarity funnel audit with ticked-off fixes) and **Forms** (October Forms funnel data).',
      '**Email** — cold-outreach, as a **Build → Run** rail: **Find** your contact list (Hunter + Serper + library) → **Write** the sequence (Claude) → **Send** from your own domain (tracked) → **Chase** replies & follow-up tasks. Replies hit the IMAP inbox, get classified by Claude, and auto-unsubscribe matches. (Keys + SPF/DKIM/DMARC setup live in Settings.)',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    summary: 'Templated PDF reports that write themselves.',
    workflow: WORKFLOWS.report,
    body: [
      'Built on Admin → Reports. A per-client **template** designed via the **Edit with Claude** builder — an ordered list of sections: narrative (Claude writes), metrics grid, connector table, bar chart, SEO position distribution. Keep iterating on the same template; lock it when it\'s right.',
      '**Preview weekly / monthly** runs the whole pipeline (Claude narratives + live data) inline, so you iterate without sending email or burning a PDF. First preview 20-60s; repeats in the same window are cached (seconds).',
      '**Generate weekly / monthly** runs the full pipeline + builds the PDF + emails the recipients.',
      'Reports auto-send on the schedule set on the Reports tab.',
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    summary: 'Platform-wide credentials, costs and access (admin only).',
    body: [
      'Three sections, each grouped into labelled bentos: **Connections · Workspace · Account**.',
      '**Connections** — **Spend** (Costs & usage: latest balance / monthly spend per provider, colour-coded, auto-refreshed nightly at 02:00) · **Marketing data** (Ad platforms · E-commerce · SEO) · **AI & outreach** (AI models · Email sending · Outreach finders) · **Platform** (Integrations · Other).',
      'For Anthropic **spend tracking**, add an `ANTHROPIC_ADMIN_KEY` alongside the Claude key — it\'s the only provider that exposes an actual £/$ figure. Providers without a balance API (Replicate, Ideogram, Serper) are estimated from a manual checkpoint you enter.',
      '**Workspace** — **Library** (Contacts · Publications · Tags — reusable across clients) and **Templates & tools** (Strategy templates · PR Gmail add-on).',
      '**Account** — **Access**: Users & access (add users, set role, assign clients — viewers see only what you tick) and Security. Change **your own password** from the sidebar footer on any page.',
    ],
  },
  {
    id: 'connects',
    title: 'How the pieces connect',
    summary: 'Why setup once pays back everywhere.',
    body: [
      'The **brief + brand kit + strategy** (Admin) are the spine: Claude reads them on every ad concept, social post, PR pitch, report narrative and chat reply. Fill them well once and every suite gets sharper.',
      '**Connectors** feed the live numbers Data, Paid, Owned and Reports all read from — connect a source once and it shows up everywhere it\'s relevant.',
      'The **rails** turn each suite into a clear path: Overview to orient, stepped groups to work through, Measure to see what happened — with ✓ derived from real data so you can see what\'s actually done.',
      'The loop closes at **Measure / Reports**: what performed feeds the next brief (social winners → next batch, Strategist → next budget), and the client report is assembled from the same live data you\'ve been working in.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips that pay back',
    summary: 'A handful of things you only learn after a week.',
    body: [
      '**Run Quick Start on every new client.** It fills the brief, focus, competitors and starter keywords from the domain in one click — a huge head start you then edit.',
      '**Preview before Generate** for reports. PDFs take a minute and burn tokens; previews use cached data and render in seconds.',
      '**Upload brand assets early.** Every generation gets better with real product photography + a palette to anchor visuals — and you can now upload your own image/video straight onto an ad concept.',
      '**Mark published posts.** The performance loop is the single biggest lever on Shared output, and it depends on you pasting the live URL back.',
      '**Capture a Drift baseline before any site change.** It turns "did that migration hurt us?" into a one-click answer.',
      '**Use the AI Data Analyst for diagnostics** before changing strategy — faster than dashboards, and the answers are cited.',
      '**Watch Settings → Spend weekly.** Pay-per-use creeps; it\'s the best signal a flow is being overused.',
      '**Deep-link anything.** The active tab is in the URL, so bookmark or share a link straight to a client\'s Strategist brief, Drift, or Competitors view. It all works on your phone too.',
    ],
  },
];

export default function GuidePage() {
  const [open, setOpen] = useState(() => new Set(['getting-started']));
  function toggle(id) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return (
    <div>
      <div className="kicker"><span className="pip" />Help &amp; documentation</div>
      <header className="hero">
        <h1 className="display">Guide</h1>
        <p className="body mt-4">
        How each part of the platform works. Click a section to expand. Skim, or jump straight to the page you need help with.
      </p>
      </header>

      <div className="row wrap mb-5">
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
          {section.workflow && <WorkflowDiagram workflow={section.workflow} />}
          <ul className="body-sm" style={{ margin: 0, padding: '8px 0 0 18px', lineHeight: 1.65 }}>
            {section.body.map((line, i) => (
              <li key={i} style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: bolden(line) }} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Horizontal step diagram for a workflow. Each step is a labelled box;
// arrows between them. Wraps onto multiple rows on narrow viewports
// using CSS flex-wrap so it renders cleanly on phones too.
function WorkflowDiagram({ workflow }) {
  return (
    <div style={{ margin: '10px 0 14px', padding: 14, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Workflow — {workflow.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 6 }}>
        {workflow.steps.map((step, i) => (
          <React.Fragment key={i}>
            <div style={{
              flex: '1 1 130px', minWidth: 120, maxWidth: 200,
              padding: '10px 12px', background: 'var(--accent-soft)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5,
              }}>Step {i + 1}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{step.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{step.sub}</div>
            </div>
            {i < workflow.steps.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-subtle)', fontSize: 18, flexShrink: 0 }}>→</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Tiny markdown-like bolder for **text**. Avoids pulling in a markdown
// library just to render asterisks in guide bullets.
function bolden(s) {
  return String(s).replace(/[<>]/g, c => ({ '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const chip = {
  padding: '5px 12px', fontSize: 11, border: 'var(--border-w) solid var(--card-border)', background: 'var(--accent-soft)', color: 'var(--text-muted)',
  cursor: 'pointer', borderRadius: 'var(--r-pill)', fontWeight: 600,
};
