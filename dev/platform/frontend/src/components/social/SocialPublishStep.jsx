import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Social Pipeline → Publish. Read-only view of what the autopilot is
// about to ship + what it already shipped this week. The actual posting
// is cron-driven (services/scheduler.js picks up scheduled plans every
// 5 min) so there's nothing to do here — this step exists so AMs can
// SEE the loop closing, and intervene (pause autopilot, edit a plan)
// from the surfaced links.
export default function SocialPublishStep({ plans = [], client, onPauseToggle, onOpenPlan, onNext, onBack }) {
  const now = Date.now();
  const upcoming = (plans || [])
    .filter(p => p.scheduled_at && new Date(p.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 20);
  const recent = (plans || [])
    .filter(p => Array.isArray(p.publications) && p.publications.some(pub => pub.status === 'posted'))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 20);
  const paused = !!client?.social_autopilot_paused;

  return (
    <PipelineStep
      num={3} title="Publish" onNext={onNext} nextLabel="Learn from results"
      tagline="The autopilot publishes scheduled plans to every channel every 5 minutes. Pause it from the top bar if you need to hold the queue."
    >
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="caption">Autopilot</div>
          <div className="h3 mt-2">{paused ? 'Paused' : 'Live — publishing on schedule'}</div>
          <p className="body-sm text-muted mt-2">
            {paused
              ? 'Scheduled plans will not publish until autopilot is resumed.'
              : 'Cron runs every 5 minutes. When a plan\'s slot opens, captions are generated, media fetched, and posts go live to IG / Facebook / LinkedIn.'}
          </p>
        </div>
        {onPauseToggle && (
          <button onClick={onPauseToggle} className={`btn ${paused ? 'btn-primary' : 'btn-secondary'}`}>
            {paused ? 'Resume autopilot' : 'Pause autopilot'}
          </button>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="caption mb-3">Upcoming ({upcoming.length})</div>
          {!upcoming.length ? (
            <p className="body-sm text-subtle">Nothing scheduled. Lock and schedule posts on step 2 to fill the queue.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {upcoming.map(p => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--card-border)', fontSize: 13 }}>
                  <button onClick={() => onOpenPlan?.(p.id)} className="btn btn-ghost btn-sm" style={{ padding: 0, color: 'var(--text)', textAlign: 'left' }}>
                    {p.title || p.angle || 'Untitled post'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    {new Date(p.scheduled_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="caption mb-3">Recently published ({recent.length})</div>
          {!recent.length ? (
            <p className="body-sm text-subtle">Nothing has shipped yet. Once the first scheduled plan reaches its slot, it'll appear here.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {recent.map(p => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--card-border)', fontSize: 13 }}>
                  <button onClick={() => onOpenPlan?.(p.id)} className="btn btn-ghost btn-sm" style={{ padding: 0, color: 'var(--text)', textAlign: 'left' }}>
                    {p.title || p.angle || 'Untitled post'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--positive)', fontWeight: 700 }}>
                    {(p.publications || []).filter(pub => pub.status === 'posted').length}× posted
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PipelineStep>
  );
}
