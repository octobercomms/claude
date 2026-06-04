// Social suite overview — the app-like landing card. Dark surface,
// terracotta accent (the Social suite colour), big bold typography,
// a hero metric row, then the 6-step loop with one state-aware next
// action surfaced as the primary CTA.
//
// Per-client dismissible: after dismiss the explainer hides but the
// loop + next-action stay so the AM still sees where they are.

import React, { useState, useEffect } from 'react';
import Card from './ui/Card';
import Button from './ui/Button';
import Chip from './ui/Chip';
import { palette, space, type, radius, shadow } from '../styles/tokens';
import Sparkline from './Sparkline';

const ACCENT = palette.suite.social;
const SOFT = palette.suiteSoft.social;

const STEPS = [
  { key: 'competitors', label: 'Competitors',  short: 'Brainstorms get smarter when Claude can see who you\'re benchmarking against.' },
  { key: 'brainstorm',  label: 'Ideas',        short: '9 posts at a time, grounded in your brand + trends + competitor hooks.' },
  { key: 'schedule',    label: 'Schedule',     short: 'Bulk-schedule the ones you like, or open one for a deep-dive plan.' },
  { key: 'media',       label: 'Media',        short: 'Finished reels / images go in the Drive folder. Captions are auto-generated.' },
  { key: 'publish',     label: 'Publish',      short: 'IG, Facebook, LinkedIn — the cron picks up scheduled plans every 5 min.' },
  { key: 'learn',       label: 'Learn',        short: 'Heater posts (2× median reach) feed back into the next brainstorm.' },
];

export default function SocialSuiteOverview({
  clientId, client, batches, posts, plans, competitors, winners,
  competitorPosts, sparkline,
  onAddCompetitor, onGenerate, onBulkSchedule, onOpenPlan, onOpenHookVault,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const storageKey = `social-overview-dismissed-${clientId}`;
  useEffect(() => { setCollapsed(localStorage.getItem(storageKey) === '1'); }, [storageKey]);
  function dismiss() { localStorage.setItem(storageKey, '1'); setCollapsed(true); }
  function expand() { localStorage.removeItem(storageKey); setCollapsed(false); }

  // State detection
  const hasCompetitors = (competitors?.length || 0) > 0;
  const hasBrainstorm = (batches?.length || 0) > 0 && (posts?.length || 0) > 0;
  const scheduledPlans = (plans || []).filter(p => p.scheduled_at);
  const hasScheduled = scheduledPlans.length > 0;
  const hasDriveFolder = scheduledPlans.some(p => p.target_platforms?.length);
  const hasPosted = (plans || []).some(p => Array.isArray(p.publications) && p.publications.some(x => x.status === 'posted'));
  const hasWinners = (winners?.length || 0) > 0;
  const status = { competitors: hasCompetitors, brainstorm: hasBrainstorm, schedule: hasScheduled, media: hasDriveFolder, publish: hasPosted, learn: hasWinners };
  const currentKey = STEPS.find(s => !status[s.key])?.key || 'humming';

  // Hero metrics derived from existing data — no new queries.
  const totalReach30 = (sparkline || []).reduce((n, p) => n + (Number(p.reach) || 0), 0);
  const totalInteractions30 = (sparkline || []).reduce((n, p) => n + (Number(p.interactions) || 0), 0);
  const publishedCount = (plans || []).reduce((n, p) => {
    const pubs = Array.isArray(p.publications) ? p.publications : [];
    return n + pubs.filter(x => x.status === 'posted').length;
  }, 0);
  const heaterCount = (winners || []).filter(w => w.is_heater).length;

  const next = nextAction({ currentKey, onAddCompetitor, onGenerate, onBulkSchedule, onOpenHookVault, batchesCount: batches?.length || 0, scheduledCount: scheduledPlans.length });

  return (
    <div style={{ marginBottom: space[7] }}>
      {/* HERO — display title + accent rule + lead in */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: space[5], gap: space[6], flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...type.caption, color: ACCENT }}>Social Suite</div>
          <div style={{ ...type.display, color: palette.text, marginTop: space[2] }}>
            {client?.name || 'Client'}
          </div>
          <div style={{ ...type.body, color: palette.textMuted, marginTop: space[2], maxWidth: 540 }}>
            Brainstorm, plan, schedule, publish, learn. The autopilot runs the loop — you steer.
          </div>
        </div>
        {client?.social_autopilot_paused && (
          <Chip tone="warning" style={{ alignSelf: 'flex-start' }}>Autopilot paused</Chip>
        )}
      </div>

      {/* METRIC ROW — hero numbers for this client */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: space[3], marginBottom: space[5] }}>
        <HeroMetric label="Reach · 30d"        value={formatNum(totalReach30)} sparkline={(sparkline || []).map(p => p.reach)} />
        <HeroMetric label="Engagement · 30d"   value={formatNum(totalInteractions30)} sparkline={(sparkline || []).map(p => p.interactions)} />
        <HeroMetric label="Published"          value={publishedCount} />
        <HeroMetric label="🔥 Heaters"         value={heaterCount} />
      </div>

      {/* NEXT ACTION — the single most-important thing the AM should do */}
      <Card padding={space[5]} style={{ background: SOFT, border: `1px solid ${ACCENT}33` }}>
        <div style={{ display: 'flex', gap: space[5], alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px' }}>
            <div style={{ ...type.caption, color: ACCENT }}>Next up</div>
            <div style={{ ...type.h1, color: palette.text, marginTop: space[2] }}>{next.title}</div>
            <div style={{ ...type.body, color: palette.textMuted, marginTop: space[2] }}>{next.body}</div>
          </div>
          {next.action && (
            <Button variant="primary" accent={ACCENT} size="lg" onClick={next.action.onClick}>
              {next.action.label}
            </Button>
          )}
        </div>
      </Card>

      {/* LOOP — six steps, completed in green-mint, current in accent */}
      <div style={{ marginTop: space[6] }}>
        <div style={{ ...type.caption, color: palette.textSubtle, marginBottom: space[3] }}>The loop</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: space[2] }}>
          {STEPS.map((s, i) => {
            const done = status[s.key];
            const current = s.key === currentKey;
            const bg = done ? 'rgba(113,198,168,0.10)' : current ? SOFT : palette.surface;
            const border = done ? palette.success : current ? ACCENT : palette.border;
            const dot = done ? '✓' : (i + 1);
            const dotBg = done ? palette.success : current ? ACCENT : palette.surfaceRaised;
            const dotFg = done || current ? palette.textOnAccent : palette.textMuted;
            return (
              <div key={s.key} style={{
                background: bg, border: `1px solid ${border}`,
                borderRadius: radius.md, padding: space[4],
                position: 'relative', minHeight: 86,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: radius.pill,
                  background: dotBg, color: dotFg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, marginBottom: space[2],
                }}>{dot}</div>
                <div style={{ ...type.h3, color: palette.text }}>{s.label}</div>
                <div style={{ ...type.bodyXs, color: palette.textMuted, marginTop: 4, lineHeight: 1.4 }}>{s.short}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* EXPLAINER — collapsible learn-more */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: space[3] }}>
        {collapsed ? (
          <button type="button" onClick={expand} style={ghostLink}>Show how this works</button>
        ) : (
          <button type="button" onClick={dismiss} style={ghostLink}>Hide loop description</button>
        )}
      </div>
    </div>
  );
}

function HeroMetric({ label, value, sparkline }) {
  return (
    <Card padding={space[4]}>
      <div style={{ ...type.caption, color: palette.textSubtle }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space[2] }}>
        <div style={{ ...type.metric, color: palette.text }}>{value}</div>
        {Array.isArray(sparkline) && sparkline.length > 1 && (
          <Sparkline values={sparkline} width={70} height={22} stroke={ACCENT} />
        )}
      </div>
    </Card>
  );
}

function nextAction({ currentKey, onAddCompetitor, onGenerate, onBulkSchedule, onOpenHookVault, batchesCount, scheduledCount }) {
  switch (currentKey) {
    case 'competitors':
      return {
        title: 'Add 3-6 competitors to start',
        body: 'Brainstorms get sharper when Claude can see whose hooks to model against. Paste a handle or two — you can change them anytime.',
        action: { label: 'Add competitors →', onClick: () => onAddCompetitor?.() },
      };
    case 'brainstorm':
      return {
        title: 'Generate your first batch',
        body: 'Claude proposes 9 posts grounded in your brand brief, Google Trends, and what your competitors shipped this week.',
        action: { label: 'Generate 9 posts →', onClick: () => onGenerate?.() },
      };
    case 'schedule':
      return {
        title: `${batchesCount} batch${batchesCount === 1 ? '' : 'es'} waiting — schedule the winners`,
        body: 'Tick the posts you like, pick a cadence, the autopilot takes over. Default Mon/Wed/Fri at 10am works for most brands.',
        action: { label: 'Bulk schedule →', onClick: () => onBulkSchedule?.() },
      };
    case 'media':
      return {
        title: `${scheduledCount} plan${scheduledCount === 1 ? '' : 's'} live on the calendar — now drop the media`,
        body: 'Finished reels and images go in each plan\'s Drive folder. Captions are auto-generated per platform at publish time.',
        action: null,
      };
    case 'publish':
      return {
        title: 'Waiting for the scheduled time',
        body: 'The autopilot cron runs every 5 minutes. When a plan\'s slot opens, captions are generated, media is fetched, and posts go live.',
        action: null,
      };
    case 'learn':
      return {
        title: 'Posts are live — engagement rolls in over 24-48h',
        body: 'Once data comes back, the Winners panel below shows your top performers. Heaters (2× the 30-day median) feed the next batch.',
        action: { label: 'Open Hook Vault →', onClick: () => onOpenHookVault?.() },
      };
    default:
      return {
        title: '🔥 The loop is humming',
        body: 'Every brainstorm now grounds on what\'s worked. Time to ship the next batch.',
        action: { label: 'Generate next batch →', onClick: () => onGenerate?.() },
      };
  }
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

const ghostLink = {
  background: 'none', border: 'none', color: palette.textSubtle,
  fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
  padding: 0,
};
