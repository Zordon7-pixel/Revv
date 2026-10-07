const test=require('node:test');const assert=require('node:assert/strict');
const {publicChange,content,channelAllowed,notifyPartUpdate,validateNotificationRequest,cooldownSeconds}=require('../src/services/partsNotifications');
const smsRef='SM0123456789abcdef0123456789ABCDEF';
const emailRef='01234567-89ab-cdef-0123-456789abcdef';
const before={part_name:'Headlamp',status:'ordered',quantity:2,received_quantity:0,expected_date:null,eta_source:'unknown',customer_note:null};
const after={...before,status:'shipped',expected_date:'2026-10-01',eta_source:'supplier',customer_note:'Arrival estimate updated.'};
const context={customer_id:'customer-test',before_state:before,after_state:after,shop_name:'Test <shop>',ro_number:'RO-TEST',phone:'+15555550101',email:'synthetic@example.test',sms_consent:true,sms_consent_at:"2026-10-01T12:00:00Z",sms_consent_method:"verbal",sms_consent_by:"staff-test",email_consent:true,preferred_contact_method:'both'};
function fakeDb(overrides={}) {
  const calls=[];let claimed=false;
  const db={calls,connect:async()=>({query:async()=>({rows:[]}),release(){}}),query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT e.'))return {rows:overrides.missing?[]:[{...context,...overrides}]};
    if(sql.startsWith('INSERT INTO parts_delivery_notifications')){if(claimed)return {rowCount:0};claimed=true;return {rowCount:1};}
    return {rows:[],rowCount:1};
  }};return db;
}
const part={id:'part-test',delivery_revision:2};
test('private fields, carrier details, timestamps and no-op do not qualify',()=>{
  assert.equal(publicChange(before,{...before,vendor:'SECRET',supplier_order_ref:'SECRET',tracking_status:'delivered',updated_at:'later'}),false);
  assert.equal(publicChange(before,after),true);assert.equal(publicChange(null,after),false);
  assert.throws(()=>validateNotificationRequest({notify_customer:'yes'}));
});
test('safe content excludes private fields and escapes HTML without claiming vehicle completion',()=>{
  const msg=content(context,{...after,unit_cost:9999,tracking_number:'SECRET',supplier_order_ref:'SECRET',vendor:'SECRET',notes:'SECRET'});
  assert.ok(!JSON.stringify(msg).includes('SECRET'));assert.ok(!JSON.stringify(msg).includes('9999'));
  assert.match(msg.html,/Test &lt;shop&gt;/);assert.match(msg.text,/supplier estimate/);assert.match(msg.text,/do not confirm when vehicle repairs will be complete/);
});
test('preferences, explicit consent, switches and missing contacts gate each channel',()=>{
  for(const channel of ['sms','email']) {
    assert.equal(channelAllowed(context,channel),null);
    assert.equal(channelAllowed({...context,[`${channel}_consent`]:false},channel),'no_consent');
    assert.equal(channelAllowed({...context,[`${channel}_notifications_enabled`]:false},channel),'shop_disabled');
    assert.equal(channelAllowed({...context,preferred_contact_method:'none'},channel),'contact_preference');
  }
  assert.equal(channelAllowed({...context,preferred_contact_method:'email'},'sms'),'contact_preference');
  assert.equal(channelAllowed({...context,phone:null},'sms'),'missing_contact');
});
test('no-op and missing tenant event never call providers',async()=>{
  const send=async()=>{throw Error('must not send')};
  assert.equal((await notifyPartUpdate(fakeDb(),'shop-test',part,2,{sendSMS:send,sendMail:send})).reason,'no_customer_change');
  const db=fakeDb({missing:true});assert.equal((await notifyPartUpdate(db,'shop-other',part,1,{sendSMS:send,sendMail:send})).reason,'no_customer_change');
  assert.deepEqual(db.calls[0].params,['part-test','shop-other',2]);
});
test('concurrent same-event requests claim once and report provider acceptance',async()=>{
  const db=fakeDb();let sms=0,email=0;
  const providers={sendSMS:async(phone,body,options)=>{sms++;assert.equal(options.shopId,'shop-test');return {ok:true,sid:smsRef};},sendMail:async()=>{email++;return {id:emailRef};}};
  const results=await Promise.all([notifyPartUpdate(db,'shop-test',part,1,providers),notifyPartUpdate(db,'shop-test',part,1,providers)]);
  assert.equal(sms,1);assert.equal(email,1);assert.equal(results.filter(r=>r.reason==='already_requested').length,1);
  assert.equal(results.find(r=>r.status==='complete').channels.filter(c=>c.status==='accepted').length,2);
  assert.deepEqual(results.find(r=>r.status==='complete').channels.map(c=>c.provider_reference),[smsRef,emailRef]);
  assert.deepEqual(JSON.parse(db.calls.find(c=>c.sql.startsWith('UPDATE parts_delivery_notifications')).params[3]),results.find(r=>r.status==='complete'));
});
test('STOP/plan/config outcomes are honest and provider failure never leaks errors or retries',async()=>{
  for(const reason of ['opted_out','sms_not_entitled','not configured','SECRET provider error']) {
    const db=fakeDb();const result=await notifyPartUpdate(db,'shop-test',part,1,{sendSMS:async()=>({ok:false,reason}),sendMail:async()=>null});
    assert.ok(result.channels.every(c=>c.status==='not_sent'));assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.equal((await notifyPartUpdate(db,'shop-test',part,1)).reason,'already_requested');
  }
  const unknown=await notifyPartUpdate(fakeDb(),'shop-test',part,1,{sendSMS:async()=>{throw Error('timeout')},sendMail:async()=>({id:emailRef})});
  assert.equal(unknown.channels[0].status,'unknown');assert.equal(unknown.channels[1].status,'accepted');
});
test('consent suppression records skipped channels without provider calls',async()=>{
  const result=await notifyPartUpdate(fakeDb({sms_consent:false,email_consent:false}),'shop-test',part,1,{sendSMS:()=>assert.fail(),sendMail:()=>assert.fail()});
  assert.ok(result.channels.every(c=>c.reason==='no_consent'));
});
test('provider wait is bounded; an ambiguous result retains claim and cannot resend',async()=>{
  const db=fakeDb();const started=Date.now();
  const result=await notifyPartUpdate(db,'shop-test',part,1,{timeoutMs:10,sendSMS:()=>new Promise(()=>{}),sendMail:async()=>({id:emailRef})});
  assert.ok(Date.now()-started<1000);assert.equal(result.channels[0].status,'unknown');assert.equal(result.channels[1].provider_reference,emailRef);
  assert.equal((await notifyPartUpdate(db,'shop-test',part,1)).reason,'already_requested');
});

test('cooldown config is bounded, integral and cannot be disabled',()=>{
  for(const value of [undefined,'','0','-1','59','3601','Infinity','NaN','600.5','6e2',' 600 ',null,600,{},'9999999'])
    assert.equal(cooldownSeconds(value),600);
  for(const value of ['60','601','3600'])assert.equal(cooldownSeconds(value),Number(value));
});
for(const channel of ['sms','email']) test(`${channel} references reject untrusted values without coercion, logging or resend`,async t=>{
  const logs=['log','warn','error'].map(method=>t.mock.method(console,method,()=>{}));
  let coerced=0;
  const bad=[undefined,null,123,[],{},[channel==='sms'?smsRef:emailRef],{toString(){coerced++;throw Error('must not coerce')}},
    'SECRET', 'x'.repeat(10000), (channel==='sms'?smsRef:emailRef)+'\n', '\u0000'+(channel==='sms'?smsRef:emailRef),
    channel==='sms'?emailRef:smsRef];
  for(const ref of bad){
    const db=fakeDb({preferred_contact_method:channel});let sends=0;
    const providers={sendSMS:async()=>{sends++;return {ok:true,sid:ref,id:emailRef}},sendMail:async()=>{sends++;return {id:ref,sid:smsRef}}};
    const result=await notifyPartUpdate(db,'shop-test',part,1,providers);
    assert.deepEqual(result.channels.find(c=>c.channel===channel),{channel,status:'unknown',reason:'verify_before_retry'});
    const history=JSON.parse(db.calls.find(c=>c.sql.startsWith('UPDATE parts_delivery_notifications')).params[3]);
    assert.deepEqual(history,result);
    assert.equal((await notifyPartUpdate(db,'shop-test',part,1,providers)).reason,'already_requested');
    assert.equal(sends,1);
    assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM parts_notification_cooldowns')),false);
  }
  assert.equal(coerced,0);
  assert.ok(logs.every(log=>log.mock.callCount()===0));
});
test('channel crossover is rejected even with a valid reference on the other field',async()=>{
  const result=await notifyPartUpdate(fakeDb(),'shop-test',part,1,{sendSMS:async()=>({ok:true,id:smsRef}),sendMail:async()=>({sid:emailRef})});
  assert.ok(result.channels.every(c=>c.status==='unknown' && !('provider_reference' in c)));
});
test('untrusted reason objects are never coerced',async()=>{
  const result=await notifyPartUpdate(fakeDb(),'shop-test',part,1,{sendSMS:async()=>({ok:false,reason:{toString(){assert.fail('coercion')}}}),sendMail:async()=>null});
  assert.equal(result.channels[0].reason,'provider_failed');
});

test('only explicit no-attempt evidence releases a window; matching provider error text cannot',async()=>{
  for(const reason of ['no_confirmed_consent','consent_lookup_failed','opted_out','sms_not_entitled','not configured']) {
    for(const marked of [false,true]) {
      const db=fakeDb({preferred_contact_method:'sms'});
      const result=await notifyPartUpdate(db,'shop-test',part,1,{sendSMS:async()=>({ok:false,reason,...(marked?{provider_attempted:false}:{})})});
      assert.equal(result.channels[0].status,'not_sent');
      assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM parts_notification_cooldowns')),marked);
    }
  }
});

test('cooldown denial and uncertain acquisition fail closed before provider calls',async()=>{
  for(const failClaim of [false,true]) {
    const db=fakeDb(),query=db.query;
    db.query=async(sql,params)=>{
      if(sql.startsWith('WITH clock')) {if(failClaim)throw Error('synthetic database failure');return {rowCount:0,rows:[]};}
      return query(sql,params);
    };
    const result=await notifyPartUpdate(db,'shop-test',part,1,{sendSMS:()=>assert.fail('provider must not run'),sendMail:()=>assert.fail('provider must not run')});
    assert.ok(result.channels.every(c=>c.reason===(failClaim?'verify_before_retry':'cooldown')));
    assert.equal((await notifyPartUpdate(db,'shop-test',part,1)).reason,'already_requested');
  }
});
test('known initial eligibility skips never acquire a cooldown',async()=>{
  const db=fakeDb({sms_consent:false,email_consent:false});
  await notifyPartUpdate(db,'shop-test',part,1,{sendSMS:()=>assert.fail(),sendMail:()=>assert.fail()});
  assert.equal(db.calls.some(c=>c.sql.startsWith('WITH clock')),false);
});
