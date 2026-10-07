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

    console.log('\nThe preview picker reads the audience');
    {
      const r2 = await call('GET', `/segments/${work}/members`);
      ok(r2.status === 200 && r2.body.members.length === 2, 'GET members returns the audience’s sendable people');
      ok(r2.body.members.every((m) => m.email && 'country' in m), 'with the fields the picker shows');
      visible = [other[0].id];
      ok((await call('GET', `/segments/${work}/members`)).status === 403, 'and is behind the cross-tenant guard');
      visible = [clientId];
    }

    console.log('\nThe sanity check reads the audiences, not the step-1 tags');
    {
      // It used to be handed the tag picker's selection, which a release built
      // from audiences never touches: three audiences and 2,180 recipients were
      // reviewed as "no tags selected — no audience at all, cannot send".
      let seen = '';
      require.cache[require.resolve(path + 'src/services/claude.js')] = {
        id: 'claude', loaded: true,
        exports: { callClaude: async ({ user }) => { seen = user; return '{"rating":"good","verdict":"ok","checks":[]}'; } },
      };
      const r2 = await call('POST', `/releases/${releaseId}/review`, { tags: [], recipient_count: 0 });
      ok(r2.status === 200, 'the review runs');
      ok(!/no tags selected|unknown size/.test(seen), 'it is never told there is no audience when audiences exist');
      ok(/Workplace/.test(seen) && /Retail/.test(seen), 'every audience is named');
      ok(/2 sendable of 2/.test(seen), 'with its sendable count, not the posted zero');
      ok(/WP subject/.test(seen), 'and the subject line that audience actually overrides');
      ok(/Shared follow-up/.test(seen), 'the shared sequence is still there for the audiences that use it');
      delete require.cache[require.resolve(path + 'src/services/claude.js')];
    }

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

    console.log('\nScheduling a send for later, and calling it back');
    {
      // Nobody wants a press release landing at 11pm. Scheduling is only safe
      // if it can be cancelled before it goes, so the two are tested together.
      const at = new Date(Date.now() + 9*3600*1000);         // ~8am tomorrow
      let r2 = await call('POST',`/segments/${retail}/send`,{ send_at: at.toISOString() });
      ok(r2.status===200 && r2.body.recipients===1,'the audience queues against a future time');
      ok(r2.body.scheduled_at===at.toISOString(),'and the send reports the time it is set for');

      const {rows:q}=await pool.query(
        `SELECT seq.step_number, os.scheduled_at FROM outreach_sends os
           JOIN outreach_sequences seq ON seq.id=os.sequence_id
          WHERE os.campaign_id=$1 AND os.contact_id=$2 ORDER BY seq.step_number`,
        [campaignId, (await pool.query(
          'SELECT contact_id FROM outreach_campaign_contacts WHERE segment_id=$1 LIMIT 1',[retail])).rows[0].contact_id]);
      ok(q.length===2,'both steps queued');
      ok(Math.abs(new Date(q[0].scheduled_at)-at)<2000,'step 1 lands at the time chosen, not now');
      const gapDays = (new Date(q[1].scheduled_at)-new Date(q[0].scheduled_at))/86400000;
      ok(Math.abs(gapDays-5)<0.01,'the day-5 follow-up is 5 days after it lands, not 5 days after the click');

      r2 = await call('GET',`/releases/${releaseId}/scheduled`);
      ok(r2.body.recipients===1 && Math.abs(new Date(r2.body.send_at)-at)<2000,'the release reports what is waiting to go');

      // Workplace really went out earlier in this test, so mark its first
      // emails sent. Until the cron runs they are only 'pending', and a cancel
      // cannot tell a sent audience from a queued one by the segment row alone.
      await pool.query(
        `UPDATE outreach_sends os SET status='sent', sent_at=NOW()
           FROM outreach_sequences seq, outreach_campaign_contacts cc
          WHERE seq.id=os.sequence_id AND seq.step_number=1
            AND cc.campaign_id=os.campaign_id AND cc.contact_id=os.contact_id
            AND cc.segment_id=$1`, [work]);

      r2 = await call('POST',`/releases/${releaseId}/cancel-scheduled`,{});
      ok(r2.status===200 && r2.body.cancelled===2,'cancelling drops the queued rows');
      ok(r2.body.reopened.includes('Retail'),'and reopens the audience so the copy can be fixed');
      ok((await call('GET',`/releases/${releaseId}/scheduled`)).body.recipients===0,'nothing is left waiting');

      // Workplace was really sent earlier in this test. Its follow-ups must
      // survive a cancel — pulling them would drop the sequence on people who
      // have already had the release.
      const {rows:left}=await pool.query(
        `SELECT COUNT(*)::int n FROM outreach_sends WHERE campaign_id=$1`,[campaignId]);
      ok(left[0].n===4,'the already-sent audience keeps its sent emails and its follow-ups');
      const {rows:segs}=await pool.query(
        'SELECT name,sent_at FROM outreach_campaign_segments WHERE campaign_id=$1',[campaignId]);
      ok(segs.find(x=>x.name==='Workplace').sent_at!==null,'and stays frozen');

      r2 = await call('POST',`/segments/${retail}/send`,{ send_at: at.toISOString() });
      ok(r2.status===200 && r2.body.queued===2,'the cancelled audience can be queued again');
      await call('POST',`/releases/${releaseId}/cancel-scheduled`,{});

      r2 = await call('POST',`/segments/${retail}/send`,{ send_at: 'not a date' });
      ok(r2.status===400,'a send time that is not a date is refused');
      r2 = await call('POST',`/segments/${retail}/send`,{ send_at: new Date(Date.now()+200*86400000).toISOString() });
      ok(r2.status===400,'and one 200 days out is refused');
      r2 = await call('POST',`/segments/${retail}/send`,{ send_at: new Date(Date.now()-3600*1000).toISOString() });
      ok(r2.status===200 && r2.body.scheduled_at===null,'a time in the past is a send now, never a queue that never fires');
    }
  } finally {
    srv.close();
    await pool.query('DELETE FROM outreach_campaigns WHERE id=$1',[campaignId]);
    await pool.query('DELETE FROM outreach_contacts WHERE id=ANY($1::uuid[])',[ids]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[[clientId,other[0].id]]);
    console.log(failures?`\n${failures} FAILED`:'\nall passed');
    await pool.end(); process.exit(failures?1:0);
  }
})();
