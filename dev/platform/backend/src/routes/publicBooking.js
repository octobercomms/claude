// Public book-a-call endpoints (docs/omi/booking.md). No auth. Embedded on
// octobercomms.com via a one-line loader, like the Growth Snapshot widget.
//   GET  /slots                  → open times (ISO, UTC) + form options
//   POST /                       → book: creates the Google Meet event
//   GET  /manage/:token          → the booking behind the invite's manage link
//   POST /manage/:token/move     → reschedule
//   POST /manage/:token/cancel   → cancel
//   GET  /embed, /embed.js       → the widget and its loader

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const booking = require('../services/booking');

const router = express.Router();
const readLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: { error: 'Too many attempts. Please wait a few minutes.' } });

const EMBED_ORIGINS = () => process.env.BOOKING_EMBED_ORIGINS || process.env.SNAPSHOT_EMBED_ORIGINS || 'https://octobercomms.com https://www.octobercomms.com';

function fail(res, err) {
  if (err.code === 'NOT_CONNECTED') {
    console.error('[booking]', err.message);
    return res.status(503).json({ error: 'Online booking is paused for a moment. Email hello@octobercomms.com and we will find a time.' });
  }
  if (err.code === 'TAKEN') return res.status(409).json({ error: err.message });
  if (err.response) {   // Google API error: log it, show something human
    console.error('[booking] Google error', err.response.status, JSON.stringify(err.response.data || {}).slice(0, 300));
    return res.status(502).json({ error: 'We could not reach the calendar. Please try again in a minute.' });
  }
  res.status(400).json({ error: err.message || 'Something went wrong.' });
}

router.get('/slots', readLimiter, async (req, res) => {
  try { res.setHeader('Cache-Control', 'no-store'); res.json(await booking.slots()); }
  catch (err) { fail(res, err); }
});

router.post('/', writeLimiter, express.json(), async (req, res) => {
  try { res.json(await booking.book(req.body || {})); }
  catch (err) { fail(res, err); }
});

router.get('/manage/:token', readLimiter, async (req, res) => {
  try {
    const b = await booking.manageView(req.params.token);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json(b);
  } catch (err) { fail(res, err); }
});

router.post('/manage/:token/move', writeLimiter, express.json(), async (req, res) => {
  try {
    const b = await booking.reschedule(req.params.token, req.body?.start);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json(b);
  } catch (err) { fail(res, err); }
});

router.post('/manage/:token/cancel', writeLimiter, express.json(), async (req, res) => {
  try {
    const b = await booking.cancel(req.params.token, req.body?.reason);
    if (!b) return res.status(404).json({ error: 'Not found' });
    res.json(b);
  } catch (err) { fail(res, err); }
});

// ── Widget ──────────────────────────────────────────────────────────────────
const FONTS_DIR = path.join(__dirname, '../../../frontend/public/fonts');
function fontFace(weight, file) {
  try {
    const b64 = fs.readFileSync(path.join(FONTS_DIR, file)).toString('base64');
    return `@font-face{font-family:'Brockmann';font-weight:${weight};font-style:normal;font-display:swap;src:url('data:font/woff2;base64,${b64}') format('woff2');}`;
  } catch { return ''; }
}
const FONT_CSS = [fontFace(400, 'brockmann-regular-webfont.woff2'), fontFace(700, 'brockmann-bold-webfont.woff2')].join('');

router.get('/embed', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' ${EMBED_ORIGINS()};`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const theme = req.query.theme === 'light' ? 'light' : 'dark';
  const accent = String(req.query.accent || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || 'e7cd41';
  const snapshot = String(req.query.snapshot || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  res.send(renderEmbed({ theme, accent, snapshot }));
});

router.get('/embed.js', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(LOADER_JS);
});

// Injects the iframe where the tag sits, passes through ?snapshot= from the
// host page (so a booking made after a Snapshot lands on that same lead) and
// auto-sizes via postMessage.
const LOADER_JS = `(function(){
  var s=document.currentScript;if(!s){var ss=document.getElementsByTagName('script');s=ss[ss.length-1];}
  var origin;try{origin=new URL(s.src).origin;}catch(e){origin='';}
  var q=[];var a=function(n){return s.getAttribute('data-'+n)};
  if(a('theme'))q.push('theme='+encodeURIComponent(a('theme')));
  var ac=(a('accent')||'').replace(/[^0-9a-fA-F]/g,'');if(ac)q.push('accent='+ac);
  try{var sp=new URLSearchParams(location.search).get('snapshot');if(sp)q.push('snapshot='+encodeURIComponent(sp));}catch(e){}
  var f=document.createElement('iframe');
  f.src=origin+'/api/public/booking/embed'+(q.length?'?'+q.join('&'):'');
  f.title='Book a call with October';f.setAttribute('scrolling','no');
  f.style.cssText='width:100%;border:0;display:block;height:520px';
  s.parentNode.insertBefore(f,s);
  window.addEventListener('message',function(e){if(e.source!==f.contentWindow)return;var d=e.data;if(d&&d.type==='booking-embed-height'&&d.height){f.style.height=d.height+'px';}});
})();`;

function renderEmbed({ theme, accent, snapshot }) {
  return `<!doctype html><html lang="en" class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book a call with October</title>
<style>
${FONT_CSS}
:root{--y:#${accent};--ink:#1a1a1a;--mut:#6a6a6a;--line:rgba(0,0,0,.18);--field:rgba(0,0,0,.32);--btn:#111}
html.dark{--ink:#fff;--mut:#b4b4b4;--line:rgba(255,255,255,.24);--field:rgba(255,255,255,.42)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Brockmann',-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:var(--ink);background:transparent;line-height:1.5;text-transform:lowercase}
.wrap{padding:36px 0;border-top:3px solid var(--ink);border-bottom:3px solid var(--ink)}
h1{font-size:30px;font-weight:700;letter-spacing:-.5px;line-height:1.05}
.lede{color:var(--mut);margin-top:8px;max-width:58ch}
.lab{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--mut);margin:22px 0 8px}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}
.day{flex:0 0 auto;border:2px solid var(--line);background:transparent;color:var(--ink);padding:10px 12px;min-width:74px;text-align:center;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;text-transform:lowercase}
.day small{display:block;font-weight:400;color:var(--mut);font-size:11px}
.day.on{border-color:var(--y);color:var(--y)}
.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.t{border:2px solid var(--line);background:transparent;color:var(--ink);padding:10px 0;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700}
.t:hover,.t.on{border-color:var(--y);color:var(--y)}
.tz{font-size:12px;color:var(--mut);margin-top:10px}
.row{display:flex;gap:16px;flex-wrap:wrap}.row>div{flex:1;min-width:200px}
label{display:block;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--mut);margin:16px 0 4px}
input,textarea,select{width:100%;background:transparent;border:0;border-bottom:1.5px solid var(--field);color:var(--ink);font-family:inherit;font-size:16px;padding:9px 2px;border-radius:0}
textarea{resize:vertical;min-height:64px}
select option{color:#111}
input:focus,textarea:focus,select:focus{outline:none;border-bottom-color:var(--y)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{border:2px solid var(--line);padding:8px 12px;cursor:pointer;font-size:13px;font-weight:700;background:transparent;color:var(--ink);font-family:inherit;text-transform:lowercase}
.chip.on{border-color:var(--y);color:var(--y)}
.btn{display:inline-block;background:var(--y);color:#111;border:0;border-radius:100px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;margin-top:22px;text-transform:lowercase}
.btn:disabled{opacity:.5;cursor:default}
.link{background:none;border:0;color:var(--mut);font-family:inherit;font-size:13px;cursor:pointer;text-decoration:underline;margin-left:14px;text-transform:lowercase}
.picked{border-left:3px solid var(--y);padding-left:12px;margin-top:18px;font-weight:700}
.err{color:#ff7a66;font-weight:700;margin-top:12px;font-size:14px}
.muted{color:var(--mut)}
.done h1{color:var(--y)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,0,0,.25);border-top-color:#111;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:8px}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body><div class="wrap" id="app"><h1>book a call</h1><p class="lede">30 minutes on Google Meet with Daniel. We look at where you are visible now and what we would do first.</p><div id="out" class="muted" style="margin-top:22px">loading times…</div></div>
<script>
(function(){
var SNAP=${JSON.stringify(snapshot)};
var out=document.getElementById('out');
var TZ;try{TZ=Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'}catch(e){TZ='Europe/London'}
var data=null,dayKey=null,slot=null,budget=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var lastH=0;function ph(){try{var h=Math.ceil(document.body.getBoundingClientRect().height);if(h>0&&Math.abs(h-lastH)>1){lastH=h;parent.postMessage({type:'booking-embed-height',height:h},'*')}}catch(e){}}
new ResizeObserver(ph).observe(document.body);
function fmt(iso,o){return new Intl.DateTimeFormat('en-GB',Object.assign({timeZone:TZ},o)).format(new Date(iso))}
function key(iso){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))}
function groups(){var g={},order=[];data.slots.forEach(function(s){var k=key(s);if(!g[k]){g[k]=[];order.push(k)}g[k].push(s)});return{g:g,order:order}}
function pick(){
  var G=groups();
  if(!G.order.length){out.innerHTML='<p>No open times in the next few weeks. Email <a style="color:inherit" href="mailto:hello@octobercomms.com">hello@octobercomms.com</a> and we will find one.</p>';ph();return}
  if(!dayKey||!G.g[dayKey])dayKey=G.order[0];
  var h='<div class="lab">choose a day</div><div class="days">'+G.order.map(function(k){var f=G.g[k][0];return '<button class="day'+(k===dayKey?' on':'')+'" data-d="'+k+'">'+esc(fmt(f,{weekday:'short'}))+'<small>'+esc(fmt(f,{day:'numeric',month:'short'}))+'</small></button>'}).join('')+'</div>';
  h+='<div class="lab">choose a time</div><div class="times">'+G.g[dayKey].map(function(s){return '<button class="t" data-s="'+s+'">'+esc(fmt(s,{hour:'2-digit',minute:'2-digit'}))+'</button>'}).join('')+'</div>';
  h+='<div class="tz">times shown in '+esc(TZ.replace(/_/g,' '))+'</div>';
  out.className='';out.innerHTML=h;
  Array.prototype.forEach.call(out.querySelectorAll('.day'),function(b){b.onclick=function(){dayKey=b.getAttribute('data-d');pick()}});
  Array.prototype.forEach.call(out.querySelectorAll('.t'),function(b){b.onclick=function(){slot=b.getAttribute('data-s');form()}});
  ph();
}
function form(){
  var when=fmt(slot,{weekday:'long',day:'numeric',month:'long'})+', '+fmt(slot,{hour:'2-digit',minute:'2-digit'});
  var h='<div class="picked">'+esc(when)+' <button class="link" id="chg">change</button></div>';
  h+='<div class="row"><div><label for="nm">your name</label><input id="nm" autocomplete="name"></div><div><label for="em">work email</label><input id="em" type="email" autocomplete="email"></div></div>';
  h+='<div class="row"><div><label for="co">company</label><input id="co" autocomplete="organization"></div><div><label for="ws">website</label><input id="ws" placeholder="yourpractice.com" autocomplete="url"></div></div>';
  h+='<label for="gl">what do you want more of? (optional)</label><textarea id="gl" placeholder="e.g. residential work in west london, press in the nationals"></textarea>';
  h+='<label>monthly marketing budget</label><div class="chips">'+data.budgets.map(function(b){return '<button type="button" class="chip" data-b="'+esc(b)+'">'+esc(b)+'</button>'}).join('')+'</div>';
  h+='<label for="rf">how did you hear about us? (optional)</label><input id="rf" placeholder="ADF, a friend, Google…">';
  h+='<button class="btn" id="go">confirm the call</button><div class="err" id="err" style="display:none"></div>';
  out.innerHTML=h;
  document.getElementById('chg').onclick=function(){pick()};
  Array.prototype.forEach.call(out.querySelectorAll('.chip'),function(c){c.onclick=function(){budget=c.getAttribute('data-b');Array.prototype.forEach.call(out.querySelectorAll('.chip'),function(x){x.className='chip'+(x===c?' on':'')})}});
  document.getElementById('go').onclick=submit;ph();
}
function v(id){return (document.getElementById(id).value||'').trim()}
function submit(){
  var err=document.getElementById('err'),go=document.getElementById('go');err.style.display='none';
  go.disabled=true;go.innerHTML='<span class="spin"></span>booking…';
  fetch('/api/public/booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:slot,name:v('nm'),email:v('em'),company:v('co'),website:v('ws'),goal:v('gl'),budget:budget,referral:v('rf'),timezone:TZ,snapshot:SNAP})})
   .then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,j:j}})})
   .then(function(o){
     if(o.status===409){slot=null;load(o.j.error);return}
     if(!o.ok)throw new Error(o.j.error||'Something went wrong.');done(o.j)})
   .catch(function(x){go.disabled=false;go.textContent='confirm the call';err.textContent=x.message;err.style.display='block';ph()});
}
function done(b){
  var when=fmt(b.start,{weekday:'long',day:'numeric',month:'long'})+', '+fmt(b.start,{hour:'2-digit',minute:'2-digit'});
  out.innerHTML='<div class="done"><h1>booked.</h1><p style="margin-top:10px;font-weight:700">'+esc(when)+'</p><p class="muted" style="margin-top:8px">A calendar invite with the Google Meet link is on its way to '+esc(b.email)+'. It has a link to move or cancel if you need to.</p>'+(b.meet_url?'<a class="btn" href="'+esc(b.meet_url)+'" target="_blank" rel="noopener">google meet link</a>':'')+'</div>';
  ph();
}
function load(msg){
  fetch('/api/public/booking/slots').then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
   .then(function(o){if(!o.ok)throw new Error(o.j.error||'Could not load times.');data=o.j;pick();if(msg){out.insertAdjacentHTML('afterbegin','<div class="err">'+esc(msg)+'</div>');ph()}})
   .catch(function(x){out.innerHTML='<div class="err">'+esc(x.message)+'</div>';ph()});
}
load();ph();
})();
</script></body></html>`;
}

module.exports = router;
