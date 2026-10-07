'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const roles = require('../src/middleware/roles');

// Explicit source boundary: never load db/index, dotenv or a provider SDK.
function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} };
  const local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks,name)) return mocks[name];
    if (['express','uuid','crypto','node:crypto'].includes(name)) return local(name);
    throw new Error(`Unmocked dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}
async function invoke(router, route, body, role = 'owner', shop = 'shop', roId = 'ro') {
  const layer = router.stack.find(l => l.route?.path === route && (route !== '/:id' || l.route.methods.delete));
  const req = { body, params: { id: roId, roId }, headers: { 'stripe-signature': 'mock' }, user: { id:'user', shop_id:shop, role } };
  const res = { statusCode:200, status(n) { this.statusCode=n; return this; }, json(value) { this.body=value; return this; } };
  let index=0; const pending=[];
  const next = () => { const result=layer.route.stack[index++]?.handle(req,res,next); if (result?.then) pending.push(result); return result; };
  next(); await Promise.all(pending); return res;
}
function consumers(db, money, provider = {}) {
  const calls = [];
  const stripe = {
    createPaymentIntent: async (...args) => {
      calls.push(args);
      return provider.intent ? provider.intent(...args) : { id: `pi_mock_${require('node:crypto').randomUUID()}`, client_secret: 'mock', status: 'pending' };
    },
    getStripeClient: () => ({ checkout: { sessions: { create: async (...args) => {
      calls.push(args);
      return provider.checkout ? provider.checkout(...args) : { id: `cs_mock_${require('node:crypto').randomUUID()}`, url: 'https://mock.invalid', payment_intent: null };
    } } } }),
    constructWebhookEvent: body => body,
  };
  const notifications = load('services/notifications.js', { '../db': db });
  const reservations = load('services/paymentReservations.js', { '../db': db, './roMoney': money, './stripe': stripe, './notifications': notifications });
  const billing = load('services/customerBilling.js', { '../db': db, './stripe': stripe, './roMoney': money,
    './paymentReservations': reservations, './mailer': {}, './emailTemplates': {} });
  const router = load('routes/payments.js', {
    '../db': db, '../middleware/auth': (req,res,next) => next(), '../middleware/roles': roles,
    '../services/paymentReservations': reservations, '../services/stripe': stripe,
    '../services/notifications': {}, '../services/mailer': {}, '../services/emailTemplates': {}, '../services/customerBilling': billing,
  });
  return { router, calls, reservations, billing };
}
function fixture({ total=10000, paid=2500, ro: overrides={}, ledger=[], attempts=[], provider={}, failPersistence=false }={}) {
  const writes=[], queries=[];
  const ro = { id:'ro', shop_id:'shop', payment_status:'unpaid', ...overrides };
  let committed = false;
  const client = { release() {}, query: async (sql, params=[]) => {
    queries.push(sql);
    if (sql === 'COMMIT') committed = true;
    if (/INSERT|UPDATE/.test(sql) && !/SELECT/.test(sql)) writes.push({sql,params});
    if (/SELECT \* FROM repair_orders/.test(sql)) {
      assert.match(sql,/shop_id = \$2 FOR UPDATE/);
      return { rows: params[1]==='shop' ? [ro] : [] };
    }
    if (/SUM\(amount_cents\)/.test(sql)) {
      assert.match(sql,/shop_id = \$2/); assert.match(sql,/IN \('succeeded', 'paid'\)/);
      return { rows:[{paid_cents:paid}] };
    }
    if (/SELECT \* FROM ro_payment_attempts/.test(sql)) return {rows: /WHERE id =/.test(sql) ? attempts.filter(a=>a.id===params[0]) : attempts};
    if (/SELECT \* FROM ro_payments/.test(sql)) return {rows:ledger};
    if (/INSERT INTO ro_payment_attempts/.test(sql)) attempts.push({id:params[0],shop_id:params[1],ro_id:params[2],amount_cents:params[4],kind:params[5],status:'reserved'});
    if (/UPDATE ro_payment_attempts/.test(sql)) {
      if (failPersistence) throw Error('private persistence detail');
      const row=attempts.find(a=>a.id===params[3]);
      if (/SET status = \$1/.test(sql)) {
        const target=attempts.find(a=>a.id===params[1]); if(target) target.status=params[0];
      } else Object.assign(row,{stripe_payment_intent_id:params[0],stripe_checkout_session_id:params[1],status:params[2]});
    }
    return {rows:[]};
  } };
  const db = { pool: { connect: async()=>client, query: ()=>{throw Error('Money escaped transaction');} },
    dbGet: async()=>({token:'mock'}), dbAll:async()=>[], dbRun:async()=>{} };
  const actualMoney = load('services/roMoney.js', { '../db': db });
  const money = {...actualMoney,getRoMoneySummary:async (id,shop,usedClient)=> {
    assert.equal(usedClient,client); assert.equal(id,'ro'); assert.equal(shop,'shop');
    return {totalCents:total,lineCount:1};
  }};
  const wrap = fn => async (...args) => { assert.equal(committed,true,'reservation commits before provider call'); return fn(...args); };
  const f = consumers(db,money, { intent:wrap(provider.intent || (async()=>({id:'pi_mock',client_secret:'mock'}))),
    checkout:wrap(provider.checkout || (async()=>({id:'cs_mock',url:'https://mock.invalid'}))) });
  return {...f,writes,queries,attempts,db,money};
}
for (const alias of ['/intent','/create-intent']) {
  for (const [label,amount,partial,expected] of [
    ['default',undefined,false,7500],['full',7500,false,7500],['partial',1,true,1],
    ['exact partial',7500,true,7500],['overpay',7501,true,null],['nonpartial',1,false,null],
    ['zero',0,true,null],['negative',-1,true,null],['fraction',1.5,true,null],
    ['null',null,true,null],['boolean',true,true,null],['array',[1],true,null],
    ['empty','',true,null],['unsafe',Number.MAX_SAFE_INTEGER+1,true,null],['NaN',NaN,true,null],
  ]) test(`${alias}: ${label}`, async ()=> {
    const f=fixture(), result=await invoke(f.router,alias,{[alias==='/intent'?'ro_id':'roId']:'ro',amount,allow_partial:partial});
    assert.equal(result.statusCode,expected===null?400:200,JSON.stringify(result.body));
    if(expected===null) { assert.equal(f.calls.length,0); assert.equal(f.writes.filter(w=>/INSERT|UPDATE repair_orders/.test(w.sql)).length,0); }
    else {
      assert.equal(result.body.amountCents,expected); assert.equal(result.body.amountOwedCents,7500);
      assert.equal(f.calls[0][0],expected); assert.equal(f.calls[0][2].amountOwedCents,'7500');
      assert.equal(f.calls[0][2].paymentKind,expected===7500?'full':'partial');
      assert.equal(f.writes.find(w=>/INSERT INTO ro_payment_attempts/.test(w.sql)).params[4],expected);
      assert.equal(f.calls[0][3],`ro-payment-${f.calls[0][2].paymentAttemptId}`);
    }
  });
  for (const [label, config, expected] of [
    ['fully paid ledger',{paid:10000},400],['overpaid ledger',{paid:11000},400],
    ['manual paid',{paid:0,ro:{payment_status:'paid'}},400],
    ['legacy received',{paid:0,ro:{payment_received:1}},400],
    ['legacy paid amount',{paid:0,ro:{amount_paid_cents:10000}},400],
    ['legacy partial',{paid:0,ro:{amount_paid_cents:3000}},200],
    ['partial status',{ro:{payment_status:'partial'}},200],
    ['no successful payments',{paid:0},200],
  ]) test(`${alias}: ${label}`, async ()=> {
    const f=fixture(config), result=await invoke(f.router,alias,{ro_id:'ro'});
    assert.equal(result.statusCode,expected);
    if(expected===400) assert.equal(f.calls.length,0);
    else assert.equal(result.body.amountCents,config.ro?.amount_paid_cents ? 7000 : config.paid===0 ? 10000 : 7500);
  });
  test(`${alias}: cross shop makes zero Stripe calls`, async ()=> {
    const f=fixture(); assert.equal((await invoke(f.router,alias,{ro_id:'ro'},'owner','other')).statusCode,404); assert.equal(f.calls.length,0);
  });
}

function rosRouter(db, reservations = {}) {
  const mocks={ '../db':db, '../services/paymentReservations':reservations,
    '../middleware/auth':(req,res,next)=>next(), '../middleware/roles':roles,
    '../middleware/roLimitGuard':(req,res,next)=>next(),
    'express-rate-limit':()=> (req,res,next)=>next(),
    './insuranceOcr':{insuranceOcrLimiter:(req,res,next)=>next()},
    '../services/panelEstimatorApproval':{panelPublicHandler:()=> (req,res,next)=>next(), publicRequestError:()=> (req,res,next)=>next(), noStore:(req,res,next)=>next()},
  };
  for (const name of ['customerConsent','panelEstimatorEconomics','profit','roMoney','sms','mailer','emailTemplates','ownerActivity','notifications','deliveryFees','customerBilling','quickbooks','customerOptInConfirmation']) mocks[`../services/${name}`]={};
  mocks['../services/panelEstimatorEconomics']={selectedEconomics:async()=>new Map(),redactSelectedRO:r=>r};
  mocks['../services/profit']={calculateProfit:()=>({})};
  mocks['../services/customerBilling']={sendClosedPaidInvoiceEmail:async()=>{}};
  return load('routes/ros.js',mocks);
}
const deletionStates = {
  unpaid:{}, paid:{payment_status:'paid'}, succeeded:{payment_status:'succeeded'},
  partial:{payment_status:'partial'}, pending:{payment_status:'pending'}, received:{payment_received:1},
  receivedBoolean:{payment_received:true}, legacy:{amount_paid_cents:1}, paidAmount:{paid_amount:1},
  paidAt:{paid_at:'2026-01-01'}, receivedAt:{payment_received_at:'2026-01-01'}, pointer:{stripe_payment_intent_id:'pi_old'},
  approvedAt:{estimate_approved_at:'2026-01-01'}, approvedBy:{estimate_approved_by:'actor'},
  approvedStatus:{estimate_status:'approved'}, signedStatus:{status:'signed'}, insurerApprovedZero:{insurance_approved_amount:0},
  ledger:{}, zeroSuccess:{}, failedLedger:{}, reserved:{}, unknown:{}, settled:{}, approvedLink:{},
  panelApproved:{}, carrierApproval:{}, claimPending:{}, signedAgreement:{}, staleSignature:{}, pendingAgreement:{}, voidedAgreement:{}, draft:{},
};
function deletionFixture(fact) {
  const queries=[];
  const evidenceTable = ['ledger','zeroSuccess','failedLedger'].includes(fact)?'ro_payments':
    ['reserved','unknown','settled'].includes(fact)?'ro_payment_attempts':fact==='approvedLink'?'estimate_approval_links':
    fact==='panelApproved'?'ro_panel_estimator_approval_events':['carrierApproval','claimPending'].includes(fact)?'claim_links':
    ['signedAgreement','staleSignature','pendingAgreement','voidedAgreement'].includes(fact)?'agreement_requests':null;
  const query=async (sql,params=[])=> {
    queries.push({sql,params});
    if (/FOR UPDATE/.test(sql)) { assert.match(sql,/shop_id = \$2/); return {rows:params[1]==='shop'?[{id:'ro',shop_id:'shop',payment_status:'unpaid',...deletionStates[fact]}]:[]}; }
    if (/to_regclass/.test(sql)) return {rows:[{relation:params[0]==='ro_panel_estimator_drafts'?(fact==='draft'?'draft':null):params[0]}]};
    if (/SELECT 1 FROM/.test(sql)) {
      assert.match(sql,/shop_id = \$2/); assert.deepEqual(params,['ro','shop']);
      const found = sql.includes(`FROM ${evidenceTable}\n`) || (fact==='draft' && sql.includes('FROM ro_panel_estimator_drafts'));
      return {rows:found?[{}]:[],rowCount:found?1:0};
    }
    if (/DELETE/.test(sql)) { assert.match(sql,/shop_id(?:::text)? = \$2/); assert.doesNotMatch(sql,/DELETE FROM ro_payment/); }
    return {rows:[],rowCount:1};
  };
  return {router:rosRouter({pool:{connect:async()=>({query,release:()=>{}})}}),queries};
}
for (const role of ['tech','technician','employee','staff','owner','admin','assistant','superadmin','customer','phantom']) {
  for (const fact of Object.keys(deletionStates)) test(`DELETE ${role}/${fact}`,async()=> {
    const f=deletionFixture(fact), result=await invoke(f.router,'/:id',{},role);
    const admitted=roles.getRoleRank(role)>=roles.ROLE_RANK.technician;
    const expected=!admitted?403:fact==='unpaid'?200:409;
    assert.equal(result.statusCode,expected,JSON.stringify(result.body));
    const deletes=f.queries.filter(q=>/^DELETE/.test(q.sql));
    if (expected!==200) { assert.equal(deletes.length,0); if(admitted) assert.equal(f.queries.at(-1).sql,'ROLLBACK'); }
    else { assert.equal(deletes.length,12); assert.equal(f.queries[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED'); assert.equal(f.queries.at(-1).sql,'COMMIT'); }
  });
}
test('DELETE cross-shop rolls back without writes',async()=> {
  const f=deletionFixture('ledger'); assert.equal((await invoke(f.router,'/:id',{},'technician','other')).statusCode,404);
  assert.equal(f.queries.at(-1).sql,'ROLLBACK'); assert.equal(f.queries.filter(q=>/^DELETE/.test(q.sql)).length,0);
});
for (const [label,config,expected] of [
  ['partial ledger',{},200], ['unpaid',{paid:0},200], ['already paid',{ro:{payment_status:'paid'}},400],
  ['legacy floor',{paid:0,ro:{amount_paid_cents:2000}},200],
  ['reserved',{attempts:[{amount_cents:100,status:'reserved'}]},409],
  ['unknown zero reservation',{attempts:[{amount_cents:0,status:'unknown'}]},409],
  ['retryable',{attempts:[{amount_cents:100,status:'retryable'}]},409],
  ['failed legacy zero',{ledger:[{amount_cents:0,status:'failed'}]},409],
  ['dangling pointer',{ro:{stripe_payment_intent_id:'pi_missing'}},409],
  ['unexplained pending',{ro:{payment_status:'pending'}},409],
  ['invalid balance',{total:2000},400],
  ['settled',{attempts:[{amount_cents:2500,status:'settled',stripe_payment_intent_id:'pi_paid'}],
    ledger:[{amount_cents:2500,status:'succeeded',stripe_payment_intent_id:'pi_paid'}]},200],
]) test(`manual mark-paid: ${label}`,async()=> {
  const f=fixture(config), result=await invoke(rosRouter(f.db,f.reservations),'/:id/mark-paid',{});
  assert.equal(result.statusCode,expected,JSON.stringify(result.body)); assert.equal(f.calls.length,0);
  if(expected===200) {
    assert.equal(f.queries.at(-1),'COMMIT');
    assert.equal(f.writes.find(w=>/UPDATE repair_orders/.test(w.sql)).params[3],10000);
    assert.ok(f.writes.some(w=>/INSERT INTO job_status_log/.test(w.sql)));
  } else {
    assert.equal(f.queries.at(-1),'COMMIT');
    assert.equal(f.writes.some(w=>/UPDATE repair_orders|INSERT INTO job_status_log/.test(w.sql)),false);
  }
});

test('manual payment preserves tenant and role boundaries before any write',async()=> {
  for(const [role,shop,status] of [['owner','other',404],['tech','shop',403],['phantom','shop',403],['customer','shop',403]]){
    const f=fixture(),result=await invoke(rosRouter(f.db,f.reservations),'/:id/mark-paid',{},role,shop);
    assert.equal(result.statusCode,status);assert.equal(f.writes.length,0);
    assert.equal(f.queries.length>0,role==='owner');
  }
});

for (const [label, config, expected] of [
  ['partial paid',{},7500], ['unpaid',{paid:0},10000], ['legacy partial',{paid:0,ro:{amount_paid_cents:3000}},7000],
  ['fully paid',{paid:10000},null], ['overpaid',{paid:11000},null], ['manual paid',{ro:{payment_status:'paid'}},null],
  ['received',{ro:{payment_received:1}},null], ['legacy full',{paid:0,ro:{amount_paid_cents:10000}},null],
  ['unknown old intent',{ro:{stripe_payment_intent_id:'pi_untracked'}},null],
  ['unknown old pending',{ro:{payment_status:'pending'}},null],
]) test(`Checkout shared balance: ${label}`,async()=> {
  const f=fixture(config), r=await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop',trackingToken:'mock'});
  assert.equal(r.ok,expected!==null,JSON.stringify(r));
  assert.equal(f.calls.length,expected===null?0:1);
  if(expected!==null) {
    assert.equal(r.amountCents,expected);
    assert.equal(f.calls[0][0].line_items[0].price_data.unit_amount,expected);
    assert.equal(f.calls[0][0].metadata.paymentAttemptId,f.calls[0][0].payment_intent_data.metadata.paymentAttemptId);
    assert.equal(f.calls[0][1].idempotencyKey,`ro-payment-${f.calls[0][0].metadata.paymentAttemptId}`);
  }
});
test('Checkout tenant rejection precedes provider',async()=> {
  const f=fixture();
  assert.equal((await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'other'})).ok,false);
  assert.equal(f.calls.length,0);
});
for(const status of ['pending','processing','failed','requires_payment_method','canceled',null]) test(`legacy ${status} ledger occupies capacity conservatively`,async()=> {
  const f=fixture({ledger:[{amount_cents:7500,status,stripe_payment_intent_id:'pi_legacy'}]});
  const result=await invoke(f.router,'/intent',{ro_id:'ro'});
  assert.equal(result.statusCode,409); assert.equal(f.calls.length,0);
});
for(const kind of ['intent','checkout']) test(`${kind} provider timeout leaves durable hold and safe response`,async()=> {
  const f=fixture({provider:{[kind]:async()=>{throw Error('private provider response');}}});
  const first=kind==='intent' ? await invoke(f.router,'/intent',{ro_id:'ro'}) : await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop',trackingToken:'mock'});
  assert.doesNotMatch(JSON.stringify(first),/private provider response/);
  assert.equal(f.attempts.length,1); assert.equal(f.attempts[0].status,'reserved');
  const next=await invoke(f.router,'/intent',{ro_id:'ro'});
  assert.equal(next.statusCode,409); assert.equal(f.calls.length,1);
});
for(const kind of ['intent','checkout']) test(`${kind} provider success then persistence failure retains hold`,async()=> {
  const f=fixture({failPersistence:true});
  const first=kind==='intent' ? await invoke(f.router,'/intent',{ro_id:'ro'}) : await f.billing.createPaymentCheckoutLinkForRo({roId:'ro',shopId:'shop',trackingToken:'mock'});
  assert.doesNotMatch(JSON.stringify(first),/private persistence detail/);
  assert.equal(f.attempts[0].status,'reserved');assert.equal(f.queries.at(-1),'ROLLBACK');
  const next=await invoke(f.router,'/intent',{ro_id:'ro'});
  assert.equal(next.statusCode,409);assert.equal(f.calls.length,1);
});
test('partial reservations consume only available cents; settled amount not subtracted twice',async()=> {
  const f=fixture({attempts:[{id:'settled',amount_cents:2500,status:'settled',stripe_payment_intent_id:'pi_paid'},
    {id:'open',amount_cents:3000,status:'retryable'}],ledger:[{amount_cents:2500,status:'succeeded',stripe_payment_intent_id:'pi_paid'}]});
  const result=await invoke(f.router,'/intent',{ro_id:'ro'});
  assert.equal(result.statusCode,200); assert.equal(result.body.amountCents,4500);
});
test('missing RO webhook fails closed with generic response',async()=> {
  const f=fixture();
  const result=await invoke(f.router,'/webhook',{type:'payment_intent.succeeded',data:{object:{id:'pi_other',currency:'usd',amount_received:100,
    metadata:{roId:'ro',shopId:'other'}}}});
  assert.equal(result.statusCode,400); assert.equal(f.writes.length,0);
  assert.deepEqual(result.body,{error:'Payment webhook could not be processed'});
});

test('money helpers keep selected/fallback/tax/ledger reads on the lock client',async()=> {
  let selected=true;
  const queries=[];
  const client={query:async(sql)=> {
    queries.push(sql);
    if(/to_regclass/.test(sql)) return {rows:[{revisions:selected?'present':null,pointer:selected}]};
    if(/accounting_snapshot/.test(sql)) return {rows:[{active_revision_id:'selected',accounting_snapshot:{money:{totalCents:12345,lineCount:2}}}]};
    if(/FROM estimate_line_items/.test(sql)) return {rows:[{subtotal:100,taxable_subtotal:100,line_count:1}]};
    if(/FROM shops/.test(sql)) return {rows:[{tax_rate:0.1}]};
    if(/FROM ro_payments/.test(sql)) return {rows:[{paid_cents:2500}]};
    throw Error(sql);
  }};
  const money=load('services/roMoney.js',{'../db':{pool:{query:()=>{throw Error('escaped transaction');}},dbGet:()=>{throw Error('escaped transaction');}}});
  assert.equal((await money.getRoMoneySummary('ro','shop',client)).totalCents,12345);
  assert.equal(queries.some(sql=>/FROM estimate_line_items/.test(sql)),false);
  selected=false;
  assert.equal((await money.getRoMoneySummary('ro','shop',client)).totalCents,11000);
  assert.equal(await money.getPaidCents('ro','shop',client),2500);
});

const TEST_DATABASE = 'postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
function paymentTestDatabase(value) {
  assert.equal(value,TEST_DATABASE,'Only the dedicated loopback disposable database is allowed');
  return {host:'127.0.0.1',port:55459,user:'revv_panel',database:'revv_panel_test',password:async()=>'',
    ssl:false,connectionTimeoutMillis:3000,statement_timeout:10000};
}
test('payment integration refuses ambient/remote/non-dedicated database settings',()=> {
  for(const value of [undefined,'postgresql://remote/revv_panel_test',`${TEST_DATABASE}?host=remote`,
    TEST_DATABASE.replace('55459','5432'),TEST_DATABASE.replace('revv_panel_test','revv')]) assert.throws(()=>paymentTestDatabase(value));
});

test('real PostgreSQL payment reservations, parallel creation and settlement (mock Stripe only)',{timeout:60000},async t=> {
  const {Pool}=require('pg');
  const {randomUUID}=require('node:crypto');
  const config=paymentTestDatabase(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL);
  const admin=new Pool(config);
  const migration=require('../src/db/paymentReservations');
  try {
    for(const identityType of ['TEXT','UUID']) await t.test(`${identityType} fresh and legacy schema`,async t=> {
      const schema=`payment_phaseb_${randomUUID().replaceAll('-','')}`;
      let raw,created=false;
      try {
        await admin.query(`CREATE SCHEMA ${schema}`); created=true;
        raw=new Pool({...config,options:`-c search_path=${schema}`,max:10});
        await raw.query(`CREATE TABLE shops(id ${identityType} PRIMARY KEY,tax_rate NUMERIC DEFAULT 0);
          CREATE TABLE users(id ${identityType} PRIMARY KEY,shop_id ${identityType},role TEXT);
          CREATE TABLE notifications(id TEXT PRIMARY KEY,shop_id ${identityType},user_id ${identityType},type TEXT,title TEXT,body TEXT,ro_id ${identityType},read BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW());
          CREATE TABLE repair_orders(id ${identityType} PRIMARY KEY,shop_id ${identityType} NOT NULL,ro_number TEXT,
            payment_status TEXT DEFAULT 'unpaid',payment_received INTEGER DEFAULT 0,stripe_payment_intent_id TEXT,
            status TEXT DEFAULT 'estimate',estimate_approved_at TEXT,estimate_approved_by TEXT,estimate_status TEXT,insurance_approved_amount NUMERIC,
            payment_received_at TEXT,payment_method TEXT,paid_at ${identityType==='UUID'?'TIMESTAMPTZ':'TEXT'},paid_amount INTEGER,updated_at TIMESTAMPTZ DEFAULT NOW());
          CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY,ro_id ${identityType},shop_id ${identityType},type TEXT,
            total NUMERIC,taxable BOOLEAN DEFAULT FALSE);
          CREATE TABLE job_status_log(id TEXT PRIMARY KEY,ro_id ${identityType},from_status TEXT,to_status TEXT,changed_by TEXT,note TEXT);
          CREATE TABLE estimate_approval_links(id TEXT PRIMARY KEY,ro_id TEXT,shop_id TEXT,responded_at TEXT,decline_reason TEXT);
          CREATE TABLE claim_links(id TEXT PRIMARY KEY,ro_id TEXT,shop_id TEXT,approved_labor NUMERIC,approved_parts NUMERIC,submitted_at TEXT);
          CREATE TABLE agreement_requests(id TEXT PRIMARY KEY,ro_id TEXT,shop_id TEXT,status TEXT,customer_signature JSONB,shop_signature JSONB)`);
        if(identityType==='UUID') await raw.query(`CREATE TABLE ro_payments(id UUID PRIMARY KEY,shop_id UUID NOT NULL,
          ro_id UUID NOT NULL,stripe_payment_intent_id TEXT UNIQUE,amount_cents INTEGER NOT NULL,currency TEXT DEFAULT 'usd',
          status TEXT DEFAULT 'pending',payment_method TEXT,receipt_email TEXT,paid_at TEXT,failure_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`);
        // Repeated/concurrent setup must be deterministic for fresh/legacy IDs.
        await Promise.all([migration.up(raw),migration.up(raw)]);
        const shop=randomUUID(),other=randomUUID();
        await raw.query('INSERT INTO shops(id) VALUES ($1),($2)',[shop,other]);
        let hook=null;
        const adapter={connect:async()=> {
          const c=await raw.connect();
          return {release:()=>c.release(),query:async(sql,args)=> {
            if(hook) await hook(sql,args,'before');
            const result=await c.query(sql,args);
            if(hook) await hook(sql,args,'after');
            return result;
          }};
        },query:()=>{throw Error('money query escaped locked client');}};
        const db={pool:adapter,dbGet:async(sql,args)=>(await raw.query(sql,args)).rows[0],
          dbAll:async()=>[],dbRun:(sql,args)=>raw.query(sql,args)};
        const money=load('services/roMoney.js',{'../db':db});
        const makeRo=async()=> {
          const id=randomUUID();
          await raw.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)',[id,shop]);
          await raw.query("INSERT INTO estimate_line_items(id,ro_id,shop_id,type,total) VALUES ($1,$2,$3,'labor',100)",[randomUUID(),id,shop]);
          return id;
        };
        const barrier=()=> {let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
        const createIntent=(f,id,extra={})=>invoke(f.router,'/intent',{ro_id:id,...extra},'owner',shop);
        const checkout=(f,id)=>f.billing.createPaymentCheckoutLinkForRo({roId:id,shopId:shop,trackingToken:'mock'});
        const event=(id,meta,amount,type='payment_intent.succeeded')=>({type,data:{object:{id,metadata:meta,amount,amount_received:amount,currency:'usd'}}});
        const invariant=async(id)=> {
          const attempts=(await raw.query('SELECT * FROM ro_payment_attempts WHERE ro_id=$1 AND shop_id=$2',[id,shop])).rows;
          const ledger=(await raw.query('SELECT * FROM ro_payments WHERE ro_id=$1 AND shop_id=$2',[id,shop])).rows;
          const paid=ledger.filter(p=>['succeeded','paid'].includes(p.status)).reduce((n,p)=>n+Number(p.amount_cents),0);
          const open=attempts.filter(a=>!['settled','released'].includes(a.status)).reduce((n,a)=>n+Number(a.amount_cents),0)+
            ledger.filter(p=>!['succeeded','paid'].includes(p.status)&&!attempts.some(a=>a.stripe_payment_intent_id===p.stripe_payment_intent_id)).reduce((n,p)=>n+Number(p.amount_cents),0);
          assert.ok(open+paid<=10000,`open ${open} + successful ${paid} exceeds total`);
          return {attempts,ledger,paid,open};
        };
        const lifecycleDb={...db,dbGet:async(sql,args)=>
          /row_to_json|quickbooks_sync_enabled/.test(sql)?null:db.dbGet(sql,args)};
        for (const operation of ['reserve','settle','settleReserved','manual']) for (const deleteFirst of [true,false]) {
          await t.test(`DELETE vs ${operation}, delete first=${deleteFirst}`,async()=> {
            const ro=await makeRo(),f=consumers(db,money),router=rosRouter(lifecycleDb,f.reservations);
            const reservation=operation==='settleReserved'?await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent'}):null;
            const entered=barrier(),release=barrier(),waiting=barrier(); let held=false;
            hook=async(sql,args,phase)=> {
              if(!/SELECT \* FROM repair_orders.*FOR UPDATE/.test(sql)||!args.includes(ro))return;
              if(phase==='after'&&!held){held=true;entered.resolve();await release.promise;}
              else if(phase==='before'&&held)waiting.resolve();
            };
            const deletion=()=>invoke(router,'/:id',{},'owner',shop,ro);
            const work=()=>operation==='reserve'?f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent'}):
              ['settle','settleReserved'].includes(operation)?f.reservations.settlePaymentEvent(event(`pi_${ro}`,
                {roId:ro,shopId:shop,...(reservation?{paymentAttemptId:reservation.id}:{})},10000)):
              invoke(router,'/:id/mark-paid',{},'owner',shop,ro);
            const first=deleteFirst?deletion():work();
            // Fail promptly if a route exits before the lock rather than hanging the fixture.
            await Promise.race([entered.promise,first.then(r=>{throw Error(`No parent lock: ${JSON.stringify(r)}`);})]);
            const second=deleteFirst?work():deletion(),outcomes=Promise.allSettled([first,second]);
            try {await waiting.promise;} finally {hook=null;release.resolve();}
            const [a,b]=await outcomes;
            if(operation==='settleReserved') {
              assert.equal((deleteFirst?a:b).value.statusCode,409);
              assert.equal((deleteFirst?b:a).status,'fulfilled');
              const state=await invariant(ro);assert.equal(state.paid,10000);assert.equal(state.open,0);
              assert.equal(state.attempts.length,1);assert.equal(state.ledger.length,1);
              assert.equal((await raw.query('SELECT 1 FROM repair_orders WHERE id=$1',[ro])).rowCount,1);
            } else if(deleteFirst){
              assert.equal(a.value.statusCode,200);
              if(operation==='manual')assert.equal(b.value.statusCode,404);
              else {assert.equal(b.status,'rejected');assert.equal(b.reason.status,404);}
              assert.equal((await raw.query('SELECT 1 FROM repair_orders WHERE id=$1',[ro])).rowCount,0);
              const state=await invariant(ro);assert.equal(state.attempts.length,0);assert.equal(state.ledger.length,0);
            } else {
              assert.equal(a.status,'fulfilled');if(operation==='manual')assert.equal(a.value.statusCode,200);
              assert.equal(b.value.statusCode,409);
              assert.equal((await raw.query('SELECT 1 FROM repair_orders WHERE id=$1',[ro])).rowCount,1);
              const state=await invariant(ro);
              if(operation==='reserve')assert.equal(state.open,10000);
              if(operation==='settle')assert.equal(state.paid,10000);
            }
          });
        }
        for (const manualFirst of [true,false]) await t.test(`manual vs reserve, manual first=${manualFirst}`,async()=> {
          const ro=await makeRo(),f=consumers(db,money),router=rosRouter(lifecycleDb,f.reservations);
          const entered=barrier(),release=barrier(),waiting=barrier();let held=false;
          hook=async(sql,args,phase)=> {
            if(!/SELECT \* FROM repair_orders.*FOR UPDATE/.test(sql)||!args.includes(ro))return;
            if(phase==='after'&&!held){held=true;entered.resolve();await release.promise;}
            else if(phase==='before'&&held)waiting.resolve();
          };
          const manual=()=>invoke(router,'/:id/mark-paid',{},'owner',shop,ro);
          const reserve=()=>createIntent(f,ro);
          const first=manualFirst?manual():reserve();
          await Promise.race([entered.promise,first.then(r=>{throw Error(`No parent lock: ${JSON.stringify(r)}`);})]);
          const second=manualFirst?reserve():manual(),outcomes=Promise.all([first,second]);
          try {await waiting.promise;} finally {hook=null;release.resolve();}
          const [a,b]=await outcomes;assert.equal(a.statusCode,200);assert.equal(b.statusCode,manualFirst?400:409);
          const stored=(await raw.query('SELECT * FROM repair_orders WHERE id=$1',[ro])).rows[0];
          assert.equal(stored.amount_paid_cents,manualFirst?10000:0);
          assert.equal((await invariant(ro)).open,manualFirst?0:10000);
        });
        await t.test('manual log failure rolls back payment and existing event bytes',async()=> {
          const ro=await makeRo(),f=consumers(db,money),router=rosRouter(lifecycleDb,f.reservations);
          const before=(await raw.query('SELECT to_jsonb(r) AS value FROM repair_orders r WHERE id=$1',[ro])).rows[0];
          await raw.query(`CREATE FUNCTION reject_manual_log() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'TEST_MANUAL_LOG'; END $$;
            CREATE TRIGGER reject_manual_log BEFORE INSERT ON job_status_log FOR EACH ROW EXECUTE FUNCTION reject_manual_log()`);
          try {
            assert.equal((await invoke(router,'/:id/mark-paid',{},'owner',shop,ro)).statusCode,500);
            assert.deepEqual((await raw.query('SELECT to_jsonb(r) AS value FROM repair_orders r WHERE id=$1',[ro])).rows[0],before);
            assert.equal((await raw.query('SELECT 1 FROM job_status_log WHERE ro_id=$1',[ro])).rowCount,0);
          } finally {await raw.query('DROP TRIGGER reject_manual_log ON job_status_log');}
        });
        await t.test('agreement signatures and legacy approval evidence survive stale RO state',async()=> {
          const f=consumers(db,money),router=rosRouter(lifecycleDb,f.reservations);
          for(const field of ['customer_signature','shop_signature']) for(const status of ['pending','voided','signed']){
            const ro=await makeRo();
            await raw.query(`INSERT INTO agreement_requests(id,ro_id,shop_id,status,${field}) VALUES ($1,$2,$3,$4,$5)`,
              [randomUUID(),ro,shop,status,JSON.stringify({signed_at:'2026-01-01',name:'Synthetic'})]);
            const before=(await raw.query('SELECT to_jsonb(a) AS value FROM agreement_requests a WHERE ro_id=$1',[ro])).rows;
            assert.equal((await invoke(router,'/:id',{},'owner',shop,ro)).statusCode,409);
            assert.deepEqual((await raw.query('SELECT to_jsonb(a) AS value FROM agreement_requests a WHERE ro_id=$1',[ro])).rows,before);
          }
          for(const declined of [false,true]){
            const ro=await makeRo();
            await raw.query('INSERT INTO estimate_approval_links VALUES ($1,$2,$3,$4,$5)',[randomUUID(),ro,shop,'2026-01-01',declined?'Change scope':null]);
            assert.equal((await invoke(router,'/:id',{},'owner',shop,ro)).statusCode,declined?200:409);
          }
          for (const approved of [null,0,100]) {
            const ro=await makeRo();
            await raw.query('INSERT INTO claim_links(id,ro_id,shop_id,approved_labor) VALUES ($1,$2,$3,$4)',[randomUUID(),ro,shop,approved]);
            assert.equal((await invoke(router,'/:id',{},'owner',shop,ro)).statusCode,409);
            assert.equal((await raw.query('SELECT 1 FROM claim_links WHERE ro_id=$1',[ro])).rowCount,1);
          }
          // Foreign financial/signature rows never influence the owning tenant.
          const ro=await makeRo();
          const foreignInsert = () => raw.query("INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,0,'succeeded')",[randomUUID(),other,ro]);
          await assert.rejects(foreignInsert(), /RO_NOT_FOUND/);
          // Simulate a legacy row predating this migration in the disposable schema.
          // Keep the original cross-tenant retention assertions as well as rejection
          // of new corrupt writes. Never disable guards outside this owned fixture.
          await raw.query('ALTER TABLE ro_payments DISABLE TRIGGER revv_financial_guard');
          try { await foreignInsert(); }
          finally { await raw.query('ALTER TABLE ro_payments ENABLE TRIGGER revv_financial_guard'); }
          await raw.query("INSERT INTO agreement_requests(id,ro_id,shop_id,status) VALUES ($1,$2,$3,'signed')",[randomUUID(),ro,other]);
          assert.equal((await invoke(router,'/:id',{},'owner',shop,ro)).statusCode,200);
          assert.equal((await raw.query('SELECT 1 FROM ro_payments WHERE ro_id=$1 AND shop_id=$2',[ro,other])).rowCount,1);
          assert.equal((await raw.query('SELECT 1 FROM agreement_requests WHERE ro_id=$1 AND shop_id=$2',[ro,other])).rowCount,1);
        });
        for(const competitor of ['intent','checkout']) await t.test(`parallel intent vs ${competitor}; delayed webhook`,async()=> {
          const ro=await makeRo(),entered=barrier(),release=barrier(); let metadata,pi;
          const f=consumers(db,money,{intent:async(amount,currency,meta,key)=> {
            metadata=meta; pi=`pi_${randomUUID()}`;
            const saved=(await raw.query('SELECT * FROM ro_payment_attempts WHERE id=$1',[meta.paymentAttemptId])).rows[0];
            assert.equal(saved.idempotency_key,key); assert.equal(Number(saved.amount_cents),10000);
            entered.resolve(); await release.promise; return {id:pi,client_secret:'mock'};
          }});
          const first=createIntent(f,ro);
          try {
            await Promise.race([entered.promise,first.then(result=>{throw Error(`Intent ended before provider barrier: ${JSON.stringify(result.body)}`);})]);
            const second=await (competitor==='intent'?createIntent(f,ro):checkout(f,ro));
            assert.equal(competitor==='intent'?second.statusCode:second.ok,competitor==='intent'?409:false);
            assert.equal(f.calls.length,1); assert.equal((await invariant(ro)).open,10000);
          } finally {release.resolve();}
          assert.equal((await first).statusCode,200);
          assert.equal((await createIntent(f,ro)).statusCode,409);
          await f.reservations.settlePaymentEvent(event(pi,metadata,10000));
          await f.reservations.settlePaymentEvent(event(pi,metadata,10000));
          await f.reservations.settlePaymentEvent(event(pi,metadata,10000,'payment_intent.payment_failed'));
          const state=await invariant(ro);
          assert.equal(state.paid,10000); assert.equal(state.open,0); assert.equal(state.ledger.length,1);
          assert.equal(state.attempts[0].status,'settled');
          assert.equal((await createIntent(f,ro)).statusCode,400);
        });
        await t.test('parallel partial intent and Checkout; session/intent linkage and no double accounting',async()=> {
          const ro=await makeRo(); let intentMeta,checkoutMeta,sessionPi=`pi_${randomUUID()}`,pi=`pi_${randomUUID()}`;
          const f=consumers(db,money,{intent:async(a,c,m)=> {intentMeta=m; return {id:pi,client_secret:'mock'};},
            checkout:async(payload)=> {checkoutMeta=payload.metadata;
              assert.deepEqual(payload.payment_intent_data.metadata,checkoutMeta);
              assert.equal(payload.line_items[0].price_data.unit_amount,7000);
              return {id:`cs_${ro}`,payment_intent:sessionPi,url:'https://mock.invalid'};
            }});
          // Reserve a partial amount, then race provider persistence with Checkout.
          const partial=await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent',amount:3000,allowPartial:true});
          intentMeta=f.reservations.metadataFor(partial);
          const [link]=await Promise.all([checkout(f,ro),f.reservations.recordProviderResult(partial,{id:pi})]);
          assert.equal(link.ok,true); assert.equal((await invariant(ro)).open,10000);
          const checkoutEvent={type:'checkout.session.completed',data:{object:{id:`cs_${ro}`,payment_intent:sessionPi,
            metadata:checkoutMeta,amount_total:7000,currency:'usd',payment_status:'paid'}}};
          await Promise.all([f.reservations.settlePaymentEvent(checkoutEvent),f.reservations.settlePaymentEvent(event(sessionPi,checkoutMeta,7000))]);
          let state=await invariant(ro); assert.equal(state.paid,7000); assert.equal(state.open,3000); assert.equal(state.ledger.length,1);
          await f.reservations.settlePaymentEvent(event(pi,intentMeta,3000));
          state=await invariant(ro); assert.equal(state.paid,10000); assert.equal(state.open,0); assert.equal(state.ledger.length,2);
        });
        for(const behavior of ['throw','unknown','persistence failure','webhook before response']) await t.test(`${behavior} retains capacity`,async()=> {
          const ro=await makeRo();let pi=`pi_${randomUUID()}`,metadata;
          const f=consumers(db,money,{intent:async(a,c,m)=> {
            metadata=m;
            if(behavior==='throw') throw Error('private mock timeout');
            if(behavior==='unknown') return null;
            if(behavior==='persistence failure') hook=async(sql)=> {if(/UPDATE ro_payment_attempts/.test(sql))throw Error('injected persistence failure');};
            if(behavior==='webhook before response') await f.reservations.settlePaymentEvent(event(pi,m,10000));
            return {id:pi,client_secret:'mock'};
          }});
          try {
            const result=await createIntent(f,ro);
            assert.equal(result.statusCode,behavior==='unknown'?503:behavior==='webhook before response'?200:500);
          } finally {hook=null;}
          assert.notEqual((await createIntent(f,ro)).statusCode,200); assert.equal(f.calls.length,1);
          if(behavior!=='webhook before response') {
            assert.equal((await invariant(ro)).open,10000);
            await f.reservations.settlePaymentEvent(event(pi,metadata,10000,'payment_intent.payment_failed'));
            assert.equal((await invariant(ro)).attempts[0].status,'unknown');
            assert.equal((await createIntent(f,ro)).statusCode,409);
          }
          await f.reservations.settlePaymentEvent(event(pi,metadata,10000));
          const state=await invariant(ro); assert.equal(state.open,0); assert.equal(state.paid,10000); assert.equal(state.ledger.length,1);
        });
        await t.test('settlement DB failure rolls back ledger and settled state; later delivery succeeds',async()=> {
          const ro=await makeRo(),f=consumers(db,money);
          const a=await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent'});
          const e=event(`pi_${ro}`,f.reservations.metadataFor(a),10000);
          hook=async sql=> {if(/UPDATE repair_orders SET/.test(sql))throw Error('injected RO write failure');};
          try {await assert.rejects(f.reservations.settlePaymentEvent(e),/injected/);} finally {hook=null;}
          let state=await invariant(ro); assert.equal(state.paid,0); assert.equal(state.open,10000); assert.equal(state.ledger.length,0);
          assert.equal((await createIntent(f,ro)).statusCode,409);
          await f.reservations.settlePaymentEvent(e); state=await invariant(ro); assert.equal(state.paid,10000);assert.equal(state.open,0);
        });
        await t.test('released attempt late success commits investigation before refusal, never a successful ledger',async()=> {
          const ro=await makeRo(),f=consumers(db,money),owner=randomUUID();
          await raw.query("INSERT INTO users(id,shop_id,role) VALUES ($1,$2,'owner')",[owner,shop]);
          const a=await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent'});
          const pi=`pi_${ro}`,m=f.reservations.metadataFor(a);
          await f.reservations.recordProviderResult(a,{id:pi});
          const canceled=event(pi,m,10000,'payment_intent.canceled');canceled.data.object.status='canceled';
          await f.reservations.settlePaymentEvent(canceled);
          const before=await invariant(ro);
          for(let i=0;i<2;i++) await assert.rejects(f.reservations.settlePaymentEvent(event(pi,m,10000)),e=>e.status===409);
          assert.deepEqual(await invariant(ro),before);
          assert.equal((await raw.query('SELECT * FROM ro_payment_investigations WHERE shop_id=$1 AND attempt_id=$2',[shop,a.id])).rowCount,1);
          const notifications=(await raw.query('SELECT * FROM notifications WHERE shop_id=$1 AND ro_id=$2',[shop,ro])).rows;
          assert.equal(notifications.length,1);assert.equal(notifications[0].user_id,owner);
        });
        await t.test('tenant/missing parent/amount/provider identity conflicts cannot create orphan ledger',async()=> {
          const ro=await makeRo(),f=consumers(db,money);
          const a=await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent'}),m=f.reservations.metadataFor(a);
          for(const altered of [{...m,shopId:other},{...m,roId:randomUUID()},{...m,paymentAttemptId:randomUUID()}])
            await assert.rejects(f.reservations.settlePaymentEvent(event(`pi_${ro}`,altered,10000)));
          await assert.rejects(f.reservations.settlePaymentEvent(event(`pi_${ro}`,m,9999)));
          await f.reservations.recordProviderResult(a,{id:`pi_${ro}`});
          await assert.rejects(f.reservations.settlePaymentEvent(event('pi_mismatch',m,10000)));
          assert.equal((await invariant(ro)).ledger.length,0);
        });
        await t.test('legacy open and successful ledger preserved; settled reservation never double subtracts',async()=> {
          const ro=await makeRo(),f=consumers(db,money),pi=`pi_${ro}`;
          await raw.query(`INSERT INTO ro_payments(id,shop_id,ro_id,stripe_payment_intent_id,amount_cents,status)
            VALUES ($1,$2,$3,$4,3000,'failed')`,[randomUUID(),shop,ro,pi]);
          const r=await createIntent(f,ro); assert.equal(r.body.amountCents,7000);
          await f.reservations.settlePaymentEvent(event(pi,{roId:ro,shopId:shop},3000));
          await f.reservations.settlePaymentEvent(event(pi,{roId:ro,shopId:shop},3000,'payment_intent.payment_failed'));
          await migration.up(raw);
          const state=await invariant(ro);assert.equal(state.paid,3000);assert.equal(state.open,7000);assert.equal(state.ledger[0].status,'succeeded');
          assert.equal((await createIntent(f,ro)).statusCode,409);
        });
        await t.test('new settlement advances legacy manual-paid floor exactly once',async()=> {
          const ro=await makeRo(),f=consumers(db,money);
          await raw.query('UPDATE repair_orders SET amount_paid_cents=3000 WHERE id=$1 AND shop_id=$2',[ro,shop]);
          const a=await f.reservations.reservePayment({roId:ro,shopId:shop,kind:'intent',amount:3000,allowPartial:true});
          const e=event(`pi_${ro}`,f.reservations.metadataFor(a),3000);
          await f.reservations.settlePaymentEvent(e); await f.reservations.settlePaymentEvent(e);
          const stored=(await raw.query('SELECT amount_paid_cents FROM repair_orders WHERE id=$1',[ro])).rows[0];
          assert.equal(stored.amount_paid_cents,6000);
          const next=await createIntent(f,ro);assert.equal(next.body.amountCents,4000);
          const state=await invariant(ro);assert.equal(state.paid+state.open+3000,10000);
        });
        await t.test('identifiable old untracked Checkout failure becomes hold',async()=> {
          const ro=await makeRo(),f=consumers(db,money);
          await f.reservations.settlePaymentEvent({type:'checkout.session.async_payment_failed',data:{object:{
            id:`cs_${ro}`,payment_intent:`pi_${ro}`,metadata:{roId:ro,shopId:shop},amount_total:10000,currency:'usd'}}});
          assert.equal((await invariant(ro)).open,10000);assert.equal((await createIntent(f,ro)).statusCode,409);
        });
        await t.test('selected panel money remains authoritative on transaction client',async()=> {
          await raw.query(`CREATE TABLE ro_panel_estimator_drafts(ro_id ${identityType},shop_id ${identityType},active_revision_id TEXT);
            CREATE TABLE ro_panel_estimator_revisions(id TEXT,ro_id ${identityType},shop_id ${identityType},accounting_snapshot JSONB)`);
          await migration.up(raw); // Install optional selection guard after late table creation.
          const ro=await makeRo(),f=consumers(db,money);
          await raw.query('UPDATE estimate_line_items SET total=999 WHERE ro_id=$1',[ro]);
          await raw.query('INSERT INTO ro_panel_estimator_drafts VALUES ($1,$2,$3)',[ro,shop,'chosen']);
          await raw.query('INSERT INTO ro_panel_estimator_revisions VALUES ($1,$2,$3,$4)',
            ['chosen',ro,shop,JSON.stringify({money:{totalCents:10000,lineCount:1}})]);
          const result=await createIntent(f,ro); assert.equal(result.statusCode,200);assert.equal(result.body.amountCents,10000);
        });
      } finally {if(raw) await raw.end();if(created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);}
    });
  } finally {await admin.end();}
});

test('Stripe helper forwards optional stable idempotency key to mocked SDK',async()=> {
  const before=process.env.STRIPE_SECRET_KEY, calls=[];
  try {
    process.env.STRIPE_SECRET_KEY='synthetic-test-key';
    const stripe=load('services/stripe.js',{'stripe':class {
      constructor() {this.paymentIntents={create:async(...args)=>{calls.push(args);return {id:'pi_mock'};}};}
    }});
    await stripe.createPaymentIntent(123,'usd',{paymentAttemptId:'stable'},'ro-payment-stable');
    await stripe.createPaymentIntent(456);
    assert.deepEqual(calls[0][1],{idempotencyKey:'ro-payment-stable'});
    assert.equal(calls[0][0].metadata.paymentAttemptId,'stable');
    assert.equal(calls[1][1],undefined);
  } finally {
    if(before===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=before;
  }
});
