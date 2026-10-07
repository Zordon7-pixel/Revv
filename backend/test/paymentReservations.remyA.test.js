'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const roles = require('../src/middleware/roles');

// No dotenv, production database module, Stripe SDK or outbound transport is loaded.
function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} }, local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express','uuid','crypto','node:crypto','jsonwebtoken'].includes(name)) return local(name);
    throw Error(`Unmocked dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}
function providers() {
  const objects = new Map(), calls = [];
  const control = { configured: true, failCancel: false, pendingCancel: false };
  const retrieve = async id => { calls.push(['retrieve',id]); assert.ok(objects.has(id)); return {...objects.get(id)}; };
  const cancel = async id => {
    calls.push(['cancel',id]);
    if (control.failCancel) throw Error('SECRET PRIVATE PROVIDER DETAIL');
    const o=objects.get(id); assert.ok(o);
    if (!control.pendingCancel && o.status !== 'succeeded') o.status='canceled';
    return {...o};
  };
  const client = {
    paymentIntents: { retrieve, cancel },
    checkout: { sessions: {
      retrieve,
      create: async (args, opts) => {
        calls.push(['createCheckout',args,opts]);
        const o={id:`cs_${randomUUID()}`,status:'open',payment_status:'unpaid',amount_total:args.line_items[0].price_data.unit_amount,
          currency:'usd',metadata:args.metadata,payment_intent:null,url:'https://mock.invalid/pay',expires_at:Math.floor(Date.now()/1000)+86400};
        objects.set(o.id,o); return {...o};
      },
      expire: async id => {
        calls.push(['expire',id]);
        if(control.failCancel) throw Error('SECRET PRIVATE PROVIDER DETAIL');
        const o=objects.get(id); assert.ok(o);
        if(!control.pendingCancel && o.status==='open') o.status='expired';
        return {...o};
      },
    } },
  };
  return { objects, calls, control, stripe: {
    getStripeClient: () => control.configured ? client : null,
    createPaymentIntent: async (amount,currency,metadata,key) => {
      calls.push(['createIntent',amount,key]);
      const o={id:`pi_${randomUUID()}`,status:'requires_payment_method',amount,currency,metadata,client_secret:'MOCK_SECRET'};
      objects.set(o.id,o);return {...o};
    },
    constructWebhookEvent: body => body,
  } };
}
function wire(db, p, auth = (_q,_s,next)=>next()) {
  const money=load('services/roMoney.js',{'../db':db});
  const notifications=load('services/notifications.js',{'../db':db});
  const reservations=load('services/paymentReservations.js',{'../db':db,'./roMoney':money,'./stripe':p.stripe,'./notifications':notifications});
  const billing=load('services/customerBilling.js',{'../db':db,'./stripe':p.stripe,'./roMoney':money,
    './paymentReservations':reservations,'./mailer':{sendMail:async()=>{}},'./emailTemplates':{}});
  const shared={'../db':db,'../middleware/auth':auth,'../middleware/roles':roles,
    '../services/paymentReservations':reservations,'../services/roMoney':money,'../services/customerBilling':billing};
  const payments=load('routes/payments.js',{...shared,'../services/stripe':p.stripe,
    '../services/notifications':{createNotification:async()=>{}},'../services/mailer':{},'../services/emailTemplates':{}});
  const mocks={...shared, '../middleware/roLimitGuard':(_q,_s,next)=>next(),
    'express-rate-limit':()=> (_q,_s,next)=>next(), './insuranceOcr':{insuranceOcrLimiter:(_q,_s,next)=>next()},
    '../services/panelEstimatorApproval':{panelPublicHandler:()=> (_q,_s,next)=>next(),publicRequestError:()=> (_q,_s,next)=>next(),noStore:(_q,_s,next)=>next()},
    '../services/profit':{calculateProfit:()=>({})}, '../services/roMoney':money,
    '../services/panelEstimatorEconomics':{selectedEconomics:async()=>new Map(),redactSelectedRO:r=>r},
    '../services/sms':{isConfiguredForShop:async()=>false},
    '../services/mailer':{sendMail:async()=>{}},'../services/emailTemplates':{statusChangeEmail:()=>({subject:'Status',html:'Status'})},
    '../services/ownerActivity':{recordOwnerActivity:()=>{}},
    '../services/notifications':{createNotification:async()=>{}},
  };
  for(const name of ['customerConsent','deliveryFees','quickbooks','customerOptInConfirmation']) mocks[`../services/${name}`]={};
  return {payments,ros:load('routes/ros.js',mocks),reservations,billing,money};
}
async function invoke(router, route, body={}, role='owner', shop='shop') {
  const layer=router.stack.find(l=>l.route?.path===route);
  const req={body,params:{id:'ro',roId:'ro'},headers:{'stripe-signature':'mock'},user:{id:'actor',role,shop_id:shop}};
  const res={statusCode:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  const pending=[];let i=0;
  const next=()=>{const result=layer.route.stack[i++]?.handle(req,res,next);if(result?.then)pending.push(result);};
  next();await Promise.all(pending);return res;
}
function memoryFixture() {
  const state={ro:{id:'ro',shop_id:'shop',ro_number:'TEST',status:'ready',payment_status:'unpaid',amount_paid_cents:0},attempts:[],ledger:[],audit:[],investigations:[],notifications:[]};
  const queries=[];
  const query=async(sql,a=[])=> {
    queries.push(sql);let rows=[];
    if (/SELECT \* FROM repair_orders/.test(sql)) rows=a[1] && a[1]!=='shop'?[]:[state.ro];
    else if (/SELECT \* FROM ro_payment_attempts/.test(sql)) {
      rows=state.attempts.filter(r=> /WHERE id =/.test(sql)?r.id===a[0]:/WHERE shop_id =/.test(sql)?
        (r.stripe_payment_intent_id===a[2] || r.stripe_checkout_session_id===a[3]):true);
      rows=rows.map(r=>({...r}));
    } else if (/SELECT \* FROM ro_payments/.test(sql)) rows=state.ledger.filter(r=>/WHERE stripe_payment_intent_id/.test(sql)?r.stripe_payment_intent_id===a[0]:true);
    else if (/SUM\(amount_cents\)/.test(sql)) rows=[{paid_cents:state.ledger.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount_cents,0)}];
    else if (/to_regclass/.test(sql)) rows=[{revisions:null,pointer:false}];
    else if (/FROM estimate_line_items/.test(sql)) rows=[{subtotal:100,taxable_subtotal:0,line_count:1}];
    else if (/COALESCE\(tax_rate/.test(sql)) rows=[{tax_rate:0}];
    else if (/INSERT INTO ro_payment_attempts/.test(sql)) state.attempts.push({id:a[0],shop_id:a[1],ro_id:a[2],idempotency_key:a[3],amount_cents:a[4],kind:a[5],status:'reserved',created_at:new Date()});
    else if (/UPDATE ro_payment_attempts SET status/.test(sql)) {
      const r=state.attempts.find(r=>r.id===a[1]); if(!['settled','released'].includes(r.status))r.status=a[0];
    } else if (/UPDATE ro_payment_attempts SET/.test(sql)) {
      const r=state.attempts.find(r=>r.id===a[3]);r.stripe_payment_intent_id ||= a[0];r.stripe_checkout_session_id ||= a[1];
      if(!['settled','released'].includes(r.status))r.status=a[2];
    } else if (/INSERT INTO ro_payment_attempt_audit/.test(sql)) state.audit.push({id:a[0],shop_id:a[1],ro_id:a[2],attempt_id:a[3],actor_id:a[4],action:a[5],prior_state:a[6],outcome:a[7],created_at:new Date()});
    else if (/INSERT INTO ro_payment_investigations/.test(sql)) {
      if(!state.investigations.some(r=>r.shop_id===a[1] && r.attempt_id===a[3])) {
        const row={id:a[0],shop_id:a[1],ro_id:a[2],attempt_id:a[3],event_type:a[4]};state.investigations.push(row);rows=[row];
      }
    }
    else if (/SELECT id FROM users/.test(sql)) rows=[{id:'actor'},{id:'admin'}];
    else if (/INSERT INTO notifications/.test(sql)) state.notifications.push({id:a[0],shop_id:a[1],user_id:a[2],title:a[3],body:a[4],ro_id:a[5]});
    else if (/INSERT INTO ro_payments/.test(sql)) state.ledger.push({id:a[0],shop_id:a[1],ro_id:a[2],stripe_payment_intent_id:a[3],amount_cents:a[4],currency:'usd',status:'succeeded'});
    else if (/UPDATE ro_payments SET status = 'succeeded'/.test(sql)) state.ledger.find(r=>r.id===a[1]).status='succeeded';
    else if (/UPDATE ro_payments SET status = 'failed'/.test(sql)) {const r=state.ledger.find(r=>r.id===a[0]);if(r.status!=='succeeded')r.status='failed';}
    else if (/UPDATE repair_orders SET payment_status/.test(sql)) Object.assign(state.ro,{payment_status:a[0],amount_paid_cents:a[6],payment_received:a[2]});
    else if (/UPDATE repair_orders\s+SET payment_received/.test(sql)) Object.assign(state.ro,{payment_status:'paid',amount_paid_cents:a[3],payment_received:1});
    return {rows,rowCount:rows.length};
  };
  const db={pool:{connect:async()=>({query,release(){}})},dbGet:async(sql,a)=>/row_to_json|quickbooks|invoice_emailed/.test(sql)?null:/portal_tokens/.test(sql)?{token:'mock'}:(await query(sql,a)).rows[0],dbAll:async()=>[],dbRun:query};
  const p=providers();return {...wire(db,p),...p,state,queries,db};
}
const reserveIntent=f=>invoke(f.payments,'/intent',{ro_id:'ro'});
const cash=f=>invoke(f.ros,'/:id/mark-paid',{payment_method:'cash'});
const webhook=(f,type,o)=>f.reservations.settlePaymentEvent({type,data:{object:{...o}}});
const held=f=>f.state.attempts.filter(a=>!['settled','released'].includes(a.status)).reduce((n,a)=>n+Number(a.amount_cents),0);

for (const [label, status, context, createsLink] of [
  ['unpaid delivery', 'delivery', {}, true],
  ['paid delivery', 'delivery', {payment_status:'paid'}, false],
  ['succeeded delivery', 'delivery', {payment_status:'succeeded'}, false],
  ['email consent withheld', 'delivery', {customer_email_consent:false}, false],
  ['shop email disabled', 'delivery', {email_notifications_enabled:false}, false],
  ['no tenant customer email', 'delivery', {customer_email:null}, false],
  ['repair is not ready for pickup', 'repair', {}, false],
]) test(`status email contract: ${label}`,async()=>{
  const f=memoryFixture(),dbGet=f.db.dbGet;
  f.db.dbGet=async(sql,a)=>/SELECT ro\.ro_number, ro\.payment_status/.test(sql)
    ? {ro_number:'TEST',payment_status:'unpaid',customer_email:'local@example.invalid',customer_name:'Local',
      customer_email_consent:true,email_notifications_enabled:true,...context}
    : dbGet(sql,a);
  f.ros=wire(f.db,f).ros;
  const response=await invoke(f.ros,'/:id/status',{status});
  assert.equal(response.statusCode,200,JSON.stringify(response.body));
  // All adapters are in-memory promises; let the real queued email callback finish.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.filter(c=>c[0]==='createCheckout').length,createsLink?1:0);
  assert.equal(f.state.attempts.length,createsLink?1:0);
  if(createsLink) {
    assert.equal(f.state.attempts[0].status,'open');assert.equal(held(f),10000);
    assert.equal((await cash(f)).statusCode,200);assert.equal(held(f),0);
    assert.equal(f.state.attempts[0].status,'released');assert.equal(f.state.audit[0].action,'mark_paid');
  }
});
test('status route rejects the unsupported ready alias before writing or creating Checkout',async()=>{
  const f=memoryFixture(),response=await invoke(f.ros,'/:id/status',{status:'ready'});
  assert.equal(response.statusCode,400);assert.deepEqual(response.body,{error:'Invalid status'});
  assert.equal(f.queries.length,0);assert.equal(f.calls.length,0);
});

for(const kind of ['intent','checkout']) test(`${kind}: missing Stripe configuration creates no reservation`,async()=>{
  const f=memoryFixture();f.control.configured=false;
  const result=kind==='intent'?await reserveIntent(f):await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  assert.equal(kind==='intent'?result.statusCode:result.ok,kind==='intent'?503:false);
  assert.equal(f.state.attempts.length,0);assert.equal(f.calls.length,0);
});
for(const type of ['payment_intent.payment_failed','payment_intent.canceled','checkout.session.expired']) test(`${type}: release only terminal objects, retain history, fresh retry identity`,async()=>{
  const f=memoryFixture(), checkout=type.startsWith('checkout');
  if(checkout) await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});else await reserveIntent(f);
  const a=f.state.attempts[0],o=f.objects.get(checkout?a.stripe_checkout_session_id:a.stripe_payment_intent_id);
  if(type.endsWith('.expired'))o.status='expired';if(type.endsWith('.canceled'))o.status='canceled';
  await webhook(f,type,o);await webhook(f,type,o);
  assert.equal(held(f),0);assert.equal(a.status,'released');assert.equal(f.state.audit.length,1);
  assert.ok(['canceled','expired'].includes(o.status));
  const retry=await reserveIntent(f);assert.equal(retry.statusCode,200);assert.equal(held(f),10000);
  assert.equal(f.state.attempts.length,2);assert.notEqual(f.state.attempts[1].idempotency_key,a.idempotency_key);
  await webhook(f,type,o);assert.equal(a.status,'released');assert.equal(held(f),10000);
});
for(const type of ['payment_intent.payment_failed','checkout.session.async_payment_failed']) {
  for(const lookup of ['metadata','provider']) test(`Checkout ${type}, ${lookup} lookup: decline holds capacity and same-session retry settles once`,async()=>{
    const f=memoryFixture();await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
    const a=f.state.attempts[0],session=f.objects.get(a.stripe_checkout_session_id);
    const intent={id:'pi_checkout_retry',amount:10000,currency:'usd',status:'requires_payment_method',metadata:{...session.metadata}};
    session.payment_intent=intent.id;f.objects.set(intent.id,intent);
    if(lookup==='provider') {
      // A prior unpaid completion binds the intent; subsequent legacy events may
      // identify it by provider ID without the attempt metadata.
      await webhook(f,'checkout.session.completed',session);
      delete intent.metadata.paymentAttemptId;delete session.metadata.paymentAttemptId;
    }
    const failure=structuredClone(type.startsWith('checkout')?session:intent);
    const beforeCalls=f.calls.length;
    for(let i=0;i<2;i++)await webhook(f,type,failure);
    assert.equal(f.calls.length,beforeCalls,'failure must not call provider reconciliation');
    assert.equal(session.status,'open');assert.equal(intent.status,'requires_payment_method');
    assert.equal(a.status,'open');assert.equal(a.stripe_payment_intent_id,intent.id);
    assert.equal(a.stripe_checkout_session_id,session.id);assert.equal(held(f),10000);
    const balance=await f.reservations.withLockedRo('ro','shop',(client,ro)=>f.reservations.getPaymentBalance(client,ro));
    assert.equal(balance.occupiedCents,10000);assert.equal(balance.availableCents,0);
    assert.equal((await reserveIntent(f)).statusCode,409);assert.equal(f.state.attempts.length,1);
    assert.equal(f.state.audit.length,0);assert.equal(f.state.ledger.length,0);
    intent.status='succeeded';intent.amount_received=10000;session.status='complete';session.payment_status='paid';
    for(const event of ['checkout.session.completed','payment_intent.succeeded','checkout.session.async_payment_succeeded']) {
      await webhook(f,event,event.startsWith('checkout')?session:intent);
    }
    await webhook(f,type,failure);
    assert.equal(f.calls.length,beforeCalls);assert.equal(held(f),0);assert.equal(a.status,'settled');
    assert.equal(f.state.attempts.length,1);assert.equal(f.state.ledger.length,1);
    assert.equal(f.state.ledger[0].status,'succeeded');assert.equal(f.state.ro.amount_paid_cents,10000);
  });
}
test('untracked Checkout async failure stays held and open for subsequent success',async()=>{
  const f=memoryFixture(),s={id:'cs_legacy_retry',amount_total:10000,currency:'usd',status:'open',payment_status:'unpaid',
    payment_intent:null,metadata:{roId:'ro',shopId:'shop'}};
  await webhook(f,'checkout.session.async_payment_failed',s);
  assert.equal(f.calls.length,0);assert.equal(held(f),10000);assert.equal(f.state.attempts[0].kind,'checkout');
  s.payment_intent='pi_legacy_retry';s.status='complete';s.payment_status='paid';
  await webhook(f,'checkout.session.completed',s);await webhook(f,'checkout.session.completed',s);
  assert.equal(held(f),0);assert.equal(f.state.ledger.length,1);assert.equal(f.state.ro.amount_paid_cents,10000);
});
for(const kind of ['intent','checkout']) test(`${kind}: 24h lazy expiry confirms cancellation under shared lock`,async()=>{
  const f=memoryFixture();if(kind==='intent')await reserveIntent(f);else await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  assert.equal((await reserveIntent(f)).statusCode,409);assert.equal(f.calls.some(c=>['cancel','expire'].includes(c[0])),false);
  f.state.attempts[0].created_at=new Date(Date.now()-86400001);
  assert.equal((await reserveIntent(f)).statusCode,200);assert.equal(f.state.attempts[0].status,'released');assert.equal(held(f),10000);
  assert.equal(f.state.audit[0].action,'expiry');
});
test('old unidentified creation stays protected; late provider binding can reconcile',async()=>{
  const f=memoryFixture(),a=await f.reservations.reservePayment({roId:'ro',shopId:'shop',kind:'intent'});
  f.state.attempts[0].created_at=new Date(0);
  assert.equal((await reserveIntent(f)).statusCode,409);assert.equal(held(f),10000);assert.equal(f.state.attempts[0].status,'unknown');
  const o=await f.stripe.createPaymentIntent(10000,'usd',f.reservations.metadataFor(a),a.idempotencyKey);
  await f.reservations.recordProviderResult(a,o);
  assert.equal((await cash(f)).statusCode,200);assert.equal(held(f),0);
});
for(const initial of ['retryable','unknown']) test(`old ${initial} card: cancel before reallocating, no old secret reuse`,async()=>{
  const f=memoryFixture();await reserveIntent(f);const a=f.state.attempts[0];a.status=initial;
  const id=a.stripe_payment_intent_id;assert.equal((await reserveIntent(f)).statusCode,200);
  assert.equal(f.objects.get(id).status,'canceled');assert.equal(a.status,'released');assert.equal(f.state.attempts.length,2);
  assert.ok(f.calls.findIndex(c=>c[0]==='cancel')<f.calls.findLastIndex(c=>c[0]==='createIntent'));
});
for(const kind of ['intent','checkout']) test(`${kind}: cash cancels/expires and audits without deleting attempts`,async()=>{
  const f=memoryFixture();if(kind==='intent')await reserveIntent(f);else await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  assert.equal((await cash(f)).statusCode,200);assert.equal(held(f),0);assert.equal(f.state.ro.amount_paid_cents,10000);
  assert.equal(f.state.attempts.length,1);assert.equal(f.state.audit[0].actor_id,'actor');assert.equal(f.state.audit[0].prior_state,'open');
  assert.equal(f.state.audit[0].outcome,'released');assert.equal(f.state.audit[0].action,'mark_paid');
});
for(const uncertain of ['error','pending']) test(`cash cancel ${uncertain}: durable uncertainty and safe retry`,async()=>{
  const f=memoryFixture();await reserveIntent(f);f.control[uncertain==='error'?'failCancel':'pendingCancel']=true;
  assert.equal((await cash(f)).statusCode,409);assert.equal(f.state.ro.amount_paid_cents,0);assert.equal(held(f),10000);
  assert.equal(f.queries.at(-1),'COMMIT');assert.equal(f.state.attempts[0].status,'unknown');assert.equal(f.state.audit[0].outcome,'unknown');
  assert.equal((await reserveIntent(f)).statusCode,409);assert.equal(f.state.attempts.length,1);
  f.control.failCancel=false;f.control.pendingCancel=false;
  assert.equal((await cash(f)).statusCode,200);assert.equal(held(f),0);assert.equal(f.state.audit.at(-1).outcome,'released');
  assert.doesNotMatch(JSON.stringify(f.state.audit),/SECRET|PRIVATE|client_secret|email/);
});
test('failed webhook with uncertain cancellation retains capacity until canceled webhook',async()=>{
  const f=memoryFixture();await reserveIntent(f);const o=f.objects.get(f.state.attempts[0].stripe_payment_intent_id);
  f.control.failCancel=true;await webhook(f,'payment_intent.payment_failed',o);
  assert.equal(held(f),10000);assert.equal(f.state.attempts[0].status,'unknown');
  o.status='canceled';await webhook(f,'payment_intent.canceled',o);assert.equal(held(f),0);
});
test('completed unpaid checkout with processing intent remains held on failed cancellation',async()=>{
  const f=memoryFixture();await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  const s=f.objects.get(f.state.attempts[0].stripe_checkout_session_id);
  s.status='complete';s.payment_intent='pi_processing';
  f.objects.set(s.payment_intent,{id:s.payment_intent,amount:10000,currency:'usd',status:'processing'});f.control.pendingCancel=true;
  await webhook(f,'checkout.session.completed',s);assert.equal(held(f),10000);
  assert.equal((await cash(f)).statusCode,409);assert.equal(f.state.ro.amount_paid_cents,0);
});
test('expired Checkout also cancels its attached retryable intent',async()=>{
  const f=memoryFixture();await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  const s=f.objects.get(f.state.attempts[0].stripe_checkout_session_id);s.status='expired';s.payment_intent='pi_attached';
  f.objects.set(s.payment_intent,{id:s.payment_intent,amount:10000,currency:'usd',status:'requires_payment_method'});
  await webhook(f,'checkout.session.expired',s);assert.equal(held(f),0);assert.equal(f.objects.get(s.payment_intent).status,'canceled');
});
test('provider settled before webhook: reconcile ledger exactly once; cash cannot duplicate it',async()=>{
  const f=memoryFixture();await reserveIntent(f);const o=f.objects.get(f.state.attempts[0].stripe_payment_intent_id);
  o.status='succeeded';o.amount_received=10000;
  assert.equal((await cash(f)).statusCode,400);assert.equal(held(f),0);assert.equal(f.state.ro.amount_paid_cents,10000);assert.equal(f.state.ledger.length,1);
  await webhook(f,'payment_intent.succeeded',o);await webhook(f,'payment_intent.payment_failed',o);
  assert.equal(f.state.ledger.length,1);assert.equal(f.state.ro.amount_paid_cents,10000);assert.equal(f.state.attempts[0].status,'settled');
});
for(const role of ['owner','admin','assistant','superadmin','technician','staff','customer']) test(`staff reconcile exact role ${role}; body cannot override`,async()=>{
  const f=memoryFixture();await reserveIntent(f);const result=await invoke(f.payments,'/reconcile/:roId',{role:'owner',shop_id:'shop'},role);
  const allowed=['owner','admin'].includes(role);assert.equal(result.statusCode,allowed?200:403);
  assert.equal(f.state.audit.length,allowed?1:0);assert.equal(held(f),allowed?0:10000);
});
test('staff reconcile wrong tenant causes no provider calls or audit',async()=>{
  const f=memoryFixture();await reserveIntent(f);const before=f.calls.length;
  assert.equal((await invoke(f.payments,'/reconcile/:roId',{shop_id:'shop'},'owner','other')).statusCode,404);
  assert.equal(f.calls.length,before);assert.equal(f.state.audit.length,0);
});
test('staff cancellation failure commits audit then retry succeeds with prior state',async()=>{
  const f=memoryFixture();await reserveIntent(f);f.control.failCancel=true;
  assert.equal((await invoke(f.payments,'/reconcile/:roId')).statusCode,409);assert.equal(f.queries.at(-1),'COMMIT');
  f.control.failCancel=false;assert.equal((await invoke(f.payments,'/reconcile/:roId')).statusCode,200);
  assert.deepEqual(f.state.audit.map(a=>[a.prior_state,a.outcome]),[['open','unknown'],['unknown','released']]);
});

for (const kind of ['intent','checkout']) test(`${kind}: aged but cancellation-uncertain provider keeps capacity`,async()=>{
  const f=memoryFixture();if(kind==='intent')await reserveIntent(f);else await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  f.state.attempts[0].created_at=new Date(0);f.control.failCancel=true;
  assert.equal((await reserveIntent(f)).statusCode,409);assert.equal(held(f),10000);assert.equal(f.state.attempts.length,1);
  assert.equal(f.state.audit[0].action,'expiry');assert.equal(f.state.audit[0].outcome,'unknown');assert.equal(f.queries.at(-1),'COMMIT');
});
test('legacy failed ledger acquires a retained attempt and releases only after confirmed cancellation',async()=>{
  const f=memoryFixture();f.state.ledger.push({id:'old',shop_id:'shop',ro_id:'ro',stripe_payment_intent_id:'pi_old',amount_cents:10000,status:'failed'});
  f.objects.set('pi_old',{id:'pi_old',amount:10000,currency:'usd',status:'requires_payment_method'});
  assert.equal((await cash(f)).statusCode,200);assert.equal(f.state.ledger.length,1);assert.equal(f.state.ledger[0].status,'failed');
  assert.equal(f.state.attempts.length,1);assert.equal(f.state.attempts[0].status,'released');assert.equal(f.objects.get('pi_old').status,'canceled');
});
test('untracked failed webhook persists valid prior state and a terminal release',async()=>{
  const f=memoryFixture(),o={id:'pi_old',amount:10000,currency:'usd',status:'requires_payment_method',metadata:{roId:'ro',shopId:'shop'}};
  f.objects.set(o.id,o);await webhook(f,'payment_intent.payment_failed',o);
  assert.equal(f.state.attempts.length,1);assert.equal(held(f),0);assert.equal(f.state.audit[0].prior_state,'reserved');
});
test('mixed partial attempts reconcile settled card plus cash remainder without double counting',async()=>{
  const f=memoryFixture();const a=await invoke(f.payments,'/intent',{ro_id:'ro',amount:3000,allow_partial:true});
  const o=f.objects.get(a.body.paymentIntentId);o.status='succeeded';o.amount_received=3000;
  // Separate open Checkout holds the other 7000 until cash reconciliation.
  await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop'});
  assert.equal((await cash(f)).statusCode,200);assert.equal(held(f),0);assert.equal(f.state.ro.amount_paid_cents,10000);
  assert.equal(f.state.ledger.length,1);assert.equal(f.state.ledger[0].amount_cents,3000);
  await webhook(f,'payment_intent.succeeded',o);assert.equal(f.state.ro.amount_paid_cents,10000);
});
test('provider identity or amount mismatch never releases or leaks details',async()=>{
  for(const bad of [{id:'pi_wrong'},{amount:9999},{currency:'eur'}]) {
    const f=memoryFixture();await reserveIntent(f);Object.assign(f.objects.get(f.state.attempts[0].stripe_payment_intent_id),bad);
    assert.equal((await cash(f)).statusCode,409);assert.equal(held(f),10000);assert.equal(f.state.audit[0].outcome,'unknown');
    assert.equal(f.calls.some(c=>c[0]==='cancel'),false);
  }
});
test('creation response after confirmed release cannot hand out an old client secret',async()=>{
  const f=memoryFixture(),a=await f.reservations.reservePayment({roId:'ro',shopId:'shop',kind:'intent'});
  const o=await f.stripe.createPaymentIntent(10000,'usd',f.reservations.metadataFor(a),a.idempotencyKey);
  f.objects.get(o.id).status='canceled';await webhook(f,'payment_intent.canceled',f.objects.get(o.id));
  assert.equal(held(f),0);await assert.rejects(f.reservations.recordProviderResult(a,o),e=>e.status===409);
});
test('staff cannot claim unidentified historical pointers or pending state reconciled',async()=>{
  for(const state of [{stripe_payment_intent_id:'pi_missing'},{payment_status:'pending'}]) {
    const f=memoryFixture();Object.assign(f.state.ro,state);
    assert.equal((await invoke(f.payments,'/reconcile/:roId')).statusCode,409);
    assert.equal((await cash(f)).statusCode,409);
  }
});

test('status refresh is tenant-scoped, read-only, uncached and reports authoritative collection capacity', async () => {
  const f=memoryFixture();
  let r=await invoke(f.payments,'/ro/:roId');
  assert.equal(r.statusCode,200);assert.equal(r.headers['Cache-Control'],'no-store');
  assert.deepEqual(r.body.collectionBalance,{remainingCents:10000,canCollect:true});
  await reserveIntent(f);
  const calls=f.calls.length;
  r=await invoke(f.payments,'/ro/:roId');
  assert.deepEqual(r.body.collectionBalance,{remainingCents:10000,canCollect:false});
  assert.equal(f.calls.length,calls);assert.equal(f.state.audit.length,0);
  assert.equal((await invoke(f.payments,'/ro/:roId',{},'owner','other')).statusCode,404);
  assert.equal((await invoke(f.payments,'/reconcile/:roId')).statusCode,200);
  r=await invoke(f.payments,'/ro/:roId');
  assert.deepEqual(r.body.collectionBalance,{remainingCents:10000,canCollect:true});
  assert.equal((await cash(f)).statusCode,200);
  r=await invoke(f.payments,'/ro/:roId');
  assert.equal(r.body.paymentStatus,'paid');assert.deepEqual(r.body.collectionBalance,{remainingCents:0,canCollect:false});
});
test('status refresh refuses inconsistent paid status and sanitizes unexpected storage errors', async () => {
  const f=memoryFixture();f.state.ro.payment_status='paid';
  assert.equal((await invoke(f.payments,'/ro/:roId')).statusCode,409);
  f.db.pool.connect=async()=>{throw Error('SECRET provider pi_private');};
  const r=await invoke(f.payments,'/ro/:roId');
  assert.equal(r.statusCode,500);assert.deepEqual(r.body,{error:'Could not load payments'});
});

for (const [status, paid, remaining, canCollect] of [
  ['partial', 2500, 7500, true], ['paid', 10000, 0, false], ['succeeded', 10000, 0, false],
  ['unknown', 2500, 7500, false],
]) test(`status refresh ${status} preserves money and only advertises verified collection`, async () => {
  const f=memoryFixture();
  Object.assign(f.state.ro,{payment_status:status,amount_paid_cents:paid});
  const before=JSON.stringify(f.state);
  const r=await invoke(f.payments,'/ro/:roId');
  assert.equal(r.statusCode,200);assert.equal(r.body.paymentStatus,status);
  assert.deepEqual(r.body.collectionBalance,{remainingCents:remaining,canCollect});
  assert.equal(JSON.stringify(f.state),before);assert.equal(f.calls.length,0);
  assert.ok(f.queries.includes('BEGIN ISOLATION LEVEL READ COMMITTED'));
  assert.match(f.queries.find(sql=>sql.includes('FOR UPDATE')), /id = \$1 AND shop_id = \$2 FOR UPDATE/);
  assert.equal(f.queries.at(-1),'COMMIT');
});

test('status refresh keeps unknown attempts held and unidentified pending state fails closed', async () => {
  const f=memoryFixture();await reserveIntent(f);
  f.state.attempts[0].status='unknown';
  let r=await invoke(f.payments,'/ro/:roId');
  assert.equal(r.statusCode,200);
  assert.deepEqual(r.body.collectionBalance,{remainingCents:10000,canCollect:false});
  assert.equal(held(f),10000);
  const unidentified=memoryFixture();unidentified.state.ro.payment_status='pending';
  r=await invoke(unidentified.payments,'/ro/:roId');
  assert.equal(r.statusCode,409);assert.deepEqual(r.body,{error:'Could not load payments'});
  assert.equal(unidentified.calls.length,0);
});

const TEST_DATABASE='postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
test('late success commits one investigation and in-app alerts before deliberate refusal; repeats preserve every financial fact',async()=>{
  const f=memoryFixture();await reserveIntent(f);
  assert.equal((await invoke(f.payments,'/reconcile/:roId')).statusCode,200);
  const a=f.state.attempts[0],o={...f.objects.get(a.stripe_payment_intent_id),status:'succeeded',amount_received:10000};
  const before=structuredClone({ro:f.state.ro,attempts:f.state.attempts,ledger:f.state.ledger,audit:f.state.audit});
  const calls=f.calls.length;
  for(let i=0;i<3;i++) {
    await assert.rejects(webhook(f,'payment_intent.succeeded',o),e=>e instanceof f.reservations.PaymentError && e.status===409);
    assert.equal(f.queries.at(-1),'COMMIT');
  }
  assert.equal(f.state.investigations.length,1);assert.equal(f.state.notifications.length,2);
  assert.equal(f.state.investigations[0].attempt_id,a.id);
  assert.deepEqual({ro:f.state.ro,attempts:f.state.attempts,ledger:f.state.ledger,audit:f.state.audit},before);
  assert.equal(f.calls.length,calls);assert.equal(held(f),0);
  assert.ok(f.queries.findIndex(q=>q.includes('INSERT INTO ro_payment_investigations'))<f.queries.findIndex(q=>q.includes('INSERT INTO notifications')));
});
for(const bad of [{id:'pi_wrong'},{amount:9999},{amount_received:9999},{currency:'eur'}]) test(`released mismatch ${JSON.stringify(bad)} refuses before investigation`,async()=>{
  const f=memoryFixture();await reserveIntent(f);await invoke(f.payments,'/reconcile/:roId');
  const o={...f.objects.get(f.state.attempts[0].stripe_payment_intent_id),status:'succeeded',amount_received:10000,...bad};
  const queryCount=f.queries.length;
  await assert.rejects(webhook(f,'payment_intent.succeeded',o),e=>e.status===409);
  const queries=f.queries.slice(queryCount);
  if(queries.length)assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(f.state.investigations.length,0);assert.equal(f.state.notifications.length,0);
});
test('notification SQL failure is thrown and rolls back instead of committing the expected refusal',async()=>{
  const f=memoryFixture();await reserveIntent(f);await invoke(f.payments,'/reconcile/:roId');
  const connect=f.db.pool.connect;
  f.db.pool.connect=async()=>{const client=await connect();return {...client,query:async(sql,args)=>{
    if(sql.includes('INSERT INTO notifications'))throw Error('synthetic notification failure');
    return client.query(sql,args);
  }};};
  const o={...f.objects.get(f.state.attempts[0].stripe_payment_intent_id),status:'succeeded',amount_received:10000};
  await assert.rejects(webhook(f,'payment_intent.succeeded',o),/synthetic notification failure/);
  assert.equal(f.queries.at(-1),'ROLLBACK'); // Real rollback atomicity is covered by the PG suite.
});
test('real PostgreSQL mounted ready -> auto link -> cash, audit/tenant/concurrency witnesses', {timeout:60000}, async t=>{
  assert.equal(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL,TEST_DATABASE,'Dedicated loopback test DB only');
  const {Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken');
  const config={host:'127.0.0.1',port:55459,user:'revv_panel',database:'revv_panel_test',password:async()=>'',ssl:false,connectionTimeoutMillis:2000,statement_timeout:7000};
  const admin=new Pool(config),previousSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='synthetic-remy-phase-a-jwt-secret';
  try {
    for(const type of ['TEXT','UUID']) await t.test(type,async t=>{
      const schema=`remy_a_${randomUUID().replaceAll('-','')}`;let raw,server,created=false;
      try {
        await admin.query(`CREATE SCHEMA ${schema}`);created=true;
        raw=new Pool({...config,options:`-c search_path=${schema}`,max:10});
        await raw.query(`CREATE TABLE shops(id ${type} PRIMARY KEY,name TEXT DEFAULT 'Synthetic',tax_rate NUMERIC DEFAULT 0,email_notifications_enabled BOOLEAN DEFAULT TRUE);
          CREATE TABLE customers(id ${type} PRIMARY KEY,shop_id ${type},name TEXT,email TEXT,email_consent BOOLEAN DEFAULT TRUE,preferred_contact_method TEXT);
          CREATE TABLE vehicles(id ${type} PRIMARY KEY,year INTEGER,make TEXT,model TEXT);
          CREATE TABLE users(id ${type} PRIMARY KEY,shop_id ${type},role TEXT,revoke_all_before TIMESTAMPTZ);
          CREATE TABLE notifications(id TEXT PRIMARY KEY,shop_id ${type},user_id ${type},type TEXT,title TEXT,body TEXT,ro_id ${type},read BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW());
          CREATE TABLE revoked_tokens(id TEXT,token_jti TEXT);
          CREATE TABLE repair_orders(id ${type} PRIMARY KEY,shop_id ${type},customer_id ${type},vehicle_id ${type},ro_number TEXT DEFAULT 'SYNTHETIC',
            status TEXT DEFAULT 'repair',payment_status TEXT DEFAULT 'unpaid',payment_received INTEGER DEFAULT 0,
            stripe_payment_intent_id TEXT,payment_received_at TEXT,payment_method TEXT,paid_at TEXT,paid_amount INTEGER,invoice_emailed_at TEXT,actual_delivery TEXT,updated_at TIMESTAMPTZ);
          CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY,shop_id ${type},ro_id ${type},type TEXT,total NUMERIC,taxable BOOLEAN DEFAULT FALSE);
          CREATE TABLE job_status_log(id TEXT PRIMARY KEY,ro_id ${type},from_status TEXT,to_status TEXT,changed_by TEXT,note TEXT);
          CREATE TABLE portal_tokens(id TEXT PRIMARY KEY,ro_id ${type},shop_id ${type},token TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`);
        const migration=require('../src/db/paymentReservations');await migration.up(raw);await migration.up(raw);
        const shop=randomUUID(),other=randomUUID(),actor=randomUUID(),customer=randomUUID(),foreign=randomUUID();
        await raw.query('INSERT INTO shops(id) VALUES ($1),($2)',[shop,other]);
        await raw.query("INSERT INTO users(id,shop_id,role) VALUES ($1,$2,'owner')",[actor,shop]);
        await raw.query("INSERT INTO customers(id,shop_id,name,email) VALUES ($1,$2,'Local','local@example.invalid'),($3,$4,'Foreign','foreign@example.invalid')",[customer,shop,foreign,other]);
        // Presentation enrichment and unrelated QuickBooks settings alone are stubbed.
        // All RO lifecycle, customer joins, money, ledger, attempts and audit use real SQL.
        const db={pool:raw,dbGet:async(sql,a)=>/row_to_json|quickbooks_sync_enabled/.test(sql)?null:(await raw.query(sql,a)).rows[0],
          dbAll:async(sql,a)=>(await raw.query(sql,a)).rows,dbRun:(sql,a)=>raw.query(sql,a)};
        const p=providers(),auth=load('middleware/auth.js',{'../db':db}),f=wire(db,p,auth);
        const app=express();app.use(express.json());app.use('/api/ros',f.ros);app.use('/api/payments',f.payments);
        server=app.listen(0,'127.0.0.1');await once(server,'listening');
        const token=(role='owner',tenant=shop)=>jwt.sign({id:actor,shop_id:tenant,role},process.env.JWT_SECRET,{expiresIn:'1h'});
        const request=async(method,url,body={},role='owner',tenant=shop)=>{
          const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'content-type':'application/json',...(role === null ? {} : {authorization:`Bearer ${token(role,tenant)}`})},...(method === 'GET' ? {} : {body:JSON.stringify(body)})});
          return {status:r.status,body:await r.json()};
        };
        const makeRo=async(c=customer)=>{
          const id=randomUUID();await raw.query('INSERT INTO repair_orders(id,shop_id,customer_id) VALUES ($1,$2,$3)',[id,shop,c]);
          await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,total) VALUES ($1,$2,$3,'labor',100)",[randomUUID(),shop,id]);return id;
        };
        const snapshot=async id=>{
          const ro=(await raw.query('SELECT * FROM repair_orders WHERE id=$1 AND shop_id=$2',[id,shop])).rows[0];
          const attempts=(await raw.query('SELECT * FROM ro_payment_attempts WHERE ro_id=$1 AND shop_id=$2 ORDER BY created_at',[id,shop])).rows;
          const audit=(await raw.query('SELECT * FROM ro_payment_attempt_audit WHERE ro_id=$1 AND shop_id=$2 ORDER BY created_at',[id,shop])).rows;
          const ledger=(await raw.query('SELECT * FROM ro_payments WHERE ro_id=$1 AND shop_id=$2',[id,shop])).rows;
          const held=attempts.filter(a=>!['settled','released'].includes(a.status)).reduce((n,a)=>n+Number(a.amount_cents),0);
          assert.ok(Number(ro.amount_paid_cents)+held<=10000);return {ro,attempts,audit,ledger,held};
        };
        await t.test('real ready status route auto-creates Checkout then cash expires it; history and audit persist',async()=>{
          const ro=await makeRo();
          // The public API's ready-for-pickup status is delivery, not ready.
          const response=await request('PUT',`/api/ros/${ro}/status`,{status:'delivery'});
          assert.equal(response.status,200,JSON.stringify(response.body));
          assert.equal(response.body.status,'delivery');assert.match(response.body.actual_delivery,/^\d{4}-\d{2}-\d{2}$/);
          let before;const end=Date.now()+3000;
          do {before=await snapshot(ro);if(before.attempts[0]?.status==='open')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<end);
          assert.equal(before.attempts.length,1);assert.equal(before.attempts[0].status,'open');assert.equal(before.held,10000);
          const session=before.attempts[0].stripe_checkout_session_id;assert.ok(session);
          assert.equal((await request('POST',`/api/ros/${ro}/mark-paid`,{payment_method:'cash'})).status,200);
          const after=await snapshot(ro);assert.equal(after.held,0);assert.equal(after.ro.amount_paid_cents,10000);
          assert.equal(p.objects.get(session).status,'expired');assert.equal(after.attempts.length,1);assert.equal(after.attempts[0].status,'released');
          assert.equal(after.audit.length,1);assert.equal(after.audit[0].actor_id,actor);assert.equal(after.audit[0].prior_state,'open');
          assert.equal(after.audit[0].action,'mark_paid');assert.equal(after.audit[0].outcome,'released');assert.ok(after.audit[0].created_at);
          await f.reservations.settlePaymentEvent({type:'checkout.session.expired',data:{object:p.objects.get(session)}});
          assert.equal((await snapshot(ro)).audit.length,1);
          for(const sql of ['UPDATE ro_payment_attempt_audit SET outcome=outcome WHERE ro_id=$1','DELETE FROM ro_payment_attempt_audit WHERE ro_id=$1','DELETE FROM ro_payment_attempts WHERE ro_id=$1']) {
            await assert.rejects(raw.query(sql,[ro]),/RO_HISTORY_PROTECTED/);
          }
          assert.equal((await request('DELETE',`/api/ros/${ro}`)).status,409);
        });
        await t.test('authenticated exact roles, forged body role/tenant, and foreign tenant are refused',async()=>{
          const ro=await makeRo();assert.equal((await request('POST','/api/payments/intent',{ro_id:ro})).status,200);
          assert.equal((await request('POST',`/api/payments/reconcile/${ro}`,{role:'owner'},null)).status,401);
          const calls=p.calls.length;
          for(const role of ['assistant','superadmin','technician','staff','customer']) assert.equal((await request('POST',`/api/payments/reconcile/${ro}`,{role:'owner',shop_id:shop},role)).status,403);
          assert.equal((await request('POST',`/api/payments/reconcile/${ro}`,{shop_id:shop},'owner',other)).status,404);
          assert.equal((await snapshot(ro)).audit.length,0);
          assert.equal(p.calls.length,calls);
          assert.equal((await request('POST',`/api/payments/reconcile/${ro}`,{},'admin')).status,200);
          assert.equal((await snapshot(ro)).held,0);
        });
        for (const mode of ['failCancel', 'pendingCancel']) await t.test(`reconcile ${mode} keeps occupied funds; explicit verified release permits new identity`, async () => {
          const ro=await makeRo();await request('POST','/api/payments/intent',{ro_id:ro});
          p.control[mode]=true;
          try {
            const r=await request('POST',`/api/payments/reconcile/${ro}`);
            assert.equal(r.status,409);assert.doesNotMatch(JSON.stringify(r.body),/SECRET|PRIVATE|pi_|cs_/);
            const state=await snapshot(ro);
            assert.equal(state.held,10000);assert.equal(state.ro.amount_paid_cents,0);assert.equal(state.ledger.length,0);
            assert.equal(state.audit.at(-1).outcome,'unknown');
            const refreshed=await request('GET',`/api/payments/ro/${ro}`);
            assert.equal(refreshed.status,200);assert.deepEqual(refreshed.body.collectionBalance,{remainingCents:10000,canCollect:false});
            assert.equal((await request('POST','/api/payments/intent',{ro_id:ro})).status,409);
          } finally {p.control[mode]=false;}
          assert.equal((await request('POST',`/api/payments/reconcile/${ro}`,{},'owner')).status,200);
          const refreshed=await request('GET',`/api/payments/ro/${ro}`);
          assert.equal(refreshed.status,200);assert.equal(refreshed.body.roId,ro);assert.equal(refreshed.body.paymentStatus,'unpaid');
          assert.deepEqual(refreshed.body.collectionBalance,{remainingCents:10000,canCollect:true});
          assert.equal((await request('GET',`/api/payments/ro/${ro}`,{},'owner',other)).status,404);
          assert.equal((await request('POST','/api/payments/intent',{ro_id:ro})).status,200);
          const state=await snapshot(ro);assert.equal(state.attempts.length,2);assert.equal(state.held,10000);
          assert.notEqual(state.attempts[0].idempotency_key,state.attempts[1].idempotency_key);
        });
        await t.test('Checkout decline keeps persisted capacity; retry on same session settles once',async()=>{
          const ro=await makeRo();await f.billing.createPaymentCheckoutLinkForRo({roId:ro,shopId:shop});
          const before=await snapshot(ro),attempt=before.attempts[0],session=p.objects.get(attempt.stripe_checkout_session_id);
          const intent={id:`pi_${randomUUID()}`,amount:10000,currency:'usd',status:'requires_payment_method',metadata:{...session.metadata}};
          session.payment_intent=intent.id;p.objects.set(intent.id,intent);
          const calls=p.calls.length,decline=structuredClone(intent);
          for(const type of ['payment_intent.payment_failed','checkout.session.async_payment_failed']) {
            for(let i=0;i<2;i++)await f.reservations.settlePaymentEvent({type,data:{object:type.startsWith('checkout')?session:decline}});
          }
          const failed=await snapshot(ro);
          assert.equal(failed.held,before.held);assert.equal(failed.held,10000);assert.equal(failed.attempts.length,1);
          assert.equal(failed.attempts[0].status,'open');assert.equal(failed.attempts[0].stripe_payment_intent_id,intent.id);
          assert.equal(failed.attempts[0].stripe_checkout_session_id,session.id);
          assert.equal(failed.audit.length,0);assert.equal(p.calls.length,calls);assert.equal(session.status,'open');
          assert.equal((await request('POST','/api/payments/intent',{ro_id:ro})).status,409);
          intent.status='succeeded';intent.amount_received=10000;session.status='complete';session.payment_status='paid';
          for(const type of ['checkout.session.completed','payment_intent.succeeded','checkout.session.async_payment_succeeded']) {
            await f.reservations.settlePaymentEvent({type,data:{object:type.startsWith('checkout')?session:intent}});
          }
          await f.reservations.settlePaymentEvent({type:'payment_intent.payment_failed',data:{object:decline}});
          const settled=await snapshot(ro);
          assert.equal(settled.attempts.length,1);assert.equal(settled.attempts[0].id,attempt.id);
          assert.equal(settled.attempts[0].status,'settled');assert.equal(settled.held,0);
          assert.equal(settled.ledger.length,1);assert.equal(settled.ro.amount_paid_cents,10000);assert.equal(p.calls.length,calls);
        });
        await t.test('cash cancellation failure persists uncertainty/audit across connections; retry succeeds',async()=>{
          const ro=await makeRo();await request('POST','/api/payments/intent',{ro_id:ro});p.control.failCancel=true;
          try {
            assert.equal((await request('POST',`/api/ros/${ro}/mark-paid`)).status,409);
            const s=await snapshot(ro);assert.equal(s.ro.amount_paid_cents,0);assert.equal(s.held,10000);assert.equal(s.attempts[0].status,'unknown');
            assert.equal(s.audit[0].outcome,'unknown');assert.equal(s.audit[0].actor_id,actor);assert.doesNotMatch(JSON.stringify(s.audit),/SECRET|PRIVATE/);
          } finally {p.control.failCancel=false;}
          assert.equal((await request('POST',`/api/ros/${ro}/mark-paid`)).status,200);
          const s=await snapshot(ro);assert.equal(s.held,0);assert.equal(s.audit.length,2);assert.equal(s.audit[1].prior_state,'unknown');
        });
        await t.test('parallel reservations and concurrent manual settlement obey one capacity limit',async()=>{
          const ro=await makeRo();const results=await Promise.all([request('POST','/api/payments/intent',{ro_id:ro}),request('POST','/api/payments/intent',{ro_id:ro})]);
          assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await snapshot(ro)).held,10000);
          const [manual,retry]=await Promise.all([request('POST',`/api/ros/${ro}/mark-paid`),request('POST','/api/payments/intent',{ro_id:ro})]);
          assert.equal(manual.status,200);assert.ok([400,409].includes(retry.status));assert.equal((await snapshot(ro)).held,0);
        });
        await t.test('provider settlement before delayed webhook is reconciled once',async()=>{
          const ro=await makeRo();const r=await request('POST','/api/payments/intent',{ro_id:ro});const o=p.objects.get(r.body.paymentIntentId);
          o.status='succeeded';o.amount_received=10000;
          assert.equal((await request('POST',`/api/payments/reconcile/${ro}`)).status,200);
          await f.reservations.settlePaymentEvent({type:'payment_intent.succeeded',data:{object:o}});
          await f.reservations.settlePaymentEvent({type:'payment_intent.payment_failed',data:{object:o}});
          const s=await snapshot(ro);assert.equal(s.held,0);assert.equal(s.ledger.length,1);assert.equal(s.ro.amount_paid_cents,10000);
          const refreshed=await request('GET',`/api/payments/ro/${ro}`);
          assert.equal(refreshed.status,200);assert.equal(refreshed.body.paymentStatus,'paid');
          assert.deepEqual(refreshed.body.collectionBalance,{remainingCents:0,canCollect:false});
        });
        await t.test('cross-tenant customer cannot reach manual link, auto link or billing invoice',async()=>{
          const ro=await makeRo(foreign),before=p.calls.length;
          const response=await request('PUT',`/api/ros/${ro}/status`,{status:'delivery'});
          assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.status,'delivery');
          // Flush the queued real status-email read before inspecting the provider boundary.
          await new Promise(r=>setTimeout(r,30));assert.equal(p.calls.length,before);
          assert.equal((await request('POST',`/api/payments/link/${ro}`)).status,200);
          const call=p.calls.findLast(c=>c[0]==='createCheckout');assert.equal(call[1].customer_email,undefined);
          assert.equal(call[1].payment_intent_data.receipt_email,undefined);assert.equal(call[1].line_items[0].price_data.product_data.description,undefined);
          assert.deepEqual(await f.billing.sendClosedPaidInvoiceEmail({roId:ro,shopId:shop}),{sent:false,reason:'no_customer_email'});
        });
      } finally {
        if(server)await new Promise(r=>server.close(r));if(raw)await raw.end();if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    });
  } finally {
    await admin.end();if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;
  }
});
