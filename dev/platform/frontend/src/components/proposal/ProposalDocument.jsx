import React from 'react';

// The proposal as the prospect sees it. Shared by the public page (/p/:token)
// and the approval preview in OMI, so what Daniel approves is exactly what is
// sent. Styled in the Earned Reach look: black ground, one yellow, lowercase
// Brockmann, heavy rules. Each block carries data-section so the public page
// can measure dwell per section.

export const PROPOSAL_CSS = `
.pp{--y:#e7cd41;--ink:#fff;--mut:#b9b9b9;--bg:#0d0d0d;--line:rgba(255,255,255,.22);background:var(--bg);color:var(--ink);font-family:'Brockmann',-apple-system,'Segoe UI',sans-serif;line-height:1.55;min-height:100%}
.pp *{box-sizing:border-box}
.pp .wrap{max-width:860px;margin:0 auto;padding:0 20px}
.pp section{padding:56px 0;border-top:3px solid var(--ink)}
.pp .kick{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:lowercase;color:var(--mut)}
.pp h1,.pp h2,.pp h3{text-transform:lowercase;letter-spacing:-.02em;line-height:1.05;margin:0}
.pp h1{font-size:clamp(40px,8vw,76px);font-weight:800}
.pp h2{font-size:clamp(28px,5vw,40px);font-weight:800;margin:8px 0 22px}
.pp h3{font-size:19px;font-weight:800;margin:0 0 8px}
.pp p{margin:0 0 14px;max-width:66ch}
.pp .y{color:var(--y)}
.pp .cover{border-top:0;padding-top:40px}
.pp .cover-img{width:100%;aspect-ratio:16/8;object-fit:cover;display:block;margin-top:32px;border:3px solid var(--ink)}
.pp .check{display:grid;grid-template-columns:repeat(8,1fr);height:44px;margin-top:28px}
.pp .check i:nth-child(odd){background:var(--y)}
.pp .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.pp .box{border:2px solid var(--ink);padding:18px}
.pp .box.hl{border-color:var(--y)}
.pp .tag{display:inline-block;font-size:11px;font-weight:700;background:var(--y);color:#111;padding:2px 8px;text-transform:lowercase}
.pp ul{margin:0;padding:0;list-style:none}
.pp li{padding:4px 0 4px 18px;position:relative}
.pp li:before{content:'—';position:absolute;left:0;color:var(--mut)}
.pp .obj{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:26px}
.pp .obj .when{font-size:12px;font-weight:700;color:var(--y);text-transform:lowercase}
.pp .priority{border:3px solid var(--y);padding:22px;margin:26px 0}
.pp .stage{display:grid;grid-template-columns:70px 1fr;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
.pp .stage .n{font-size:28px;font-weight:800;color:var(--y)}
.pp blockquote{margin:0;font-size:19px;line-height:1.45;font-weight:600}
.pp .attr{margin-top:10px;color:var(--mut);font-size:14px}
.pp .price{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:10px 0 2px}
.pp .price small{font-size:14px;color:var(--mut);font-weight:600}
.pp .btn{display:inline-block;background:var(--y);color:#111;font-weight:800;border:0;border-radius:100px;padding:14px 28px;font-size:16px;cursor:pointer;font-family:inherit;text-decoration:none}
.pp .btn:disabled{opacity:.5;cursor:default}
.pp .btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.pp .radio{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.pp .radio label{border:2px solid var(--line);padding:10px 16px;cursor:pointer;font-weight:700;text-transform:lowercase}
.pp .radio label.on{border-color:var(--y);color:var(--y)}
.pp input[type=text]{background:transparent;border:0;border-bottom:2px solid var(--line);color:var(--ink);font-size:16px;padding:10px 2px;width:100%;max-width:420px;font-family:inherit}
.pp input[type=text]:focus{outline:none;border-bottom-color:var(--y)}
.pp .agree{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:var(--mut);font-size:14px}
.pp .agree a{color:var(--ink)}
.pp .err{color:#ff7a66;font-weight:700;margin-top:10px}
.pp footer{padding:40px 0 60px;border-top:3px solid var(--ink);color:var(--mut);font-size:12px}
@media (max-width:560px){.pp section{padding:40px 0}.pp .stage{grid-template-columns:48px 1fr}}
`;

const money = (n, cur) => `${cur}${Number(n || 0).toLocaleString('en-GB')}`;
const paras = (arr) => (Array.isArray(arr) ? arr : arr ? [arr] : []).map((t, i) => <p key={i}>{t}</p>);

export default function ProposalDocument({ data, acceptSlot = null }) {
  const c = data?.content || {};
  const proof = data?.proof || {};
  const cur = c.currency || '£';
  const names = data?.recipient_names;
  const packages = data?.packages || [];

  return (
    <div className="pp">
      <div className="wrap">
        <section className="cover" data-section="cover">
          <div className="kick">october communications · {c.date_label}</div>
          <h1 style={{ marginTop: 14 }}>{c.company_name || 'your'}<br /><span className="y">marketing proposal</span></h1>
          <p className="kick" style={{ marginTop: 16 }}>the earned reach method™</p>
          {c.cover_image
            ? <img className="cover-img" src={c.cover_image} alt="" referrerPolicy="no-referrer" />
            : <div className="check">{Array.from({ length: 8 }).map((_, i) => <i key={i} />)}</div>}
        </section>

        <section data-section="letter">
          <div className="kick">introduction</div>
          <h2>hello {names || 'there'},</h2>
          {paras(c.letter)}
          <p style={{ marginTop: 22 }}>Best wishes,<br /><strong>Daniel Nelson</strong><br /><span style={{ color: 'var(--mut)' }}>Founder and Director</span></p>
        </section>

        <section data-section="situation">
          <div className="kick">scope of work</div>
          <h2>the situation</h2>
          {paras(c.situation)}
        </section>

        <section data-section="plan">
          <div className="kick">objectives, strategy and tactics</div>
          <h2>the plan</h2>
          {c.objectives && (
            <div className="obj">
              {[['short', '0-3 months'], ['mid', '3-9 months'], ['long', '9-18 months']].map(([k, w]) => c.objectives[k] && (
                <div key={k} className="box"><div className="when">{w}</div><div style={{ marginTop: 6 }}>{c.objectives[k]}</div></div>
              ))}
            </div>
          )}
          {c.priority && (
            <div className="priority">
              <span className="tag">quarter one priority</span>
              <h3 style={{ marginTop: 12 }}>{c.priority.title}</h3>
              <p style={{ margin: 0 }}>{c.priority.text}</p>
            </div>
          )}
          {Array.isArray(c.strategy) && c.strategy.length > 0 && (<>
            <h3 style={{ marginTop: 10 }}>strategy</h3>
            <div className="grid2" style={{ marginBottom: 26 }}>
              {c.strategy.map((s, i) => <div key={i} className="box"><strong>{s.title}</strong><div style={{ marginTop: 6, color: 'var(--mut)' }}>{s.text}</div></div>)}
            </div>
          </>)}
          {Array.isArray(c.tactics) && c.tactics.length > 0 && (<>
            <h3>tactics</h3>
            <div className="grid2">
              {c.tactics.map((t, i) => <div key={i}><strong className="y">{t.heading}</strong><ul style={{ marginTop: 6 }}>{(t.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul></div>)}
            </div>
          </>)}
          {Array.isArray(c.kpis) && c.kpis.length > 0 && (
            <div style={{ marginTop: 26 }}><h3>what we measure</h3><ul>{c.kpis.map((k, i) => <li key={i}>{k}</li>)}</ul></div>
          )}
        </section>

        <section data-section="method">
          <div className="kick">how we work together</div>
          <h2>one audit, one priority, reviewed every quarter</h2>
          {(data?.method || []).map(m => (
            <div key={m.stage} className="stage">
              <div className="n">{m.stage}</div>
              <div><span className="tag">{m.when}</span><h3 style={{ marginTop: 8 }}>{m.title}</h3><div style={{ color: 'var(--mut)' }}>{m.text}</div></div>
            </div>
          ))}
        </section>

        {(proof.case_study || proof.testimonial || proof.credentials?.length > 0) && (
          <section data-section="proof">
            <div className="kick">proof</div>
            <h2>work like this, done before</h2>
            {proof.case_study && (
              <div className="box hl" style={{ marginBottom: 20 }}>
                <span className="tag">case study</span>
                <h3 style={{ marginTop: 10 }}>{proof.case_study.title}</h3>
                <p>{proof.case_study.body}</p>
                {proof.case_study.attribution && <div className="attr">{proof.case_study.attribution}</div>}
                {proof.case_study.url && <a href={proof.case_study.url} target="_blank" rel="noreferrer" style={{ color: 'var(--y)', fontWeight: 700 }}>read the case study →</a>}
              </div>
            )}
            {proof.testimonial && (
              <div style={{ margin: '26px 0' }}>
                <blockquote>“{proof.testimonial.body}”</blockquote>
                <div className="attr">{proof.testimonial.attribution || proof.testimonial.title}</div>
              </div>
            )}
            {proof.credentials?.length > 0 && (
              <div className="grid2">
                {proof.credentials.map(cr => <div key={cr.id} className="box"><strong>{cr.title}</strong><div style={{ marginTop: 6, color: 'var(--mut)', fontSize: 14 }}>{cr.body}</div></div>)}
              </div>
            )}
          </section>
        )}

        <section data-section="pricing">
          <div className="kick">investment</div>
          <h2>the cost</h2>
          <div className="grid2">
            {packages.map(p => (
              <div key={p.key} className={'box' + (p.key === (c.recommended || 'advanced') ? ' hl' : '')}>
                <span className="tag">{p.name}{p.key === (c.recommended || 'advanced') ? ' · recommended' : ''}</span>
                <div className="price">{money(p.monthly, cur)}<small> /month</small></div>
                <ul style={{ marginTop: 10 }}>{p.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
          {c.setup_fee ? <p style={{ marginTop: 18 }}>One-off onboarding: <strong>{money(c.setup_fee, cur)}</strong>, covering the audit set-up, access and folders ready for every channel.</p> : null}
          <p style={{ marginTop: 18, color: 'var(--mut)' }}>Both levels are built on a fixed foundation: monitoring, maintenance, reporting and a written plan of work every quarter, so what changes month to month is always agreed in advance. Paid monthly by Direct Debit via GoCardless.</p>
        </section>

        <section data-section="next">
          <div className="kick">next step</div>
          <h2>when we start</h2>
          <p>Choose the level, agree the terms and set up the Direct Debit in one step. The audit starts the week the mandate is in place, and you will have the written plan of work by the end of month one.</p>
          {acceptSlot}
        </section>

        <footer>
          October Communications Ltd. Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales.
          Registered address: 167-169 Great Portland Street, 5th Floor, London, W1W 5PF. {data?.contact_email}
        </footer>
      </div>
    </div>
  );
}
