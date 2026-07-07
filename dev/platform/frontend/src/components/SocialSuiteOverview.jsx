// Social suite overview — terracotta-accented landing card. The
// .suite-social scope is applied higher up in ClientSocialPage so this
// component just consumes --accent. Two-tone: white text + terracotta
// accent. No inline styles.

import React from 'react';
import Card from './ui/Card';
import Button from './ui/Button';
import Chip from './ui/Chip';
import Sparkline from './Sparkline';

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
  onAddCompetitor, onGenerate, onBulkSchedule, onOpenHookVault,
}) {
  const hasCompetitors = (competitors?.length || 0) > 0;
  const hasBrainstorm = (batches?.length || 0) > 0 && (posts?.length || 0) > 0;
  const scheduledPlans = (plans || []).filter(p => p.scheduled_at);
  const hasScheduled = scheduledPlans.length > 0;
  const hasDriveFolder = scheduledPlans.some(p => p.target_platforms?.length);
  const hasPosted = (plans || []).some(p => Array.isArray(p.publications) && p.publications.some(x => x.status === 'posted'));
  const hasWinners = (winners?.length || 0) > 0;
  const status = { competitors: hasCompetitors, brainstorm: hasBrainstorm, schedule: hasScheduled, media: hasDriveFolder, publish: hasPosted, learn: hasWinners };
  const currentKey = STEPS.find(s => !status[s.key])?.key || 'humming';

  const totalReach30 = (sparkline || []).reduce((n, p) => n + (Number(p.reach) || 0), 0);
  const totalInteractions30 = (sparkline || []).reduce((n, p) => n + (Number(p.interactions) || 0), 0);
  const publishedCount = (plans || []).reduce((n, p) => {
    const pubs = Array.isArray(p.publications) ? p.publications : [];
    return n + pubs.filter(x => x.status === 'posted').length;
  }, 0);
  const heaterCount = (winners || []).filter(w => w.is_heater).length;

  const next = nextAction({
    currentKey, onAddCompetitor, onGenerate, onBulkSchedule, onOpenHookVault,
    batchesCount: batches?.length || 0, scheduledCount: scheduledPlans.length,
  });

  const completedSteps = STEPS.filter(s => status[s.key]).length;

  return (
    <div className="mb-7">
      {/* Status pills row — at-a-glance state across the loop. The
          launchpad black hero that used to live above this row was
          removed; the Overview tab already does the suite pitch, so
          repeating it on Performance was duplicate surface. */}
      {client?.social_autopilot_paused && (
        <div className="callout" style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--warning)', marginBottom: 'var(--s5)' }}>
          Autopilot is paused — toggle from the top bar to resume scheduled publishing.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        <StatusPill label="Autopilot" value={client?.social_autopilot_paused ? 'Paused' : 'Live'}
          tone={client?.social_autopilot_paused ? 'warning' : 'positive'} />
        <StatusPill label="Competitors" value={hasCompetitors ? `${competitors.length} tracked` : 'None yet'}
          tone={hasCompetitors ? 'positive' : 'warning'} />
        <StatusPill label="Loop" value={`${completedSteps} / ${STEPS.length} steps`}
          tone={completedSteps === STEPS.length ? 'positive' : 'default'} />
        {publishedCount > 0 && <StatusPill label="Published" value={publishedCount} tone="positive" />}
      </div>

      <div className="metric-grid">
        <HeroMetric label="Reach · 30d"      value={formatNum(totalReach30)} sparkline={(sparkline || []).map(p => p.reach)} />
        <HeroMetric label="Engagement · 30d" value={formatNum(totalInteractions30)} sparkline={(sparkline || []).map(p => p.interactions)} />
        <HeroMetric label="Published"        value={publishedCount} />
        <HeroMetric label="🔥 Heaters"       value={heaterCount} accent />
      </div>

      <Card variant="accent">
        <div className="row wrap" style={{ alignItems: 'center', gap: 'var(--s5)' }}>
          <div style={{ flex: '1 1 380px' }}>
            <div className="caption">Next up</div>
            <h2 className="h1 mt-2">{next.title}</h2>
            <p className="body mt-2">{next.body}</p>
          </div>
          {next.action && (
            <Button size="lg" onClick={next.action.onClick}>{next.action.label}</Button>
          )}
        </div>
      </Card>

      <div className="mt-6">
        <div className="caption caption-muted mb-3">Pipeline</div>
        <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {STEPS.map((s, i) => (
            <LoopStep key={s.key} step={s} index={i} done={status[s.key]} current={s.key === currentKey} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoopStep({ step, index, done, current }) {
  const variant = done ? 'outline' : current ? 'accent' : 'default';
  const dot = done ? '✓' : index + 1;
  return (
    <Card variant={variant}>
      <Chip tone={done ? 'success' : current ? 'accent' : 'neutral'}>{dot}</Chip>
      <div className="h3 mt-2">{step.label}</div>
      <p className="body-xs mt-2">{step.short}</p>
    </Card>
  );
}

function HeroMetric({ label, value, sparkline, accent }) {
  return (
    <div className={`metric-card ${accent ? 'accent' : ''}`}>
      <div className="caption">{label}</div>
      <div className="metric-row">
        <div className="metric">{value}</div>
        {Array.isArray(sparkline) && sparkline.length > 1 && (
          <Sparkline values={sparkline} width={70} height={22} />
        )}
      </div>
    </div>
  );
}

function nextAction({ currentKey, onAddCompetitor, onGenerate, onBulkSchedule, onOpenHookVault, batchesCount, scheduledCount }) {
  switch (currentKey) {
    case 'competitors':
      return {
        title: 'Add 3-10 competitors to start',
        body: 'Brainstorms get sharper when Claude can see whose hooks to model against.',
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

function StatusPill({ label, value, tone }) {
  const dotColour = tone === 'positive' ? 'var(--positive)'
                  : tone === 'warning'  ? 'var(--warning)'
                  : tone === 'negative' ? 'var(--negative)'
                  : 'var(--text-subtle)';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 14px', fontSize: 13, fontWeight: 600,
        borderRadius: 'var(--r-pill)',
        background: 'var(--surface)',
        border: 'var(--border-w) solid var(--card-border)',
      }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColour }} />
      <strong style={{ fontWeight: 700 }}>{label}</strong>
      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{value}</span>
    </span>
  );
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}
