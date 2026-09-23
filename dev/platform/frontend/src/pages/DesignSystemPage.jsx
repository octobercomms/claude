import React, { useState } from 'react';
import PageShell from '../components/shells/PageShell';
import Launchpad from '../components/shells/Launchpad';
import StatStrip from '../components/shells/StatStrip';
import StepRail from '../components/shells/StepRail';
import ListDetail from '../components/shells/ListDetail';
import ChatCanvas from '../components/shells/ChatCanvas';

// Living gallery for the L1–L6 shell components + the design foundations.
// Route: /design. Renders the real components with example data so the system
// can be seen and clicked in the actual app (not a mockup).

function Frame({ code, name, note, children }) {
  return (
    <div style={{ marginBottom: 'var(--s8)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
        <span style={{ fontWeight: 800, color: 'var(--accent-on)', background: 'var(--accent)', borderRadius: 'var(--r-pill)', padding: 'var(--s1) var(--s3)', fontSize: 'var(--fs-caption)' }}>{code}</span>
        <span className="ds-shell__title">{name}</span>
        {note && <span className="ds-shell__sub">{note}</span>}
      </div>
      <div style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 'var(--pad-page)' }}>
        {children}
      </div>
    </div>
  );
}

const STATS = [
  { label: 'Net revenue', value: '£184k', delta: '12%', dir: 'up' },
  { label: 'Orders', value: '2,940', delta: '6%', dir: 'up' },
  { label: 'AOV', value: '£62.6', delta: '5%', dir: 'up' },
  { label: 'Sessions', value: '48.1k', delta: '3%', dir: 'down' },
  { label: 'Conv. rate', value: '2.4%', delta: '0.3pt', dir: 'up' },
];

const STEPS = [
  { key: 'find', label: 'Find', status: 'done' },
  { key: 'brief', label: 'Brief', status: 'done' },
  { key: 'draft', label: 'Draft' },
  { key: 'publish', label: 'Publish' },
  { key: 'promote', label: 'Promote' },
];

const PEOPLE = [
  { id: 'dg', name: 'Dana Gerber', outlet: 'Dallas Morning News', tag: 'warm', opens: 1, clicks: 30, interest: 91 },
  { id: 'az', name: 'Alexander Zemlianichenko', outlet: 'Xinhua News', tag: 'opened', opens: 12, clicks: 21, interest: 75 },
  { id: 'ae', name: 'Alexandra Ehrensperger', outlet: 'Domus Nova', tag: 'warm', opens: 8, clicks: 16, interest: 56 },
  { id: 'rm', name: 'Rina Mehta', outlet: 'ARTnews', tag: 'replied', opens: 4, clicks: 9, interest: 48 },
];

export default function DesignSystemPage() {
  const [group, setGroup] = useState('overview');
  const [step, setStep] = useState('draft');
  const [selected, setSelected] = useState(PEOPLE[0]);

  const groupTabs = ['overview', 'health', 'build'].map((k) => ({
    key: k, label: k[0].toUpperCase() + k.slice(1), active: group === k, onClick: () => setGroup(k),
  }));
  const subTabs = ['Launchpad', 'Coverage', 'Journalists'].map((l, i) => ({
    key: l, label: l, active: i === 0, onClick: () => {},
  }));

  return (
    <div style={{ maxWidth: 1040 }}>
      <div className="ds-shell__head">
        <div>
          <div className="ds-launchpad__kicker">October · Design system</div>
          <div style={{ fontSize: 'var(--fs-display)', fontWeight: 800, letterSpacing: '-0.02em', marginTop: 'var(--s1)' }}>Shell library — L1–L6</div>
          <div className="ds-shell__sub" style={{ marginTop: 'var(--s2)' }}>The six reusable page shells, rendered live from the real components. Every section is “pick a shell, fill it”.</div>
        </div>
      </div>

      {/* L1 */}
      <Frame code="L1" name="Suite Shell" note="frame · pill group-tabs · sub-tabs · body">
        <PageShell
          title="Earned"
          subtitle="Indiewalls"
          actions={<button className="btn btn-secondary btn-sm">Client ▾</button>}
          tabs={groupTabs}
          subTabs={subTabs}
        >
          <div className="card">
            <div className="ds-shell__sub" style={{ marginBottom: 'var(--s2)' }}>Active group: <strong style={{ color: 'var(--text)' }}>{group}</strong></div>
            One frame, one tab component. Click the pills — active is an ink pill, never yellow text.
          </div>
        </PageShell>
      </Frame>

      {/* L2 */}
      <Frame code="L2" name="Overview" note="process-chat + launchpad">
        <div className="card" style={{ marginBottom: 'var(--gap-comp)' }}>
          <div className="ds-launchpad__kicker" style={{ marginBottom: 'var(--s3)' }}>
            <span className="ds-launchpad__pip" style={{ background: 'var(--fn-approve)' }} />Earned — your press co-pilot
          </div>
          <div style={{ background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            The 15-year release is live — <strong>10,529 emailed</strong>, 20% opens, <strong>1,013 warm</strong>. Follow-ups on hold. Want me to do something?
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', border: 'var(--border-w) solid var(--border-neutral)', borderRadius: 'var(--r-pill)', padding: 'var(--s1) var(--s2) var(--s1) var(--s4)', alignItems: 'center' }}>
            <span className="ds-shell__sub" style={{ flex: 1 }}>Tell Earned what to do…</span>
            <button className="btn btn-primary btn-sm"></button>
          </div>
        </div>
        <Launchpad kicker="Primary next step" pipColor="var(--fn-approve)" headline="Sign off the Q4 trends release"
          cta={<div><button className="btn btn-primary">Open in Build</button></div>}>
          <StatStrip items={[
            { label: 'Published', value: 3, delta: '+2 this month', dir: 'up' },
            { label: 'Tracked', value: 12 },
            { label: 'Journalists', value: '2,740' },
            { label: '🔥 Warm', value: '1,013' },
          ]} />
        </Launchpad>
      </Frame>

      {/* L3 */}
      <Frame code="L3" name="Dashboard" note="stat strip + table">
        <StatStrip items={STATS} />
        <div className="card" style={{ marginTop: 'var(--gap-comp)' }}>
          <div className="ds-launchpad__kicker" style={{ marginBottom: 'var(--s3)' }}>Top channels</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
            <tbody>
              {[['Organic', '£71k'], ['Paid social', '£44k'], ['Email', '£39k'], ['Referral / PR', '£30k']].map(([a, b]) => (
                <tr key={a} style={{ borderTop: '1px solid var(--card-border)' }}>
                  <td style={{ padding: 'var(--s2) var(--s1)' }}>{a}</td>
                  <td style={{ padding: 'var(--s2) var(--s1)', textAlign: 'right', fontWeight: 700 }}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Frame>

      {/* L4 */}
      <Frame code="L4" name="Pipeline" note="one step-rail + step body">
        <StepRail steps={STEPS} activeKey={step} onStep={setStep} />
        <div className="card" style={{ marginTop: 'var(--gap-comp)' }}>
          <div className="ds-launchpad__kicker" style={{ marginBottom: 'var(--s2)' }}>
            <span className="ds-launchpad__pip" style={{ background: 'var(--fn-strategy)' }} />Step: {STEPS.find((s) => s.key === step)?.label}
          </div>
          <div className="ds-launchpad__headline" style={{ fontSize: 'var(--fs-title)', marginBottom: 'var(--s3)' }}>“How independent artists earn commissions in 2026”</div>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm">Generate draft</button>
            <button className="btn btn-secondary btn-sm">Edit brief</button>
            <button className="btn-link">Refine with Claude</button>
          </div>
        </div>
      </Frame>

      {/* L5 */}
      <Frame code="L5" name="Workbench" note="list + detail drawer">
        <ListDetail
          list={(
            <div className="card" style={{ padding: 'var(--s2)' }}>
              <input placeholder="Search 2,740 journalists…" style={{ width: '100%', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)', padding: 'var(--s2) var(--s3)', marginBottom: 'var(--s2)', font: 'inherit' }} />
              {PEOPLE.map((p) => (
                <button key={p.id} onClick={() => setSelected(p)} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--s3)', width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', font: 'inherit',
                  border: selected.id === p.id ? 'var(--border-w) solid var(--border-neutral)' : '1px solid transparent',
                  background: selected.id === p.id ? 'var(--surface-raised)' : 'none',
                }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 700 }}>{p.name}</span>
                    <span className="ds-shell__sub">{p.outlet}</span>
                  </span>
                  <span className={`chip ${p.tag === 'warm' ? 'chip-warning' : p.tag === 'replied' ? 'chip-success' : ''}`}>{p.tag}</span>
                </button>
              ))}
            </div>
          )}
          detail={(
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 'var(--fs-title)' }}>{selected.name}</div>
              <div className="ds-shell__sub" style={{ marginBottom: 'var(--s3)' }}>{selected.outlet}</div>
              <StatStrip items={[
                { label: 'Clicks', value: selected.clicks },
                { label: 'Opens', value: selected.opens },
                { label: 'Interest', value: selected.interest },
              ]} />
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginTop: 'var(--s3)' }}>
                <button className="btn btn-primary btn-sm">Pitch a new angle</button>
                <button className="btn btn-secondary btn-sm">Stop follow-ups</button>
                <button className="btn-link">Unsubscribe</button>
              </div>
            </div>
          )}
        />
      </Frame>

      {/* L6 */}
      <Frame code="L6" name="Chat + Canvas" note="split builder, lock & save">
        <ChatCanvas
          chat={(
            <div className="card">
              <div className="ds-launchpad__kicker" style={{ marginBottom: 'var(--s3)' }}>Build with Claude</div>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 'var(--s3)', marginBottom: 'var(--s2)' }}>What should the monthly report lead with?</div>
              <div style={{ background: 'var(--text)', color: '#fff', borderRadius: 'var(--r-md)', padding: 'var(--s3)', marginBottom: 'var(--s2)', marginLeft: 'auto', maxWidth: '85%' }}>PR wins up top, then SEO, then paid ROAS.</div>
              <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 'var(--s3)' }}>Done — reordered, added a backlinks-earned tile. Preview →</div>
            </div>
          )}
          canvas={(
            <div className="card" style={{ background: 'var(--surface-raised)' }}>
              <div className="ds-launchpad__kicker" style={{ marginBottom: 'var(--s3)' }}>Live preview</div>
              <div style={{ background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-md)', padding: 'var(--s3)' }}>
                <div style={{ fontWeight: 800 }}>Indiewalls — September</div>
                <div className="ds-launchpad__kicker" style={{ marginTop: 'var(--s3)', color: 'var(--fn-approve)' }}><span className="ds-launchpad__pip" style={{ background: 'var(--fn-approve)' }} />PR &amp; coverage</div>
                <StatStrip items={[{ label: 'Placements', value: 3 }, { label: 'Backlinks earned', value: 16 }]} />
              </div>
            </div>
          )}
        />
      </Frame>
    </div>
  );
}
