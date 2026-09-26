const test=require('node:test');
const assert=require('node:assert/strict');
const {normalize,customerPart,summarize}=require('../src/services/partsDelivery');
const {trackingUrl}=require('../src/services/trackingCarrier');
const old={part_name:'Lamp',status:'ordered',quantity:4,received_quantity:0,expected_date:'2026-10-01',eta_source:'supplier'};
test('validates statuses, quantities, dates and supplier inputs',()=>{
  for(const body of [{status:'invented'},{quantity:0},{quantity:1.5},{quantity:true},{unit_cost:-1},{expected_date:'2026-02-30'},{eta_source:'ai'},{supplier_order_ref:{}},{customer_note:'x'.repeat(501)},{tracking_number:[]}]) assert.throws(()=>normalize(body,old));
  assert.equal(normalize({expected_date:'2026-10-02'},old).eta_source,'shop');
  assert.equal(normalize({expected_date:''},old).eta_source,'unknown');
});
test('partial and final receipts are explicit, bounded and date-consistent',()=>{
  const partial=normalize({status:'partially_received',received_quantity:2},old);
  assert.equal(partial.received_quantity,2);assert.equal(partial.received_date,null);
  assert.throws(()=>normalize({status:'received',received_quantity:2},old));
  assert.throws(()=>normalize({status:'partially_received',received_quantity:4},old));
  assert.throws(()=>normalize({received_quantity:5},old));
  assert.equal(normalize({status:'received'},old).received_quantity,4);
  assert.equal(normalize({received_date:'2026-10-01'},old).received_date,null);
  const received={...old,status:'received',received_quantity:4,received_date:'2026-10-01'};
  assert.equal(normalize({received_date:null},received).received_date,'2026-10-01');
});
test('replaced and removed tracking numbers clear stale carrier observations',()=>{
  const tracked={...old,tracking_number:'old',tracking_status:'delivered',tracking_detail:'private'};
  for(const tracking_number of ['new','']) {const next=normalize({tracking_number},tracked);assert.equal(next.tracking_status,null);assert.equal(next.tracking_detail,null);assert.equal(next.tracking_updated_at,null);}
});
test('public projection excludes supplier, money, private notes and tracking identifiers',()=>{
  const projected=customerPart({...old,vendor:'PRIVATE',unit_cost:100,notes:'PRIVATE',supplier_order_ref:'PRIVATE',tracking_number:'PRIVATE',tracking_detail:'PRIVATE',customer_note:'Waiting for lamp',tracking_status:'delivered'});
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.equal(projected.carrier_delivered,true);assert.equal(projected.customer_note,'Waiting for lamp');
});
test('summary never promises an arrival date when any order is uncertain, overdue or backordered',()=>{
  assert.equal(summarize([old],'2026-09-26').latest_expected_date,'2026-10-01');
  for(const p of [{...old,expected_date:null},{...old,status:'backordered'},{...old,eta_source:'unknown'},{...old,expected_date:'2026-09-20'}]) assert.equal(summarize([old,p],'2026-09-26').latest_expected_date,null);
  const done=summarize([{...old,status:'received'}]);assert.equal(done.waiting,false);assert.match(done.message,/received/);
});
test('tracking links safely encode user input',()=>{assert.ok(trackingUrl('ups','A&redirect=https://evil.test').includes('%26'));});
test('delivery request notes and credentials are scrubbed from telemetry',()=>{
  const path=require.resolve('@sentry/node');const existing=require.cache[path];let config;
  require.cache[path]={id:path,filename:path,loaded:true,exports:{init:value=>{config=value}}};
  const oldDsn=process.env.SENTRY_DSN_BACKEND;process.env.SENTRY_DSN_BACKEND='test';
  const modulePath=require.resolve('../src/lib/sentry');delete require.cache[modulePath];
  try {
    require(modulePath).init();
    const event=config.beforeSend({request:{url:'https://revv.test/api/parts/test/delivery',data:{notes:'PRIVATE',customer_note:'PRIVATE'},headers:{Authorization:'SECRET'}}});
    assert.equal(event.request.data,'[scrubbed: PII path]');assert.equal(event.request.headers.Authorization,'[scrubbed]');
  } finally {if(existing)require.cache[path]=existing;else delete require.cache[path];delete require.cache[modulePath];if(oldDsn===undefined)delete process.env.SENTRY_DSN_BACKEND;else process.env.SENTRY_DSN_BACKEND=oldDsn;}
});
