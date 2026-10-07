/**
 * The audience HTTP routes, end to end against a database.
 *
 * The service-level rules are covered by press-segments.test.js. This covers the
 * layer above: that the routes are wired, that the :segId cross-tenant guard
 * exists (router.param('id') only covers /releases/ paths, so an audience id
 * would otherwise be an unguarded handle into another client's data), and that
 * queueing one audience produces exactly one send row per recipient per step.
 *
 * That last one is the whole reason the copy lives on the audience rather than on
 * per-audience outreach_sequences rows: the send queue CROSS JOINs the
 * campaign's sequences, so per-audience sequences would hand every recipient
 * every audience's emails.
 *
 * Auth is stubbed; client access is still enforced from req.visibleClientIds,
 * which is the thing being tested. No AI endpoint is called, so this costs
 * nothing to run.
 *
 * Needs a database:
 *   DB_HOST=localhost DB_NAME=omi_scratch DB_USER=... node tests/press-audience-routes.test.js
 */
const nodePath = require('path');
const path = nodePath.join(__dirname, '..') + nodePath.sep;
// Stub auth so the routes are reachable; client access is still enforced from
// req.visibleClientIds, which is what we want to test.
require.cache[require.resolve(path+'src/middleware/auth.js')]={id:'auth',loaded:true,
  exports:{authenticate:(req,_res,next)=>{req.user={id:'00000000-0000-0000-0000-000000000001',role:'admin'};next();}}};
const express=require('express');
const pool=require(path+'src/db');
const ca=require(path+'src/middleware/clientAccess');

let failures=0;
const ok=(c,l)=>{ if(c) console.log('  ok   '+l); else {console.log('  FAIL '+l); failures++;} };

(async()=>{
  const SLUG='routeprobe-'+Date.now();
  const {rows:cl}=await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id',[SLUG]);
  const clientId=cl[0].id;
  const {rows:other}=await pool.query('INSERT INTO clients (name,slug) VALUES ($1,$1) RETURNING id',[SLUG+'-other']);
  const {rows:cp}=await pool.query("INSERT INTO outreach_campaigns (client_id,name,campaign_type) VALUES ($1,$2,'press') RETURNING id",[clientId,SLUG]);
  const campaignId=cp[0].id;
  const {rows:rel}=await pool.query(
    "INSERT INTO outreach_press_releases (client_id,campaign_id,title) VALUES ($1,$2,$3) RETURNING id",
    [clientId,campaignId,'Probe release']);
  const releaseId=rel[0].id;
  // two sequence steps: step 1 immediate, step 2 after 5 days
  await pool.query("INSERT INTO outreach_sequences (campaign_id,step_number,subject,delay_days) VALUES ($1,1,'Shared subject',0),($1,2,'Shared follow-up',5)",[campaignId]);
  const ids=[];
  for(let i=0;i<3;i++){
    const {rows}=await pool.query("INSERT INTO outreach_contacts (name,email,kind,status) VALUES ($1,$2,'media','active') RETURNING id",[`RP ${i}`,`${SLUG}-${i}@e.com`]);
    ids.push(rows[0].id);
  }

  const app=express(); app.use(express.json());
  let visible=[clientId];
  app.use((req,_res,next)=>{ req.visibleClientIds=visible; next(); });
  // loadVisibleClientIds would overwrite the stub above, so neutralise it.
  const realLoad=ca.loadVisibleClientIds;
  ca.loadVisibleClientIds=(_req,_res,next)=>next();
  app.use('/api/press', require(path+'src/routes/press.js'));
  ca.loadVisibleClientIds=realLoad;
  const srv=app.listen(4399);
  const base='http://127.0.0.1:4399/api/press';
  const call=async(m,u,b)=>{ const r=await fetch(base+u,{method:m,headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
    let j=null; try{ j=await r.json(); }catch{} return {status:r.status, body:j}; };

  try{
    console.log('\nRoutes');
    let r=await call('POST',`/releases/${releaseId}/segments`,{name:'Workplace',tags:['workplace']});
    ok(r.status===201 && r.body.name==='Workplace','POST creates an audience');
    const work=r.body.id;
    r=await call('POST',`/releases/${releaseId}/segments`,{name:'Retail'});
    const retail=r.body.id;
    r=await call('GET',`/releases/${releaseId}/segments`);
    ok(r.status===200 && r.body.segments.length===2,'GET lists both audiences');

    r=await call('POST',`/segments/${work}/members`,{contact_ids:ids});
    ok(r.status===200 && r.body.added===3,'members are filed');
    r=await call('POST',`/segments/${retail}/members`,{contact_ids:ids.slice(0,2)});
    ok(r.body.conflicts.length===2 && r.body.added===0,'overlap returns conflicts, files nobody');
    r=await call('POST',`/segments/${retail}/resolve`,{contact_ids:[ids[0]],action:'move'});
    ok(r.body.moved===1,'resolve moves the one chosen');

    r=await call('PATCH',`/segments/${work}`,{intro:'Workplace note',subjects:{1:'WP subject'}});
    ok(r.status===200 && r.body.intro==='Workplace note','PATCH saves this audience’s copy');

    console.log('\nCross-tenant guard on the audience id');
    visible=[other[0].id];
    r=await call('PATCH',`/segments/${work}`,{intro:'nope'});
    ok(r.status===403,'another client cannot touch this audience');
    r=await call('GET',`/releases/${releaseId}/segments`);
    ok(r.status===403,'nor list its release’s audiences');
    visible=[clientId];

    console.log('\nSend plan and send');
    r=await call('POST',`/segments/${work}/send-plan`,{});
    ok(r.status===200 && r.body.total===2 && r.body.tailored===true,'plan counts the 2 left in Workplace and sees the tailored intro');
    ok(r.body.est_cost_usd===0,'a tailored audience is quoted at no per-recipient AI cost');
    r=await call('POST',`/segments/${work}/send`,{});
    ok(r.status===200 && r.body.recipients===2,'send queues the audience');
    ok(r.body.queued===4,'one send row per recipient per step (2 x 2), no cross-product');

    const {rows:q}=await pool.query(
      `SELECT contact_id, COUNT(*)::int n FROM outreach_sends WHERE campaign_id=$1 GROUP BY contact_id ORDER BY n DESC`,[campaignId]);
    ok(q.every(x=>x.n===2),'nobody queued more than the 2 steps');

    r=await call('POST',`/segments/${work}/send`,{});
    ok(r.status===409,'a sent audience refuses a second send');
    r=await call('PATCH',`/segments/${work}`,{intro:'late edit'});
    ok(r.status===409,'and refuses copy edits');

    r=await call('POST',`/segments/${retail}/send-plan`,{});
    ok(r.body.tailored===false && r.body.est_cost_usd>0,'an untailored audience is quoted a per-recipient cost');
  } finally {
    srv.close();
    await pool.query('DELETE FROM outreach_campaigns WHERE id=$1',[campaignId]);
    await pool.query('DELETE FROM outreach_contacts WHERE id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[[clientId,other[0].id]]);
    console.log(failures?`\n${failures} FAILED`:'\nall passed');
    await pool.end(); process.exit(failures?1:0);
  }
})();
