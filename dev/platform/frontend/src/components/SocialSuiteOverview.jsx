// Top-of-Social-tab overview. Shows the suite as a 6-step loop, marks
// which steps the AM has completed for THIS client, and surfaces a
// single next-action CTA based on what's missing. Designed to replace
// the previous static description paragraph with a state-aware nudge
// so new clients don't get lost in the toolbar.
//
// Dismissal is per-client (localStorage). After dismissing, the loop
// stays visible at half height as a quick-reference but the verbose
// "how this works" body hides.

import React, { useState, useEffect } from 'react';

const STEPS = [
  { key: 'competitors', label: 'Add competitors',  icon: '①', short: 'Brainstorms get smarter when Claude can see who you\'re benchmarking against.' },
  { key: 'brainstorm',  label: 'Generate ideas',   icon: '②', short: '9 posts at a time, grounded in your brand + Google Trends + competitor hooks.' },
  { key: 'schedule',    label: 'Schedule',         icon: '③', short: 'Bulk-schedule the ones you like, or open one for a deep-dive plan.' },
  { key: 'media',       label: 'Drop media',       icon: '④', short: 'Finished reels / images go in the Drive folder. Captions are auto-generated.' },
  { key: 'publish',     label: 'Autopilot posts',  icon: '⑤', short: 'IG, Facebook, LinkedIn — the cron picks up scheduled plans every 5 min.' },
  { key: 'learn',       label: 'Engagement → next batch', icon: '⑥', short: 'Heater posts (2× median reach) feed back into the next brainstorm.' },
];

export default function SocialSuiteOverview({
  clientId, client, batches, posts, plans, competitors, winners, competitorPosts,
  onAddCompetitor, onGenerate, onBulkSchedule, onOpenPlan, onOpenHookVault,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const storageKey = `social-overview-dismissed-${clientId}`;
  useEffect(() => {
    setCollapsed(localStorage.getItem(storageKey) === '1');
  }, [storageKey]);
  function dismiss() {
    localStorage.setItem(storageKey, '1');
    setCollapsed(true);
  }
  function expand() {
    localStorage.removeItem(storageKey);
    setCollapsed(false);
  }

  // Derived state — which steps are done?
  const hasCompetitors = (competitors?.length || 0) > 0;
  const hasBrainstorm = (batches?.length || 0) > 0 && (posts?.length || 0) > 0;
  const scheduledPlans = (plans || []).filter(p => p.scheduled_at);
  const hasScheduled = scheduledPlans.length > 0;
  const hasDriveFolder = scheduledPlans.some(p => p.target_platforms?.length); // proxy — bulk-schedule sets these together
  const hasPosted = (plans || []).some(p => Array.isArray(p.publications) && p.publications.some(x => x.status === 'posted'));
  const hasWinners = (winners?.length || 0) > 0;

  const status = {
    competitors: hasCompetitors,
    brainstorm: hasBrainstorm,
    schedule: hasScheduled,
    media: hasDriveFolder,
    publish: hasPosted,
    learn: hasWinners,
  };

  // First non-done step is the current one. If everything's done, the
  // loop is humming — celebrate.
  const currentKey = STEPS.find(s => !status[s.key])?.key || 'humming';
  const next = currentNextAction({
    currentKey, status,
    onAddCompetitor, onGenerate, onBulkSchedule, onOpenPlan, onOpenHookVault,
    competitorPostsCount: (competitorPosts?.length || 0),
    scheduledCount: scheduledPlans.length,
    batchesCount: (batches?.length || 0),
  });

  return (
    <div style={styles.wrap}>
      {/* Loop row — always visible, even when dismissed. */}
      <div style={styles.row}>
        {STEPS.map((s, i) => {
          const done = status[s.key];
          const current = s.key === currentKey;
          return (
            <React.Fragment key={s.key}>
              <div style={{
                ...styles.step,
                background: done ? '#e8f5e9' : current ? '#fff8e1' : '#fafafa',
                borderColor: done ? '#a5d6a7' : current ? '#f0c860' : '#eee',
                color: done ? '#2e7d32' : current ? '#7a5a00' : '#888',
              }}>
                <div style={styles.stepIcon}>{done ? '✓' : s.icon}</div>
                <div style={styles.stepLabel}>{s.label}</div>
              </div>
              {i < STEPS.length - 1 && <div style={styles.arrow}>→</div>}
            </React.Fragment>
          );
        })}
      </div>

      {/* State-aware next action — always visible. */}
      <div style={styles.nextWrap}>
        <div style={{ flex: 1 }}>
          <div style={styles.nextLabel}>{next.title}</div>
          <div style={styles.nextBody}>{next.body}</div>
        </div>
        {next.action && (
          <button type="button" onClick={next.action.onClick} style={styles.nextBtn}>
            {next.action.label}
          </button>
        )}
      </div>

      {/* Verbose explainer — collapsed after dismiss. */}
      {!collapsed && (
        <div style={styles.explainer}>
          <div style={styles.explainerTitle}>How the social suite works</div>
          <div style={styles.explainerGrid}>
            {STEPS.map(s => (
              <div key={s.key} style={styles.explainerItem}>
                <div style={styles.explainerHead}>
                  <span style={{ color: status[s.key] ? '#2e7d32' : '#888' }}>{s.icon}</span>
                  <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{s.label}</span>
                </div>
                <div style={styles.explainerText}>{s.short}</div>
              </div>
            ))}
          </div>
          <div style={styles.explainerFooter}>
            <span>The loop closes itself — heater posts become next batch's exemplars.</span>
            <button type="button" onClick={dismiss} style={styles.dismissBtn}>Got it, hide this</button>
          </div>
        </div>
      )}
      {collapsed && (
        <div style={styles.collapsedRow}>
          <button type="button" onClick={expand} style={styles.expandBtn}>Show how it works</button>
        </div>
      )}
    </div>
  );
}

// Decide the current step's CTA. We surface ONE action so the AM
// always knows the single next thing — anything else stays as
// secondary chrome on the page.
function currentNextAction({
  currentKey, status, onAddCompetitor, onGenerate, onBulkSchedule,
  onOpenPlan, onOpenHookVault, competitorPostsCount, scheduledCount, batchesCount,
}) {
  switch (currentKey) {
    case 'competitors':
      return {
        title: 'Start by adding 3-6 competitors',
        body: 'Brainstorms get sharper when Claude can see whose hooks to model against. Paste a handle or two — you can change them anytime.',
        action: { label: '+ Add competitors', onClick: () => onAddCompetitor?.() },
      };
    case 'brainstorm':
      return {
        title: 'Generate your first brainstorm batch',
        body: 'Claude proposes 9 posts grounded in your brand brief, Google Trends signals, and what your competitors are shipping right now.',
        action: { label: 'Generate 9 posts', onClick: () => onGenerate?.() },
      };
    case 'schedule':
      return {
        title: `You have ${batchesCount} brainstorm ${batchesCount === 1 ? 'batch' : 'batches'} — schedule the good ones`,
        body: 'Tick the posts you like, pick a cadence (Mon/Wed/Fri at 10am is a sensible default), and the autopilot takes over from there.',
        action: { label: '📅 Bulk schedule', onClick: () => onBulkSchedule?.() },
      };
    case 'media':
      return {
        title: `${scheduledCount} plan${scheduledCount === 1 ? '' : 's'} scheduled — now drop the media`,
        body: 'Finished reels / images go in the Drive folder linked to each plan. The autopilot generates per-platform captions automatically.',
        action: null,
      };
    case 'publish':
      return {
        title: 'Waiting for the scheduled time',
        body: 'The autopilot cron runs every 5 minutes. When a plan\'s time arrives, captions are generated, media is fetched from Drive, and posts go live.',
        action: null,
      };
    case 'learn':
      return {
        title: 'Posts are live — engagement will roll in over 24-48h',
        body: 'Once data comes back, the Winners panel below shows your top performers and the next brainstorm will model them.',
        action: null,
      };
    default:
      return {
        title: '🔥 The loop is humming',
        body: `${competitorPostsCount > 0 ? 'Competitor scrape fresh. ' : ''}Generate the next batch when you\'re ready — every brainstorm now grounds on what\'s worked.`,
        action: { label: 'Generate next batch', onClick: () => onGenerate?.() },
      };
  }
}

const styles = {
  wrap: { background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 18 },
  row: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14, overflowX: 'auto' },
  step: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 10px', border: '1px solid', borderRadius: 6, minWidth: 110, fontSize: 11 },
  stepIcon: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  stepLabel: { fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 },
  arrow: { color: '#ccc', fontSize: 18, flexShrink: 0 },
  nextWrap: { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#fff8e1', border: '1px solid #f0c860', borderRadius: 6, marginBottom: 12 },
  nextLabel: { fontSize: 13, fontWeight: 700, color: '#7a5a00' },
  nextBody: { fontSize: 12, color: '#5d4000', marginTop: 3, lineHeight: 1.4 },
  nextBtn: { background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  explainer: { background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 },
  explainerTitle: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  explainerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 },
  explainerItem: { background: 'white', border: '1px solid #eee', borderRadius: 4, padding: '8px 10px' },
  explainerHead: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 3 },
  explainerText: { fontSize: 11, color: '#666', lineHeight: 1.5 },
  explainerFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 11, color: '#888' },
  dismissBtn: { background: 'white', color: '#666', border: '1px solid #ddd', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' },
  collapsedRow: { textAlign: 'center', marginTop: 4 },
  expandBtn: { background: 'none', color: '#888', border: 'none', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' },
};
