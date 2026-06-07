import React, { useState } from 'react';

// Operator's manual for the platform. Available to every signed-in user
// — viewers benefit from understanding what the AM sees too. Bullets,
// not prose; accordions per page so it's easy to jump to a specific
// area without scrolling through the whole guide. Inline SVG workflow
// diagrams on the pages where the data flow is non-obvious.

const WORKFLOWS = {
  social: {
    title: 'Social post lifecycle',
    steps: [
      { label: 'Brief',          sub: 'Briefing + monthly focus + optional AM brief' },
      { label: 'Generate 9',     sub: 'Claude + trends + competitors + winners' },
      { label: 'Render assets',  sub: 'Images · voiceover · A/C/G clips · UGC' },
      { label: 'Production brief', sub: 'Printable shot list for filming' },
      { label: 'Publish',        sub: 'AM posts to IG/TT, pastes URL back' },
      { label: 'Engagement loop', sub: 'Daily refresh → winners → next batch' },
    ],
  },
  ad: {
    title: 'Ad creative production',
    steps: [
      { label: 'Brand assets',   sub: 'Logo · palette · product photos · guidelines' },
      { label: 'Generate concepts', sub: 'Claude → 8 PAS/AIDA/Social Proof/… ideas' },
      { label: 'Render images',  sub: 'Flux / Ideogram / Firefly per aspect ratio' },
      { label: 'Fan out',        sub: 'Adobe Photoshop generative resize → all sizes' },
      { label: 'Share for approval', sub: 'Token link → client approves per concept' },
    ],
  },
  report: {
    title: 'Report generation',
    steps: [
      { label: 'Template',       sub: 'Edit-with-Claude builder, lock when right' },
      { label: 'Preview',        sub: 'Live data + narratives, no PDF, no email' },
      { label: 'Generate',       sub: 'Same pipeline + PDF render + email send' },
      { label: 'Recipients',     sub: 'Per-client list, monthly + weekly separate' },
    ],
  },
  vss: {
    title: 'Video Style System sequence',
    steps: [
      { label: 'A · Hook',       sub: '2-4s text on black' },
      { label: 'B · Talk',       sub: '10-15s talking head' },
      { label: 'C · Word',       sub: '1-2s punctuation' },
      { label: 'B · Talk',       sub: 'cut back to anchor' },
      { label: 'E · B-roll',     sub: '5-12s voiceover over footage' },
      { label: 'B · Talk',       sub: 'anchor again' },
      { label: 'F · Prop',       sub: '3-6s tactile close-up' },
      { label: 'G · CTA',        sub: '3-5s kinetic close' },
    ],
  },
};

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'The 30-second overview.',
    body: [
      'Two roles: **Admin** (you / Daniel) sees everything; **Viewer** (e.g. the demo user) sees only the clients you assign them.',
      'Every client has its own context: connectors (data sources), brand assets, briefing, monthly focus, report template, social/ad batches.',
      'The platform pulls live data when you click; it doesn\'t store dashboards. That means every refresh is "as of right now" and never stale, but live API calls cost real money.',
      'Most actions are pay-per-use (Claude, DataForSEO, Replicate, etc.) rather than subscription. Track spend on **Settings → Costs & usage**.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    summary: 'The home page. Quick view of every active client.',
    body: [
      'One card per active client showing last report sent, connector health, and next scheduled report.',
      'Alert strip flags expired Meta tokens — click to re-authorise from the connector page.',
      'Use it as a morning standup: spot anything red, fix it before the report runs.',
    ],
  },
  {
    id: 'clients',
    title: 'Clients list',
    summary: 'Add and manage every brand you work with.',
    body: [
      'Click **+ New client** to add. Slug is the URL-safe identifier — keep it short and lowercase.',
      'Set the **briefing field** properly — Claude leans on it for every report, social post, and ad concept. A weak briefing = generic output.',
      'Set the **monthly focus** at the start of each month. It overrides the briefing for that period and threads through narratives.',
    ],
  },
  {
    id: 'client-details',
    title: 'Client → Details',
    summary: 'The brief that grounds everything Claude writes for this client.',
    body: [
      '**Domain** is required for SEO, AI Overview tracking, and any "research this brand" action.',
      '**Briefing** = the elevator pitch + tone of voice. Claude reads this on every report, social batch, ad batch, and chat reply. Be specific.',
      '**Monthly focus** is the directive for this month. It overrides general guidance ("we\'re launching X", "stop pushing Y").',
      '**Recipients** is who the report emails go to. Per type (monthly / weekly), one address per line.',
      '**Schedule** controls when scheduled reports run. Day-of-week for weekly, day-of-month for monthly.',
      '**Ads margin** is your gross-margin assumption used in profit calculations on the Paid page.',
    ],
  },
  {
    id: 'client-ai',
    title: 'Client → AI Data Analyst',
    summary: 'Ask Claude anything about this client\'s live performance data.',
    body: [
      'A chat interface backed by tool-using Claude. Asks like "compare Shopify revenue last 4 weeks vs the prior 4" or "which campaign is dropping in ROAS?" return real numbers, not vibes.',
      'Claude can pull from every connector configured for this client. It cites the connector and period in its answers.',
      'Use the chat to **investigate** before changing strategy. The conversation history shapes future reports — anything you flag as "important" gets pulled into the next monthly executive summary.',
    ],
  },
  {
    id: 'organic',
    title: 'Client → Organic (was SEO)',
    summary: 'Keyword tracking, Search Console, AI Overviews, content gaps, planning.',
    body: [
      '**Keywords tab** is the core: rank tracking via DataForSEO. Rank checks run every 3 days automatically.',
      'Each keyword shows current position, previous, best ever, intent tag (Informational/Navigational/Commercial/Transactional), SERP features observed (Snippet / PAA / Images), and AIO presence.',
      'Click the **⊞** button next to any keyword for **full position history** scrollable with no date cap.',
      '**Classify Intent** runs Claude over all active keywords in one batch — tags each one I / N / C / T.',
      '**Search Console tab** pulls top queries, top pages, devices, and sitemap status from the existing GSC OAuth. Free.',
      '**AI Overviews tab** tracks whether Google shows an AIO for each keyword and whether the brand is cited. Auto-refreshes weekly; "Check now" forces a fresh pull (~£0.10).',
      '**Content Gaps tab** runs DataForSEO Domain Intersection against up to 5 competitor domains the AM adds. Returns keywords competitors rank for that you don\'t.',
      '**Planning tab** generates Claude-written content briefs for any target keyword (title, outline, headings, questions to answer, meta tags).',
    ],
  },
  {
    id: 'paid',
    title: 'Client → Paid (was Ads)',
    summary: 'Spend, ROAS, and Claude-generated ad creative.',
    workflow: WORKFLOWS.ad,
    body: [
      '**Performance tab** = live Google Ads + Meta Ads numbers. Gross margin field flows into profit calcs.',
      '**Creative tab** generates direct-response ad concepts using PAS / AIDA / Before-After / Social Proof / FOMO frameworks.',
      'Each concept: headline + body + CTA + visual concept. Grounded in the brand assets you select.',
      'Click **Render images** on a concept to generate visuals via Replicate (Flux), Ideogram, or Adobe Firefly across multiple aspect ratios.',
      'Hover any rendered image → **↔ button** fans it out to every other aspect ratio via Adobe Photoshop generative resize.',
      '**Share for approval** generates a shareable link for the client to review concepts in their browser without logging in.',
    ],
  },
  {
    id: 'social',
    title: 'Client → Social',
    summary: 'Generate 9 posts at a time with full storyboards.',
    workflow: WORKFLOWS.social,
    body: [
      '**Generate 9 posts** kicks off a batch grounded in: the client\'s briefing, Google Trends rising signals, the client\'s competitor handles, trending TikTok sounds (if Apify is set up), and the client\'s past winners (engagement from published posts).',
      'Each post: hook, caption, hashtags, visual concept, **frame-by-frame storyboard** with A-G style codes from the Video Style System.',
      '**Style badges** on each frame: A=text hook · B=talking head · C=word card · D=screen reveal · E=b-roll · F=prop · G=kinetic CTA.',
      '**Production brief** button → printable shot list with style filming notes + teleprompter for B-section voiceovers. Take this on set.',
      '**Render A/C/G clips** → Remotion auto-renders the no-film templates (open, word cards, close) as MP4s you drop onto the CapCut timeline. Saves ~20 min/video.',
      '**Generate image** → Replicate / Ideogram / Adobe Firefly per post.',
      '**Generate voiceover** → ElevenLabs text-to-speech of the storyboard\'s voiceover lines.',
      '**Generate UGC video** → Arcads talking-head video. Use as a fallback when filming isn\'t possible.',
      '**Mark published** → paste the live Instagram/TikTok URL after posting. Engagement auto-pulls daily (IG); the winners panel feeds back into the next batch.',
      '**Trending sounds bar** → "Refresh" pulls top TikTok sounds via Apify (~£0.20). Cached 7 days.',
      '**Winners panel** at the top shows top performers + framework engagement breakdown (PAS at 8.2%, AIDA at 5.1%, etc).',
      '**Share for approval** generates a shareable link for the client to review the batch.',
    ],
  },
  {
    id: 'vss',
    title: 'Video Style System (reference)',
    summary: 'The 7-style grammar Claude uses when storyboarding reels.',
    workflow: WORKFLOWS.vss,
    body: [
      '**A** opens every reel: bold text on black, 2-4s. No filming.',
      '**B** is the anchor: talking head, fixed setup, RØDE mic, 10-15s per section.',
      '**C** is punctuation: a 1-word slate between B sections. Use 2-3 per reel max.',
      '**D** is evidence: a 4-8s laptop screen close-up. Once per reel max.',
      '**E** is context: 5-12s of B-roll with voiceover continuing. Use uploaded clips from the Brand bank.',
      '**F** is tactile: 3-6s hand-with-prop close-up. Use uploaded props from the Brand library.',
      '**G** closes every reel: animated CTA on black, 3-5s. Brand-coloured.',
      'Sequence rule: A opens, G closes. Between them, B is the anchor; cut away to C/D/E/F so no shot runs more than ~15s.',
    ],
  },
  {
    id: 'brand',
    title: 'Client → Brand',
    summary: 'Asset library that grounds every Social and Paid generation.',
    body: [
      'Upload once, reuse across Social, Paid, and reports.',
      '**Logos** — PNG/SVG/JPEG. Used as overlay reference.',
      '**Product images** — hero shots, lifestyle photography. Image generators use them as reference.',
      '**Fonts** — WOFF/TTF. For Adobe Photoshop overlays.',
      '**Palette** — hex codes. Image generators and Remotion templates pick the primary colour from here.',
      '**Guidelines** — free-form notes on voice / do\'s and don\'ts. Passed to Claude verbatim.',
      '**B-roll bank** — short MP4/MOV clips for Style E (project sites, walking shots, etc.). Bulk upload supported.',
      '**Prop library** — photos for Style F (drawings, notebooks, samples). Bulk upload supported.',
      'Claude references uploaded B-roll and prop names directly in storyboards so the AM knows which existing asset to use.',
    ],
  },
  {
    id: 'sales-traffic',
    title: 'Client → Sales & Traffic',
    summary: 'GA4 + e-commerce data, side by side.',
    body: [
      'Combined view of GA4 sessions + Shopify/Amazon revenue.',
      'Date range picker top-right; defaults to last 30 days.',
      'Channels breakdown shows what\'s actually converting.',
    ],
  },
  {
    id: 'outreach',
    title: 'Client → Email (Outreach)',
    summary: 'Cold-email campaigns with Claude-generated sequences.',
    body: [
      '**Contacts** — manual add or bulk paste. Tag by location, role, contact type.',
      '**Campaigns** — define the angle and audience filter. Claude generates the sequence (subject + body for each step).',
      '**Audience refinement** — Claude can re-shape the audience based on a brief.',
      '**Launch** sends the first email immediately to the matched audience; the scheduler handles follow-ups.',
      'Replies hit the IMAP inbox configured in Settings, get classified by Claude, and unsubscribe matching contacts automatically.',
      'Open-tracking pixel + reply detection feed the Overview system-status panel.',
    ],
  },
  {
    id: 'outreach-setup',
    title: 'Client → Email — setup & integrations',
    summary: 'The keys and DNS records the Email suite needs to send.',
    body: [
      '**Claude AI** — powers audience refinement, email writing and reply classification. Needs a paid Anthropic API key from console.anthropic.com → add credit → create a key → paste into **Settings → AI & Email → Claude AI**.',
      '**Hunter.io** — finds published email addresses by company domain (free plan: 50/month). Sign up → Dashboard → API → paste the key into **Settings → Outreach → October Outreach**.',
      '**Icypeas** — lead database with PAYG credits that never expire; primary finder alongside Hunter. Copy **API Key, API Secret and User ID** (all three) from Settings → API into **Settings → Outreach → October Outreach**.',
      '**Email sending — Amazon SES** — low cost (~$0.10 / 1,000) and good deliverability. Verify your sending domain, leave sandbox mode, create an IAM user with `ses:SendEmail`, and save its Access Key ID + Secret into **Settings → AI & Email → Amazon SES** (the platform uses SESv2 automatically).',
      '**SPF / DKIM / DMARC** — the three DNS records that decide inbox vs junk. SPF for SES: `v=spf1 include:amazonses.com -all`. DKIM = three CNAMEs from the SES console. DMARC starter: `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`. The live status shows on the Email → Overview panel.',
      '**Reply polling (IMAP)** — use a dedicated reply inbox (e.g. replies@yourbrand.com). For Gmail, enable IMAP and create an App Password, then add host `imap.gmail.com`, port `993`, user + password to **Settings → Outreach → Outreach Reply Inbox**.',
    ],
  },
  {
    id: 'forms',
    title: 'Client → Forms',
    summary: 'October Forms (WordPress) funnel data.',
    body: [
      'Pick a form ID on the Connectors tab first.',
      'Shows views, starts, partials, completes, and the full funnel breakdown.',
      'Submissions browser pulls the full answer table for any submission.',
      'Data renders directly from the WordPress API in the browser (the server\'s IP is blocked by the host).',
    ],
  },
  {
    id: 'reports',
    title: 'Client → Reports',
    summary: 'Templated PDF reports that go to the client.',
    workflow: WORKFLOWS.report,
    body: [
      'Reports run on a per-client template designed via the **Edit with Claude** template builder.',
      'Template = ordered list of sections: narrative (Claude writes), metrics_grid (numbers), connector_table (auto), bar_chart, position_distribution (SEO).',
      'Each metrics_grid section can have `compare: "yoy"` for year-on-year comparisons.',
      '**Preview weekly / Preview monthly** runs the whole pipeline (Claude narratives + live data) and renders the report inline so you can iterate without sending email or generating a PDF.',
      'First preview = 20-60s. Subsequent previews in the same window = seconds (cached).',
      '**Generate weekly / monthly** runs the full pipeline + builds the PDF + emails the recipients.',
      'Reports auto-send on the schedule set in Details.',
    ],
  },
  {
    id: 'connectors',
    title: 'Client → Connectors',
    summary: 'Wire up the client\'s data sources once.',
    body: [
      'OAuth providers (Google, Meta, Shopify, Zoho, Amazon) → click **Connect** → popup → done. One Google OAuth unlocks GA4, GSC, Ads, Merchant Center together.',
      'API-key providers (Klaviyo, Brevo, October Forms) → paste credentials.',
      'For Shopify per-client apps: tick "This client has their own app" and enter the per-client API Key + Secret (avoids the single-Partners-account limit).',
      'After connecting, pick the property/account/list from the dropdown.',
      '**Diagnose** shows the scopes actually granted; useful when a connector misbehaves.',
    ],
  },
  {
    id: 'rankings',
    title: 'Rankings',
    summary: 'Cross-client SEO overview.',
    body: [
      'Top-level view of every keyword across every client.',
      'Use it for "which clients moved the most this week?" without clicking through each one.',
    ],
  },
  {
    id: 'settings',
    title: 'Settings (admin only)',
    summary: 'Platform-wide credentials, costs, and your account.',
    body: [
      '**Costs & usage** panel at the top — latest balance / monthly spend per pay-per-use provider. Auto-refreshes nightly at 02:00; "Refresh now" forces a poll.',
      '**Account** — change your own password.',
      '**Platform keys** by category — Claude, image gen, ad platforms, outreach, email, reports.',
      'For Anthropic spend tracking specifically, add an `ANTHROPIC_ADMIN_KEY` alongside the regular Claude API key.',
      'OAuth scopes for Shopify + Meta are shown inline with copy-all buttons — paste them straight into the provider\'s app configuration.',
    ],
  },
  {
    id: 'manage',
    title: 'Manage (admin only)',
    summary: 'Add and remove users.',
    body: [
      '+ Add user — username, password, role (admin or viewer), assigned clients.',
      'Viewer role sees only the clients you tick. Admin sees everything.',
      'Use the demo viewer pattern for sales calls — create a "demo" user, assign one client, walk the prospect through it.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips that pay back',
    summary: 'A handful of things you only learn after a week.',
    body: [
      '**Use Preview before Generate** for reports. PDFs take a minute and burn Claude tokens; previews use cached data and render in seconds.',
      '**Upload brand assets early.** Every generation gets better when there\'s real product photography + a palette to anchor visuals.',
      '**Mark published posts.** The performance loop is the single best lever for improving Social output, and it\'s entirely dependent on you pasting URLs in.',
      '**Use the AI Data Analyst for diagnostics** before changing strategy. It\'s faster than clicking around dashboards and the answers are cited.',
      '**Watch Costs & usage weekly.** API spend creeps up. Best signal that a flow is being overused.',
      '**Re-prompt templates rather than starting fresh.** The template builder cumulative chat is fine — keep iterating on the same template; lock when it\'s right.',
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
