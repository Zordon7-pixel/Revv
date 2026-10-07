const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const { ensureDelivery } = require('../src/services/partsDelivery');
const { notifyPartUpdate } = require('../src/services/partsNotifications');
const url = process.env.PARTS_TEST_DATABASE_URL;
const smsRef = 'SM0123456789abcdef0123456789ABCDEF';
const emailRef = '01234567-89ab-cdef-0123-456789abcdef';
const epoch = Date.parse('2026-10-03T12:00:00Z');
const before = {status:'ordered',quantity:1,received_quantity:0,part_name:'Synthetic lamp'};
const after = {...before,status:'shipped'};
const options = {skip:!url};
const originalCooldown = process.env.PARTS_NOTIFICATION_COOLDOWN_SECONDS;
test.before(()=>{process.env.PARTS_NOTIFICATION_COOLDOWN_SECONDS='600';});
test.after(()=>{if(originalCooldown===undefined)delete process.env.PARTS_NOTIFICATION_COOLDOWN_SECONDS;else process.env.PARTS_NOTIFICATION_COOLDOWN_SECONDS=originalCooldown;});
async function fixture(t) {
  const address = new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(address.hostname));
  assert.equal(address.port,'55459');
  assert.equal(address.pathname,'/revv_parts_test');
  const schema = `cooldown_${randomUUID().replaceAll('-','')}`;
  const root = new Pool({connectionString:url,ssl:false});
  await root.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({connectionString:url,ssl:false,options:`-c search_path=${schema}`});
  t.after(async()=>{await db.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
  await db.query(`CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT,sms_notifications_enabled BOOLEAN,email_notifications_enabled BOOLEAN);
    CREATE TABLE customers(id TEXT,shop_id TEXT,phone TEXT,email TEXT,sms_consent BOOLEAN,sms_consent_at TIMESTAMPTZ,sms_consent_method TEXT,sms_consent_by TEXT,email_consent BOOLEAN,preferred_contact_method TEXT,PRIMARY KEY(shop_id,id));
    CREATE TABLE repair_orders(id TEXT PRIMARY KEY,shop_id TEXT,customer_id TEXT,ro_number TEXT);
    CREATE TABLE parts_orders(id TEXT PRIMARY KEY,shop_id TEXT,ro_id TEXT,status TEXT,quantity INTEGER);`);
  await ensureDelivery(db);
  let time = epoch;
  const providers = {now:()=>new Date(time).toISOString(),sendSMS:async()=>({ok:true,sid:smsRef}),sendMail:async()=>({id:emailRef})};
  async function event({shop='shop-a',customer='customer-a',id=randomUUID(),revision=2}={}) {
    const ro = randomUUID();
    await db.query("INSERT INTO shops(id,name) VALUES($1,'Synthetic shop') ON CONFLICT DO NOTHING",[shop]);
    // Deliberately identical contact values: identity must use scoped customer IDs.
    await db.query(`INSERT INTO customers VALUES($1,$2,'+15555550101','synthetic@example.test',TRUE,$3,'verbal','staff-test',TRUE,'both') ON CONFLICT DO NOTHING`,[customer,shop,new Date(epoch)]);
    await db.query('INSERT INTO repair_orders VALUES($1,$2,$3,$4)',[ro,shop,customer,'TEST-RO']);
    await db.query(`INSERT INTO parts_orders(id,shop_id,ro_id,status,quantity,delivery_revision) VALUES($1,$2,$3,'shipped',1,$4)
      ON CONFLICT(id) DO UPDATE SET delivery_revision=$4`,[id,shop,ro,revision]);
    await db.query(`INSERT INTO parts_delivery_events(id,part_id,shop_id,ro_id,revision,source,before_state,after_state)
      VALUES($1,$2,$3,$4,$5,'staff',$6,$7)`,[randomUUID(),id,shop,ro,revision,JSON.stringify(before),JSON.stringify(after)]);
    return {id,shop_id:shop,delivery_revision:revision};
  }
  const send = (part,overrides={},database=db)=>notifyPartUpdate(database,part.shop_id,part,part.delivery_revision-1,{...providers,...overrides});
  const windows = async()=>(await db.query('SELECT * FROM parts_notification_cooldowns')).rows;
  const stored = async(part)=>(await db.query('SELECT result FROM parts_delivery_notifications WHERE shop_id=$1 AND part_id=$2 AND revision=$3',[part.shop_id,part.id,part.delivery_revision])).rows[0]?.result;
  return {db,schema,event,send,windows,stored,setTime:value=>{time=value;}};
}
function worker(schema,part,time=epoch) {
  // A fresh Node process and Pool; only mocked providers, no application DB/env loading.
  const script = `const {Pool}=require('pg');
    const {notifyPartUpdate}=require('./src/services/partsNotifications');
    const [url,schema,encoded,time]=process.argv.slice(1);const part=JSON.parse(encoded);
    const db=new Pool({connectionString:url,ssl:false,options:'-c search_path='+schema});
    let sms=0,email=0;
    notifyPartUpdate(db,part.shop_id,part,part.delivery_revision-1,{
      now:()=>new Date(Number(time)).toISOString(),
      sendSMS:async()=>{sms++;return {ok:true,sid:'${smsRef}'}},
      sendMail:async()=>{email++;return {id:'${emailRef}'}}
    }).then(result=>process.stdout.write(JSON.stringify({sms,email,result})))
      .catch(()=>{process.exitCode=1}).finally(()=>db.end());`;
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',script,url,schema,JSON.stringify(part),String(time)],{
      cwd:require('node:path').resolve(__dirname,'..'),env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{errors+=chunk});
    child.on('error',reject);child.on('close',code=>{if(code!==0)reject(new Error(`Mock worker exited ${code}: ${errors}`));else {try{resolve(JSON.parse(output))}catch(e){reject(e)}}});
  });
}
test('real PG: distinct parts/ROs across processes allow one attempt per customer/channel and survive restart',options,async t=>{
  const f=await fixture(t);const parts=await Promise.all([f.event(),f.event()]);
  const results=await Promise.all(parts.map(p=>worker(f.schema,p)));
  assert.equal(results.reduce((n,r)=>n+r.sms,0),1);assert.equal(results.reduce((n,r)=>n+r.email,0),1);
  assert.equal(results.flatMap(r=>r.result.channels).filter(c=>c.reason==='cooldown').length,2);
  assert.equal((await f.windows()).length,2);
  for(const p of parts)assert.equal((await f.stored(p)).status,'complete');
  const restarted=await worker(f.schema,await f.event());
  assert.equal(restarted.sms+restarted.email,0);assert.ok(restarted.result.channels.every(c=>c.reason==='cooldown'));
  const repeated=await worker(f.schema,parts[0],epoch+3600000);
  assert.equal(repeated.result.reason,'already_requested');assert.equal(repeated.sms+repeated.email,0);
});
test('real PG: customers, shops and channels have independent windows despite shared contacts',options,async t=>{
  const f=await fixture(t);
  for(const keys of [{},{customer:'customer-b'},{shop:'shop-b'}]) {
    assert.ok((await f.send(await f.event(keys))).channels.every(c=>c.status==='accepted'));
  }
  assert.equal((await f.windows()).length,6);
  const first=await f.event({shop:'shop-c'});
  await f.db.query("UPDATE customers SET preferred_contact_method='sms' WHERE shop_id='shop-c'");
  assert.equal((await f.send(first)).channels[0].status,'accepted');
  await f.db.query("UPDATE customers SET preferred_contact_method='both' WHERE shop_id='shop-c'");
  const next=await f.send(await f.event({shop:'shop-c'}));
  assert.equal(next.channels[0].reason,'cooldown');assert.equal(next.channels[1].status,'accepted');
});
test('real PG: rolling boundary is exact; revisions and no-op cannot bypass it',options,async t=>{
  const f=await fixture(t);const part=await f.event();await f.send(part);
  f.setTime(epoch+599999);
  const next=await f.event({id:part.id,revision:3});
  assert.ok((await f.send(next)).channels.every(c=>c.reason==='cooldown'));
  f.setTime(epoch+600000);
  assert.ok((await f.send(await f.event())).channels.every(c=>c.status==='accepted'));
  assert.equal((await f.send(next)).reason,'already_requested');
  assert.equal((await notifyPartUpdate(f.db,next.shop_id,next,3,{sendSMS:()=>assert.fail()})).reason,'no_customer_change');
  f.setTime(epoch+1199999);
  assert.ok((await f.send(await f.event())).channels.every(c=>c.reason==='cooldown'));
});
test('real PG: known eligibility skips consume no cooldown',options,async t=>{
  const f=await fixture(t);
  for(const [column,value,reason] of [['sms_consent',false,'no_consent'],['preferred_contact_method','none','contact_preference'],['phone',null,'missing_contact']]) {
    const p=await f.event({customer:column});
    await f.db.query(`UPDATE customers SET ${column}=$1 WHERE id=$2 AND shop_id=$3`,[value,column,p.shop_id]);
    const result=await f.send(p,{sendSMS:()=>assert.fail('must not send')});
    assert.equal(result.channels[0].reason,reason);
    assert.equal((await f.windows()).filter(w=>w.customer_id===column && w.channel==='sms').length,0);
  }
  const p=await f.event({shop:'disabled'});
  await f.db.query('UPDATE shops SET sms_notifications_enabled=FALSE,email_notifications_enabled=FALSE WHERE id=$1',[p.shop_id]);
  assert.ok((await f.send(p,{sendSMS:()=>assert.fail(),sendMail:()=>assert.fail()})).channels.every(c=>c.reason==='shop_disabled'));
  assert.equal((await f.windows()).filter(w=>w.shop_id==='disabled').length,0);
});
test('real PG: provider-bound consent, STOP, tier and config denials release only their attempted window',options,async t=>{
  const f=await fixture(t);
  for(const reason of ['no_confirmed_consent','consent_lookup_failed','opted_out','sms_not_entitled','not configured']) {
    const p=await f.event({customer:reason});
    const result=await f.send(p,{sendSMS:async()=>({ok:false,reason,provider_attempted:false}),sendMail:async()=>null});
    assert.ok(result.channels.every(c=>c.status==='not_sent'));assert.equal((await f.windows()).length,0);
    assert.equal((await f.send(p)).reason,'already_requested');
    assert.ok((await f.send(await f.event({customer:reason}))).channels.every(c=>c.status==='accepted'));
    await f.db.query('DELETE FROM parts_notification_cooldowns WHERE customer_id=$1 AND shop_id=$2',[reason,p.shop_id]);
  }
});
test('real PG: malicious references stay out of stored/API-shaped results and keep permanent claims',options,async t=>{
  const f=await fixture(t);
  for(const channel of ['sms','email']) {
    const valid=channel==='sms'?smsRef:emailRef;
    for(const [index,ref] of [undefined,null,7,[],{},[valid],{toString(){assert.fail('must not coerce')}},valid+'\n','SECRET\u0000','SECRET'.repeat(1000),channel==='sms'?emailRef:smsRef].entries()) {
      const customer=`${channel}-${index}`;const part=await f.event({customer});
      const result=await f.send(part,{sendSMS:async()=>({ok:true,sid:channel==='sms'?ref:smsRef}),sendMail:async()=>({id:channel==='email'?ref:emailRef})});
      assert.deepEqual(result.channels.find(c=>c.channel===channel),{channel,status:'unknown',reason:'verify_before_retry'});
      assert.deepEqual(await f.stored(part),result);assert.ok(!JSON.stringify(result).includes('SECRET'));
      assert.equal((await f.send(part)).reason,'already_requested');
      assert.ok((await f.send(await f.event({customer}))).channels.every(c=>c.reason==='cooldown'));
    }
  }
});
test('real PG: timeout, failed history write and lost claim acknowledgement never permit immediate resend',options,async t=>{
  const f=await fixture(t);let sends=0;
  const part=await f.event();
  const unknown=await f.send(part,{timeoutMs:5,sendSMS:()=>{sends++;return new Promise(()=>{})}});
  assert.equal(unknown.channels[0].status,'unknown');
  assert.ok((await f.send(await f.event())).channels.every(c=>c.reason==='cooldown'));assert.equal(sends,1);
  const p=await f.event({customer:'history-failure'});
  const broken={connect:()=>f.db.connect(),query:async(sql,args)=>{if(sql.startsWith('UPDATE parts_delivery_notifications'))throw Error('synthetic history failure');return f.db.query(sql,args)}};
  await assert.rejects(f.send(p,{},broken),/synthetic history failure/);
  assert.deepEqual(await f.stored(p),{status:'pending',channels:[]});
  assert.equal((await f.send(p)).reason,'already_requested');
  assert.ok((await f.send(await f.event({customer:'history-failure'}))).channels.every(c=>c.reason==='cooldown'));
  const lost={connect:()=>f.db.connect(),query:async(sql,args)=>{const result=await f.db.query(sql,args);if(sql.startsWith('WITH clock'))throw Error('lost acknowledgement');return result}};
  const q=await f.event({customer:'lost-claim'});
  assert.ok((await f.send(q,{sendSMS:()=>assert.fail(),sendMail:()=>assert.fail()},lost)).channels.every(c=>c.status==='unknown'));
  assert.ok((await f.send(await f.event({customer:'lost-claim'}))).channels.every(c=>c.reason==='cooldown'));
  f.setTime(epoch+3600000);
  assert.equal((await f.send(p)).reason,'already_requested');assert.equal((await f.send(part)).reason,'already_requested');
});
test('real PG: a late known denial cannot delete a newer claim',options,async t=>{
  const f=await fixture(t);const first=await f.event();
  let release,entered;const reached=new Promise(r=>{entered=r});
  const pending=f.send(first,{sendSMS:()=>{entered();return new Promise(r=>{release=r})},sendMail:async()=>null});
  await reached;f.setTime(epoch+600000);
  const next=await f.event();assert.equal((await f.send(next)).channels[0].status,'accepted');
  release({ok:false,reason:'opted_out',provider_attempted:false});await pending;
  assert.equal((await f.send(await f.event())).channels[0].reason,'cooldown');
});
