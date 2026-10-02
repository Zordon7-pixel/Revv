const test=require('node:test');const assert=require('node:assert/strict');
const {publicChange,content,channelAllowed,notifyPartUpdate,validateNotificationRequest}=require('../src/services/partsNotifications');
const before={part_name:'Headlamp',status:'ordered',quantity:2,received_quantity:0,expected_date:null,eta_source:'unknown',customer_note:null};
const after={...before,status:'shipped',expected_date:'2026-10-01',eta_source:'supplier',customer_note:'Arrival estimate updated.'};
const context={before_state:before,after_state:after,shop_name:'Test <shop>',ro_number:'RO-TEST',phone:'+15555550101',email:'synthetic@example.test',sms_consent:true,sms_consent_at:"2026-10-01T12:00:00Z",sms_consent_method:"verbal",sms_consent_by:"staff-test",email_consent:true,preferred_contact_method:'both'};
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
  const providers={sendSMS:async(phone,body,options)=>{sms++;assert.equal(options.shopId,'shop-test');return {ok:true,sid:'fake'};},sendMail:async()=>{email++;return {id:'fake'};}};
  const results=await Promise.all([notifyPartUpdate(db,'shop-test',part,1,providers),notifyPartUpdate(db,'shop-test',part,1,providers)]);
  assert.equal(sms,1);assert.equal(email,1);assert.equal(results.filter(r=>r.reason==='already_requested').length,1);
  assert.equal(results.find(r=>r.status==='complete').channels.filter(c=>c.status==='accepted').length,2);
});
test('STOP/plan/config outcomes are honest and provider failure never leaks errors or retries',async()=>{
  for(const reason of ['opted_out','sms_not_entitled','not configured','SECRET provider error']) {
    const db=fakeDb();const result=await notifyPartUpdate(db,'shop-test',part,1,{sendSMS:async()=>({ok:false,reason}),sendMail:async()=>null});
    assert.ok(result.channels.every(c=>c.status==='not_sent'));assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.equal((await notifyPartUpdate(db,'shop-test',part,1)).reason,'already_requested');
  }
  const unknown=await notifyPartUpdate(fakeDb(),'shop-test',part,1,{sendSMS:async()=>{throw Error('timeout')},sendMail:async()=>({id:'fake'})});
  assert.equal(unknown.channels[0].status,'unknown');assert.equal(unknown.channels[1].status,'accepted');
});
test('consent suppression records skipped channels without provider calls',async()=>{
  const result=await notifyPartUpdate(fakeDb({sms_consent:false,email_consent:false}),'shop-test',part,1,{sendSMS:()=>assert.fail(),sendMail:()=>assert.fail()});
  assert.ok(result.channels.every(c=>c.reason==='no_consent'));
});
test('provider wait is bounded; an ambiguous result retains claim and cannot resend',async()=>{
  const db=fakeDb();const started=Date.now();
  const result=await notifyPartUpdate(db,'shop-test',part,1,{timeoutMs:10,sendSMS:()=>new Promise(()=>{}),sendMail:async()=>({id:'synthetic-ref'})});
  assert.ok(Date.now()-started<1000);assert.equal(result.channels[0].status,'unknown');assert.equal(result.channels[1].provider_reference,'synthetic-ref');
  assert.equal((await notifyPartUpdate(db,'shop-test',part,1)).reason,'already_requested');
});
