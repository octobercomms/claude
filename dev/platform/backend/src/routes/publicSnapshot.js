// Public Growth Snapshot — the unauthenticated front door embedded on
// octobercomms.com. Three endpoints:
//   GET  /embed          → the self-contained widget HTML (framed by octobercomms.com)
//   POST /               → { url, ig_handle } → draft + return the value-first "taste"
//   POST /:token/email   → { email }          → unlock the full sections
//
// This is public and it spends Claude money + fetches arbitrary URLs, so it is
// deliberately hardened: a strict per-IP limiter, a daily cap + URL dedup in
// the service, the existing SSRF guard, and optional Cloudflare Turnstile.

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const studio = require('../services/snapshotStudio');
const email = require('../services/emailService');

const router = express.Router();

// Embed the Brockmann brand font as base64 @font-face rules (same woff2 the
// client PDF reports use). An iframe can't reach the host page's fonts, and the
// widget's CSP is default-src 'none', so the font must be inlined + allowed via
// font-src data:. Read once at boot.
const FONTS_DIR = path.join(__dirname, '../../../frontend/public/fonts');
function fontFace(weight, file) {
  try {
    const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
    return `@font-face{font-family:'Brockmann';font-weight:${weight};font-style:normal;font-display:swap;src:url('data:font/woff2;base64,${b64}') format('woff2');}`;
  } catch { return ''; }
}
const FONT_CSS = [
  fontFace(400, 'brockmann-regular-webfont.woff2'),
  fontFace(600, 'brockmann-semibold-webfont.woff2'),
  fontFace(700, 'brockmann-bold-webfont.woff2'),
].filter(Boolean).join('');

const BOOK_URL = () => process.env.SNAPSHOT_BOOK_URL || 'https://octobercomms.com/book/';
const EMBED_ORIGINS = () => process.env.SNAPSHOT_EMBED_ORIGINS || 'https://octobercomms.com https://www.octobercomms.com';

// A draft costs a Claude call + a site fetch, so keep the create endpoint tight;
// dedup + the daily cap in the service are the second line. The email-unlock and
// embed GET are cheap, so they get a looser cap.
const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6, message: { error: 'You have run a few snapshots in a short window — please wait a few minutes and try again.' } });
const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || null;
}

// Optional Cloudflare Turnstile. Only enforced when a secret is configured, so
// the widget works out of the box and gains bot protection the moment October
// adds a key (SNAPSHOT_TURNSTILE_SECRET) + the site key in the embed.
async function turnstileOk(req) {
  const secret = process.env.SNAPSHOT_TURNSTILE_SECRET;
  if (!secret) return true;
  const token = req.body?.turnstile;
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token, remoteip: clientIp(req) || '' });
    const { data } = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', form, { timeout: 8000 });
    return !!data?.success;
  } catch { return false; }
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// Value-first payload. Ungated: the scores, the one-line opportunity, and the
// "what we found" summary. Gated (needs email): the three deep sections — what
// we'd actually do — plus the call CTA.
function taste(lead, { full }) {
  const d = lead.draft || {};
  return {
    token: lead.public_token,
    company_name: lead.company_name || d.company_name || null,
    scores: d.scores || {},
    score_notes: d.score_notes || {},
    headline_opportunity: d.headline_opportunity || '',
    summary: Array.isArray(d.summary) ? d.summary : [],
    sections: full ? (Array.isArray(d.sections) ? d.sections : []) : undefined,
    unlocked: !!full,
    book_url: BOOK_URL(),
  };
}

// ── Create a snapshot from a URL ────────────────────────────────────────────
router.post('/', createLimiter, express.json(), async (req, res) => {
  try {
    if (!(await turnstileOk(req))) return res.status(400).json({ error: 'Please complete the verification and try again.' });
    const url = String(req.body?.url || '').trim();
    const igHandle = String(req.body?.ig_handle || '').trim().replace(/^@+/, '').slice(0, 80) || null;
    if (!url) return res.status(400).json({ error: 'Enter your website address.' });

    const { lead, reused } = await studio.createPublicSnapshot({ url, igHandle, ip: clientIp(req) });

    // Alert #1 — fire-and-forget so a mail hiccup never fails the visitor.
    // Only alert on a genuinely new lead, not a deduped repeat submit.
    if (!reused) {
      email.sendSnapshotLeadAlert({ company: lead.company_name, url: lead.url, igHandle }).catch(() => {});
    }
    res.json(taste(lead, { full: !!lead.email }));
  } catch (err) {
    if (err.code === 'CAP') return res.status(429).json({ error: err.message });
    // SSRF / bad-URL / unreachable host all surface as a friendly 400.
    res.status(400).json({ error: err.message || 'We couldn\'t read that site — check the address and try again.' });
  }
});

// ── Unlock the full report with an email ────────────────────────────────────
router.post('/:token/email', emailLimiter, express.json(), async (req, res) => {
  try {
    const addr = String(req.body?.email || '').trim();
    if (!isEmail(addr)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const lead = await studio.attachPublicEmail(req.params.token, addr);
    if (!lead) return res.status(404).json({ error: 'Snapshot not found — run it again.' });

    email.sendSnapshotEmailRequest({ company: lead.company_name, url: lead.url, email: addr }).catch(() => {});
    res.json(taste(lead, { full: true }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
});

// ── The embeddable widget ───────────────────────────────────────────────────
// Deliberately minimal — transparent background, hairline rules, flat type — so
// it sits inside a host site's own design rather than fighting it. Adapts via
// query params on the iframe src:
//   ?theme=dark      light text for dark backgrounds (default light)
//   ?intro=0         hide the built-in heading/blurb (use your own)
//   ?accent=RRGGBB   override the accent colour (default e7cd41)
router.get('/embed', (req, res) => {
  // Allow octobercomms.com to frame this one response (helmet pins the rest of
  // the app to same-origin). Replace the app-wide CSP + drop X-Frame-Options.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' https: data:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' ${EMBED_ORIGINS()};`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const theme = req.query.theme === 'dark' ? 'dark' : 'light';
  const intro = req.query.intro !== '0';
  const accent = String(req.query.accent || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || 'e7cd41';
  res.send(renderEmbedHtml({ theme, intro, accent }));
});

function renderEmbedHtml({ theme = 'light', intro = true, accent = 'e7cd41' } = {}) {
  const introHtml = intro ? `<div class="kicker">October · Growth Snapshot</div>
  <h1>See where you're winning attention — and where you're invisible.</h1>
  <p class="lede">Enter your website and we'll read it the way search engines, AI assistants and your future customers do — then show you the first moves we'd make across search, social, PR and brand. Takes about 20 seconds.</p>` : '';
  return `<!doctype html><html lang="en" class="${theme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>October Growth Snapshot</title>
<style>
  ${FONT_CSS}
  :root{--accent:#${accent};--ink:#1a1a1a;--muted:#6a6a6a;--line:rgba(0,0,0,.15);--deep:#6f5e10;--fieldbd:rgba(0,0,0,.32);--btn-ink:#231f20}
  html.dark{--ink:#fff;--muted:#b4b4b4;--line:rgba(255,255,255,.22);--deep:var(--accent);--fieldbd:rgba(255,255,255,.42)}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Brockmann',-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);line-height:1.5;background:transparent;padding:0;text-transform:lowercase}
  .wrap{max-width:none;width:100%;margin:0;padding:50px 0;border-top:3px solid var(--ink);border-bottom:3px solid var(--ink)}
  .kicker{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:lowercase;color:var(--muted)}
  h1{font-size:27px;line-height:1.1;letter-spacing:-.4px;font-weight:800;margin:8px 0 10px}
  .lede{font-size:15px;color:var(--muted);max-width:60ch}
  form{margin-top:18px}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  label{display:block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:lowercase;color:var(--muted);margin:0 0 5px}
  input{width:100%;padding:11px 2px;border:none;border-bottom:1.5px solid var(--fieldbd);border-radius:0;font-size:16px;font-family:inherit;color:var(--ink);background:transparent}
  input::placeholder{color:var(--muted);opacity:.65}
  input:focus{outline:none;border-bottom-color:var(--accent)}
  .f-url{flex:2;min-width:220px}.f-ig{flex:1;min-width:150px}
  .btn{display:inline-block;background:var(--accent);color:var(--btn-ink);font-weight:800;font-size:15px;padding:13px 28px;border:none;border-radius:100px;cursor:pointer;font-family:inherit}
  .btn:disabled{opacity:.55;cursor:default}
  .btn.accent{background:var(--accent);color:var(--btn-ink)}
  .hint{font-size:12px;color:var(--muted);margin-top:10px}
  .err{color:#e0533d;font-size:14px;margin-top:12px;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0 20px;margin-top:24px;border-top:1px solid var(--line)}
  .stat{padding:13px 0;border-bottom:1px solid var(--line)}
  .stat .lab{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:lowercase;color:var(--muted)}
  .stat .val{font-size:21px;font-weight:800;letter-spacing:-.4px;margin-top:5px;line-height:1.05}
  .stat .sub{font-size:11px;color:var(--muted);margin-top:4px}
  .head-opp{margin-top:22px;padding-left:14px;border-left:3px solid var(--accent)}
  .head-opp .t{font-size:11px;font-weight:700;text-transform:lowercase;letter-spacing:.1em;color:var(--muted)}
  .head-opp .b{font-size:18px;font-weight:700;margin-top:4px}
  .sec-title{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:lowercase;color:var(--muted);margin:26px 0 8px}
  .find{padding:12px 0;border-bottom:1px solid var(--line)}
  .find .n{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:lowercase;color:var(--muted)}
  .find .x{margin-top:4px}
  .lock{margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}
  .lock h3{font-size:19px;font-weight:800;letter-spacing:-.3px}
  .lock p{color:var(--muted);margin-top:6px;max-width:56ch}
  .block{padding:14px 0;border-bottom:1px solid var(--line)}
  .block .tag{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:lowercase;color:var(--muted)}
  .block h4{font-size:16px;font-weight:800;margin:5px 0 8px}
  .block .idea{margin-top:8px}
  .block .idea .tag{color:var(--deep)}
  .opp{display:flex;gap:8px;margin-top:8px}
  .opp .arrow{font-weight:800;color:var(--accent)}
  .cta{margin-top:26px;padding-top:20px;border-top:2px solid var(--ink)}
  .cta h3{font-size:20px;letter-spacing:-.3px;font-weight:800}
  .cta p{color:var(--muted);margin-top:8px;max-width:56ch}
  .cta .btn{margin-top:16px}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(35,31,32,.3);border-top-color:var(--btn-ink);border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:7px}
  @keyframes s{to{transform:rotate(360deg)}}
  b,strong{font-weight:800}
</style></head><body><div class="wrap" id="app">
  ${introHtml}
  <form id="f">
    <div class="row">
      <div class="f-url"><label for="url">Your website</label><input id="url" name="url" type="text" placeholder="yourbrand.com" autocomplete="url" required></div>
      <div class="f-ig"><label for="ig">Instagram (optional)</label><input id="ig" name="ig" type="text" placeholder="@yourbrand"></div>
    </div>
    <div style="margin-top:14px"><button class="btn" id="go" type="submit">Show me my snapshot</button></div>
    <div class="hint">Free, no signup. We'll show your results right here.</div>
    <div class="err" id="err" style="display:none"></div>
  </form>
  <div id="out"></div>
</div>
<script>
(function(){
  var app=document.getElementById('app'),f=document.getElementById('f'),go=document.getElementById('go'),err=document.getElementById('err'),out=document.getElementById('out');
  var token=null,company=null;
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
  function rich(s){return esc(s).replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')}
  function postHeight(){try{parent.postMessage({type:'snapshot-embed-height',height:document.body.scrollHeight},'*')}catch(e){}}
  var ro=new ResizeObserver(postHeight);ro.observe(document.body);
  function showErr(m){err.textContent=m;err.style.display='block'}
  function clearErr(){err.style.display='none'}
  function tiles(s,n){
    var defs=[['search','Search health','On-page & rankings',0],['ai','AI visibility','In AI answers',1],['social','Social presence','Reach & consistency',0],['pr','PR footprint','Earned coverage',0],['trust','Trusted voices','Who carries your message',0]];
    return '<div class="grid">'+defs.filter(function(d){return s[d[0]]!=null}).map(function(d){
      return '<div class="stat'+(d[3]?' hot':'')+'"><div class="lab">'+esc(d[1])+'</div><div class="val">'+esc(s[d[0]]||'—')+'</div><div class="sub">'+esc((n&&n[d[0]])||d[2])+'</div></div>'
    }).join('')+'</div>'
  }
  function renderTaste(r){
    token=r.token;company=r.company_name;
    var h='';
    if(r.company_name) h+='<div class="kicker" style="margin-top:26px">Prepared for</div><h1 style="font-size:26px">'+esc(r.company_name)+'</h1>';
    h+=tiles(r.scores||{},r.score_notes||{});
    if(r.headline_opportunity) h+='<div class="head-opp"><div class="t">The opportunity in one line</div><div class="b">'+rich(r.headline_opportunity)+'</div></div>';
    if(r.summary&&r.summary.length){
      h+='<div class="sec-title">What we found</div>';
      h+=r.summary.map(function(x,i){var svc=(x&&typeof x==='object')?x.service:'';var t=(x&&typeof x==='object')?x.text:x;return '<div class="find"><div class="n">'+String(i+1).padStart(2,'0')+(svc?' · '+esc(svc):'')+'</div><div class="x">'+rich(t)+'</div></div>'}).join('');
    }
    if(r.unlocked){ h+=renderFull(r); }
    else {
      h+='<div class="lock"><h3>The moves we\\'d make first →</h3><p>We\\'ve lined up the specific ideas we\\'d run — the finding, the idea, and the opportunity for '+esc(r.company_name||'you')+'. Enter your email to unlock them.</p>'
        +'<form id="ef" style="margin-top:14px"><div class="row"><div class="f-url"><input id="em" type="email" placeholder="you@'+'company.com" required></div><button class="btn accent" id="ego" type="submit">Unlock the full snapshot</button></div><div class="hint">One email, no spam. We\\'ll also send a tidy PDF you can keep.</div><div class="err" id="eerr" style="display:none"></div></form></div>';
    }
    out.innerHTML=h;
    if(!r.unlocked) wireEmail();
    postHeight();
  }
  function renderFull(r){
    var h='<div class="sec-title">The moves we\\'d make first</div>';
    (r.sections||[]).forEach(function(s){
      h+='<div class="block"><span class="tag">'+esc(s.service||'')+'</span><h4>'+esc(s.title||'Opportunity')+'</h4>';
      if(s.finding) h+='<div>'+rich(s.finding)+'</div>';
      if(s.idea) h+='<div class="idea"><span class="tag">An idea we\\'d run</span><div style="margin-top:4px">'+rich(s.idea)+'</div></div>';
      if(s.opportunity) h+='<div class="opp"><span class="arrow">→</span><div><strong>The opportunity:</strong> '+rich(s.opportunity)+'</div></div>';
      h+='</div>';
    });
    h+='<div class="cta"><h3>Let\\'s turn this into a plan.</h3><p>This is the shortlist. On a short call we\\'ll prioritise it into a 90-day plan — what comes first, what it costs, and what good looks like. No pitch, just your plan.</p><div style="margin-top:16px"><a class="btn accent" href="'+esc(r.book_url)+'" target="_blank" rel="noopener">Book your walkthrough →</a></div></div>';
    return h;
  }
  function wireEmail(){
    var ef=document.getElementById('ef'),em=document.getElementById('em'),ego=document.getElementById('ego'),eerr=document.getElementById('eerr');
    ef.addEventListener('submit',function(e){e.preventDefault();eerr.style.display='none';
      var v=(em.value||'').trim();ego.disabled=true;ego.innerHTML='<span class="spin"></span>Unlocking…';
      fetch('/api/public/snapshot/'+encodeURIComponent(token)+'/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:v})})
        .then(function(res){return res.json().then(function(j){return {ok:res.ok,j:j}})})
        .then(function(o){if(!o.ok)throw new Error(o.j.error||'Something went wrong.');renderTaste(o.j)})
        .catch(function(x){ego.disabled=false;ego.textContent='Unlock the full snapshot';eerr.textContent=x.message;eerr.style.display='block'});
    });
  }
  f.addEventListener('submit',function(e){e.preventDefault();clearErr();
    var url=(document.getElementById('url').value||'').trim(),ig=(document.getElementById('ig').value||'').trim();
    if(!url){showErr('Enter your website address.');return}
    go.disabled=true;go.innerHTML='<span class="spin"></span>Reading your site…';
    fetch('/api/public/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url,ig_handle:ig})})
      .then(function(res){return res.json().then(function(j){return {ok:res.ok,j:j}})})
      .then(function(o){if(!o.ok)throw new Error(o.j.error||'We couldn\\'t read that site.');f.style.display='none';renderTaste(o.j)})
      .catch(function(x){go.disabled=false;go.innerHTML='Show me my snapshot';showErr(x.message)});
  });
  postHeight();
})();
</script></body></html>`;
}

module.exports = router;
