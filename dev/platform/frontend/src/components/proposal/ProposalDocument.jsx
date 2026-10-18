import React from 'react';

// The proposal as the prospect sees it. Shared by the public page (/p/:token),
// the approval preview in OMI and the sample at /proposals/sample, so what
// Daniel approves is exactly what is sent and the sample is the real thing.
//
// Order is SOST, with the method between strategy and tactics: strategy is the
// thinking, the method is the machine, tactics is what lands in their diary.
// The method explains why these tactics and not others, so tactics after it
// reads as the consequence of a system rather than a menu of activities, and a
// menu gets compared on price.
//
// Only four blocks here are written for the prospect (letter, situation,
// priority, and the covering email that carries the link). Objectives, KPIs,
// strategy, tactics and the method stages come from the selected method, so they
// read identically in every proposal. Each block carries data-section, so the
// public page measures dwell per step of the argument rather than per page.

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
.pp ul.ticked li:before{content:'✓';color:var(--y);font-weight:800}
.pp .obj{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:26px}
.pp .obj .when{font-size:12px;font-weight:700;color:var(--y);text-transform:lowercase}
.pp .priority{border:3px solid var(--y);padding:22px;margin:26px 0}
.pp .stage{display:grid;grid-template-columns:70px 1fr;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
.pp .stage .n{font-size:28px;font-weight:800;color:var(--y)}
.pp blockquote{margin:0;font-size:19px;line-height:1.45;font-weight:600}
.pp .attr{margin-top:10px;color:var(--mut);font-size:14px}
.pp .figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:26px}
.pp .fig{border-top:3px solid var(--y);padding-top:10px}
.pp .fig .n{font-size:52px;font-weight:800;letter-spacing:-.03em;line-height:1}
.pp .fig .l{margin-top:6px;font-size:14px;line-height:1.35}
.pp .fig .s{margin-top:8px;color:var(--mut);font-size:11px;line-height:1.35}
.pp .price{font-size:52px;font-weight:800;letter-spacing:-.03em;margin:10px 0 2px}
.pp .price small{font-size:15px;color:var(--mut);font-weight:600;letter-spacing:0}
.pp .offer{border:3px solid var(--y);padding:26px;margin-bottom:22px}
.pp .tbc{font-size:22px;font-weight:800;color:var(--y);margin:10px 0}
.pp .btn{display:inline-block;background:var(--y);color:#111;font-weight:800;border:0;border-radius:100px;padding:14px 28px;font-size:16px;cursor:pointer;font-family:inherit;text-decoration:none}
.pp .btn:disabled{opacity:.5;cursor:default}
.pp .btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.pp input[type=text]{background:transparent;border:0;border-bottom:2px solid var(--line);color:var(--ink);font-size:16px;padding:10px 2px;width:100%;max-width:420px;font-family:inherit}
.pp input[type=text]:focus{outline:none;border-bottom-color:var(--y)}
.pp .agree{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:var(--mut);font-size:14px}
.pp .agree a{color:var(--ink)}
.pp .err{color:#ff7a66;font-weight:700;margin-top:10px}
.pp footer{padding:40px 0 60px;border-top:3px solid var(--ink);color:var(--mut);font-size:12px}
.pp .print-only{display:none}
@media (max-width:560px){.pp section{padding:40px 0}.pp .stage{grid-template-columns:48px 1fr}}

/* Printing, and the PDF. One stylesheet for both: OMI renders the PDF through
   Puppeteer against this same page, so what the prospect gets from Cmd-P and
   what Daniel attaches to an email are the same document, with no second
   template to drift. Sized in millimetres so A4 and US Letter both work, which
   matters when half the prospects are American.
   print-color-adjust is not optional: browsers drop background ink to save
   toner by default, which on a black ground takes the white text with it. */
@media print{
  @page{size:A4;margin:14mm 0}
  html,body{background:#0d0d0d!important}
  .pp,.pp *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .pp .wrap{max-width:170mm;padding:0 8mm}
  .pp section{padding:10mm 0;break-inside:avoid}
  .pp .cover{break-after:page;padding-top:0}
  .pp h1{font-size:34pt}
  .pp h2{font-size:19pt}
  .pp h3{font-size:12pt}
  .pp p,.pp li{font-size:10.5pt}
  .pp .price{font-size:30pt}
  .pp h1,.pp h2,.pp h3{break-after:avoid}
  .pp .box,.pp .priority,.pp .offer,.pp .stage,.pp blockquote{break-inside:avoid}
  .pp .cover-img{max-height:120mm}
  /* Interactive things become readable text rather than dead rectangles. */
  .pp .no-print,.pp .btn,.pp input,.pp .agree input{display:none!important}
  .pp .print-only{display:block}
  .pp a{color:var(--ink);text-decoration:underline}
  .pp footer{padding:8mm 0 0}
}
`;

const money = (n, cur) => `${cur}${Number(n || 0).toLocaleString('en-GB')}`;
const paras = (arr) => (Array.isArray(arr) ? arr : arr ? [arr] : []).map((t, i) => <p key={i}>{t}</p>);
const list = (arr) => (Array.isArray(arr) ? arr : []).filter(Boolean);

export default function ProposalDocument({ data, acceptSlot = null }) {
  const c = data?.content || {};
  const proof = data?.proof || {};
  const names = data?.recipient_names;
  // The offer: one method, priced, as Daniel chose it after the call.
  const offer = data?.offer || {};
  const cur = offer.symbol || c.currency || '£';
  const objectives = offer.objectives || {};
  const strategy = list(offer.strategy);
  const tactics = list(offer.tactics);
  const stages = list(offer.stages);
  const committed = list(offer.kpis?.committed);
  const reported = list(offer.kpis?.reported);
  const hasObjectives = objectives.short || objectives.mid || objectives.long;
  // Credentials split two ways: the ones carrying a counted figure lead the
  // proof block, the rest stay as the cards below it.
  const creds = list(proof.credentials);
  const figures = creds.filter(x => x.figure);
  const plainCreds = creds.filter(x => !x.figure);
  const newService = (data?.evidence_policy || offer.evidence_policy) === 'no_outcome_claims';

  return (
    <div className="pp">
      <div className="wrap">
        <section className="cover" data-section="cover">
          <div className="kick">october communications · {c.date_label}</div>
          <h1 style={{ marginTop: 14 }}>{c.company_name || 'your'}<br /><span className="y">marketing proposal</span></h1>
          <p className="kick" style={{ marginTop: 16 }}>{offer.family || offer.name || 'the earning visibility method'}</p>
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

        {/* S — where you are */}
        <section data-section="situation">
          <div className="kick">situation</div>
          <h2>where you stand</h2>
          {paras(c.situation)}
        </section>

        {/* O — where you want to be, and how we will know */}
        {(hasObjectives || committed.length > 0 || reported.length > 0) && (
          <section data-section="objectives">
            <div className="kick">objectives</div>
            <h2>what we are aiming at</h2>
            {hasObjectives && (
              <div className="obj">
                {[['short', '0-3 months'], ['mid', '3-9 months'], ['long', '9-18 months']].map(([k, w]) => objectives[k] && (
                  <div key={k} className="box"><div className="when">{w}</div><div style={{ marginTop: 6 }}>{objectives[k]}</div></div>
                ))}
              </div>
            )}
            {/* Two tiers, and the split is the point: October commits to its own
                output and reports on the outcome. Nobody can promise a
                journalist publishes, and an architect who has bought PR before
                knows it, so a guarantee reads worse than a commitment plus a
                number they can check. */}
            {committed.length > 0 && (<>
              <h3>what we commit to</h3>
              <ul className="ticked" style={{ marginBottom: 24 }}>{committed.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </>)}
            {reported.length > 0 && (<>
              <h3>what we report, and act on</h3>
              <ul>{reported.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </>)}
            {offer.kpis?.close && <p style={{ marginTop: 18 }}>{offer.kpis.close}</p>}
          </section>
        )}

        {/* S — how we get there, and the one thing first */}
        {(strategy.length > 0 || c.priority) && (
          <section data-section="strategy">
            <div className="kick">strategy</div>
            <h2>how we get there</h2>
            {strategy.length > 0 && (
              <div className="grid2" style={{ marginBottom: c.priority ? 0 : 26 }}>
                {strategy.map((s, i) => <div key={i} className="box"><strong>{s.title}</strong><div style={{ marginTop: 6, color: 'var(--mut)' }}>{s.text}</div></div>)}
              </div>
            )}
            {c.priority && (
              <div className="priority">
                <span className="tag">quarter one priority</span>
                <h3 style={{ marginTop: 12 }}>{c.priority.title}</h3>
                <p style={{ margin: 0 }}>{c.priority.text}</p>
              </div>
            )}
          </section>
        )}

        {/* The machine, between the thinking and the doing */}
        {stages.length > 0 && (
          <section data-section="method">
            <div className="kick">how we work together</div>
            <h2>{offer.family ? offer.family.toLowerCase() : 'one audit, one priority, reviewed every quarter'}</h2>
            {stages.map((m, i) => (
              <div key={m.stage || i} className="stage">
                <div className="n">{m.stage}</div>
                <div>{m.when && <span className="tag">{m.when}</span>}<h3 style={{ marginTop: m.when ? 8 : 0 }}>{m.title}</h3><div style={{ color: 'var(--mut)' }}>{m.text}</div></div>
              </div>
            ))}
          </section>
        )}

        {/* T — what actually happens */}
        {tactics.length > 0 && (
          <section data-section="tactics">
            <div className="kick">tactics</div>
            <h2>what we do</h2>
            <div className="grid2">
              {tactics.map((t, i) => <div key={i}><strong className="y">{t.heading}</strong><ul style={{ marginTop: 6 }}>{(t.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul></div>)}
            </div>
          </section>
        )}

        {(proof.case_study || proof.testimonial || proof.credentials?.length > 0 || proof.press) && (
          <section data-section="proof">
            <div className="kick">proof</div>
            <h2>{newService ? 'what october has done' : 'work like this, done before'}</h2>
            {/* The counted record, each figure with the source it came from.
                This is the strongest proof October has, because it is checkable
                and nobody else in the sector publishes it, and it is what lets
                a proposal be credible before a case study exists. A figure
                without its source is a claim, so they render together. */}
            {figures.length > 0 && (
              <div className="figs">
                {figures.map(f => (
                  <div key={f.id} className="fig">
                    <div className="n">{f.figure}</div>
                    <div className="l">{f.title}</div>
                    {f.source && <div className="s">Source: {f.source}</div>}
                  </div>
                ))}
              </div>
            )}
            {/* A new service says so, in place of a result it has not produced.
                Saying it plainly beats leaving a gap that reads as nothing to
                show, and it is what makes the capped cohort believable. */}
            {newService && (
              <p>
                This method is new, so there is no case study for it yet and we are not going to
                imply one. What is above is October&apos;s own published record. What the method
                produces for you will be in your own lead data, reported monthly, and you will see
                it at the same time we do.
              </p>
            )}
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
            {proof.press && (
              <div className="box" style={{ margin: '26px 0' }}>
                <span className="tag">published</span>
                <h3 style={{ marginTop: 10 }}>{proof.press.title}</h3>
                <div style={{ color: 'var(--mut)', fontSize: 14 }}>{proof.press.body}</div>
                {proof.press.url && <a href={proof.press.url} target="_blank" rel="noreferrer" style={{ color: 'var(--y)', fontWeight: 700 }}>read it →</a>}
              </div>
            )}
            {plainCreds.length > 0 && (
              <div className="grid2">
                {plainCreds.map(cr => <div key={cr.id} className="box"><strong>{cr.title}</strong><div style={{ marginTop: 6, color: 'var(--mut)', fontSize: 14 }}>{cr.body}</div></div>)}
              </div>
            )}
          </section>
        )}

        {/* Honest scarcity, and only where the method carries it: places are
            capped because delivery on the first clients has to be right, and
            the rate rises once the case studies exist. It sits after the proof
            because it only reads as a reason rather than a tactic once the
            prospect knows the method is new. */}
        {offer.scarcity && (
          <section data-section="availability">
            <div className="kick">availability</div>
            <h2>places</h2>
            <p>{offer.scarcity}</p>
          </section>
        )}

        {/* One package. Daniel picks the level from the call and the proposal
            states it. A radio button per package turns the price into a
            comparison, which is the opposite of what a recommendation does. */}
        <section data-section="pricing">
          <div className="kick">investment</div>
          <h2>the cost</h2>
          <div className="offer">
            <span className="tag">{offer.name || 'your level'}</span>
            {offer.monthly != null
              ? <div className="price">{money(offer.monthly, cur)}<small> per month</small></div>
              : <div className="tbc">price to confirm</div>}
            {offer.setup ? <p style={{ margin: '0 0 14px' }}>One-off onboarding: <strong>{money(offer.setup, cur)}</strong>, covering the audit set-up, access and folders ready for every channel.</p> : null}
            {offer.blurb && <p style={{ margin: 0 }}>{offer.blurb}</p>}
            {list(offer.includes).length > 0 && (
              <ul className="ticked" style={{ marginTop: 14 }}>{offer.includes.map((x, i) => <li key={i}>{x}</li>)}</ul>
            )}
          </div>
          <p style={{ color: 'var(--mut)' }}>Paid monthly by Direct Debit. No lock-in: you can pause or stop from your own dashboard whenever you want, and you do not have to ask.</p>
        </section>

        <section data-section="next">
          <div className="kick">next step</div>
          <h2>when we start</h2>
          <p>Agree the terms and set up the Direct Debit in one step. The audit starts the week the mandate is in place, and you will have the written plan of work by the end of month one.</p>
          {acceptSlot}
          {/* On paper the accept block is a dead rectangle, so it becomes a line
              of text that says what to do instead. */}
          <p className="print-only" style={{ marginTop: 18 }}>
            To accept, open the link in the covering email and agree the terms there, or reply to
            {data?.contact_email ? ` ${data.contact_email}` : ' the email'} and Daniel will send the Direct Debit link across.
          </p>
        </section>

        <footer>
          October Communications Ltd. Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales.
          Registered address: 167-169 Great Portland Street, 5th Floor, London, W1W 5PF. {data?.contact_email}
          <span className="print-only" style={{ marginTop: 8 }}>
            {c.company_name ? `${c.company_name} · ` : ''}{c.date_label}
          </span>
        </footer>
      </div>
    </div>
  );
}
