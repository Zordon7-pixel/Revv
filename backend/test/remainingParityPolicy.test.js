'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../src');
const parent = '901b44587fb402dc70575b406265751f33e2580a';
const shop = 'shop';
const ordinary = [{id:shop,is_internal_test_shop:false}];
const variants = {fixture:[{id:shop,is_internal_test_shop:true}], missing:[], duplicate:[...ordinary,...ordinary],
  mismatch:[{id:'other',is_internal_test_shop:false}], null:[{id:shop,is_internal_test_shop:null}],
  string:[{id:shop,is_internal_test_shop:'false'}], numeric:[{id:shop,is_internal_test_shop:0}], omitted:[{id:shop}],
  malformed:{}, failure:new Error('SYNTHETIC_PRIVATE_DB_FAILURE')};
const noop = (_q,_s,next) => next?.();
const ref = '12345678-1234-1234-1234-123456789abc';
function load(file, deps={}, options={}) {
  const code = options.parent ? execFileSync('git',['show',`${parent}:backend/src/${file}`],{encoding:'utf8'}) : fs.readFileSync(path.join(root,file),'utf8');
  const module = {exports:{}};
  const env = {NODE_ENV:'test',RESEND_API_KEY:'synthetic-only',JWT_SECRET:'synthetic-only'};
  vm.runInThisContext(`(function(require,module,exports,process,console,setImmediate,fetch){${code}\n${options.expose||''}\n})`,{filename:file})(name => {
    if (Object.hasOwn(deps,name)) return deps[name];
    throw Error(`Unapproved dependency: ${name}`);
  },module,module.exports,{env},{log(){},warn(){},error(){}},options.immediate||setImmediate,
  options.fetch||(()=>{throw Error('TEST_NETWORK_PROHIBITED')}));
  return module.exports;
}
function routerStub() {
  const routes=[];const r={routes,use(){}};
  for(const method of ['get','post','put','patch','delete'])r[method]=(url,...handlers)=>routes.push({method,url,handlers});
  return r;
}
function response(){return {statusCode:200,body:null,headers:{},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},set(k,v){this.headers[k]=v;return this;}};}
async function invoke(router,method,url,overrides={}) {
  const req={user:{id:'owner',shop_id:shop,role:'owner',plan:'agency',is_internal_test_shop:false},
    params:{id:'ro',roId:'ro',shopId:shop},query:{job_type:'collision',shop_id:'forged',is_internal_test_shop:false},
    headers:{'stripe-signature':'synthetic-signature'},body:{name:'Synthetic',email:'fixture@example.invalid',shop_id:'forged',is_internal_test_shop:false},...overrides};
  const res=response();const route=router.routes.find(r=>r.method===method&&r.url===url);assert.ok(route,url);
  for(const handler of route.handlers){let next=false;await handler(req,res,()=>{next=true});if(!next)break;}
  return res;
}
function fixture(options={}) {
  const calls=[],writes=[],effects=[],pending=[],policyCalls=[];let pi=0;
  const ro={id:'ro',shop_id:shop,ro_number:'SYN-1',customer_id:'customer',status:'repair',parts_cost:20,labor_cost:100,sublet_cost:5,total:125,
    deductible_waived:2,referral_fee:3,goodwill_repair_cost:4};
  const state={rows:options.rows??ordinary,ro};
  const read=async(sql,params,all)=>{
    if(sql.includes('SELECT id::text AS id, is_internal_test_shop')){
      policyCalls.push(params);const rows=options.sequence?options.sequence[Math.min(pi++,options.sequence.length-1)]:state.rows;
      if(rows instanceof Error)throw rows;return rows;
    }
    calls.push({sql,params});if(options.read)return options.read(sql,params,all,state);
    if(sql.startsWith('SELECT id::text AS id, shop_id::text'))return options.resourceRows??[{id:'ro',shop_id:shop}];
    if(/SELECT e\./.test(sql))return [{customer_id:'customer',email:'customer@example.invalid',phone:'+15555550100',
      email_consent:true,preferred_contact_method:'email',before_state:{status:'ordered',quantity:1},after_state:{status:'shipped',quantity:1},...options.context}];
    if(/FROM users/.test(sql))return [{id:'owner'}];
    if(/SELECT c.email/.test(sql))return {email:'customer@example.invalid',name:'Synthetic',shop_name:'Synthetic Shop'};
    if(/SELECT name, email/.test(sql))return {email:'customer@example.invalid',name:'Synthetic'};
    if(/FROM shops/.test(sql))return {id:shop,name:'Synthetic Shop',plan:options.plan||'agency',trial_ends_at:options.trial,
      quickbooks_sync_enabled:true,quickbooks_realm_id:'synthetic',quickbooks_refresh_token:'synthetic',blended_labor_cost_per_hr:20,labor_rate:100};
    if(/COUNT\(/.test(sql))return {cnt:8};
    if(/SUM\(quantity\)/.test(sql))return {labor_hours:1};
    if(/job_status_log intake_log/.test(sql))return [{days:'3'},{days:'5'},{days:'7'}];
    return all?[ro]:ro;
  };
  const query=async(sql,params)=>{
    if(/^(INSERT|UPDATE|DELETE|WITH clock)/.test(sql.trim())){writes.push({sql,params});await options.onWrite?.(sql,state);return {rows:[],rowCount:1};}
    return {rows:await read(sql,params,true),rowCount:1};
  };
  const db={dbGet:(s,p)=>read(s,p,false),dbAll:(s,p)=>read(s,p,true),dbRun:async(s,p)=>{writes.push({sql:s,params:p});return {rowCount:1};},query};
  const policy=load('services/shopPolicy.js',{'../db':db});
  const profit=load('services/profit.js',{'./shopPolicy':policy,'../db':db,'./panelEstimator':{calculateEstimate:()=>({})}});
  const mailer=load('services/mailer.js',{'./shopPolicy':policy},{fetch:async(url,args)=>{
    effects.push({kind:'mail',url,args});await options.onSend?.(state);return {ok:true,json:async()=>({id:ref})};
  }});
  const deps={express:{Router:routerStub},'../db':db,'../db/postgres':{pool:{query}},
    '../middleware/auth':noop,'../middleware/roles':load('middleware/roles.js'),
    '../services/shopPolicy':policy,'./shopPolicy':policy,'../services/profit':profit,
    '../services/mailer':mailer,'./mailer':mailer,crypto,uuid:{v4:()=> 'synthetic-id'},'express-rate-limit':()=>noop,
    '../services/notifications':{createNotification:async(...args)=>effects.push({kind:'notification',args})},
    '../services/stripe':{constructWebhookEvent:()=>({id:'event'})},
    '../services/paymentReservations':{settlePaymentEvent:async()=>({roId:'ro',shopId:shop,amountPaid:12345,ro}),
      withLockedRo:async(id,s,fn)=>{effects.push({kind:'locked',id,s});return fn({query:async()=>({rows:[]})}, {...ro,payment_status:'paid',amount_paid_cents:12500});}},
    '../services/customerBilling':{sendClosedPaidInvoiceEmail:async(...args)=>effects.push({kind:'closedInvoice',args})},
    '../services/emailTemplates':{paymentConfirmationEmail:args=>({subject:'Receipt',html:JSON.stringify(args)})},
    '../services/roMoney':{getRoMoneySummary:async()=>({totalCents:12500}),getPaidCents:async()=>12500,dollarsToCents:v=>Math.round(Number(v||0)*100),getSelectedPanelMoney:async()=>null},
    '../services/customerConsent':{},'./customerConsent':load('services/customerConsent.js'),
    '../services/panelEstimatorEconomics':{selectedEconomics:async()=>new Map(),redactSelectedRO:r=>r,redactROs:async r=>r,
      summarizeEconomics:()=>({profit_cents:9100,cost_cents:3400,profitable_count:1}),aggregateMetadata:()=>({})},
    '../services/sms':{},'../services/ownerActivity':{},'../services/deliveryFees':{calculateDeliveryFeeBreakdown:async()=>({total_fee:5}),toMoney:Number},
    '../services/quickbooks':{syncInvoiceForRo:async(...args)=>effects.push({kind:'qb',args})},'../services/customerOptInConfirmation':{},
    '../middleware/roLimitGuard':noop,'./insuranceOcr':{insuranceOcrLimiter:noop},
    '../services/panelEstimatorApproval':{panelPublicHandler:()=>noop,publicRequestError:()=>noop},
    './partsDelivery':{ensureDelivery:async()=>effects.push({kind:'schema'}),fail:Error},
    './panelEstimator':{createPanelEstimatorRouter:()=>({})}};
  const route=(name,baseline=false)=>load(`routes/${name}.js`,baseline?{...deps,'../services/profit':load('services/profit.js',{'./panelEstimator':{calculateEstimate:()=>({})}},{parent:true})}:deps,{parent:baseline,immediate:fn=>pending.push(fn),
    expose:name==='ros'?'module.exports.queues={queueQuickBooksSync, syncImportedRoFinancials};':name==='estimateLineItems'?'module.exports.sync=syncRepairOrderFinancials;':''});
  const parts=load('services/partsNotifications.js',deps);
  return {state,db,policy,profit,parts,route,calls,writes,effects,pending,policyCalls,drain:async()=>{while(pending.length)await pending.shift()();}};
}
const metrics=[['payments','/history/:shopId'],['payments','/ro/:roId'],['ros','/'],['ros','/carryover-pending'],['ros','/job-cost/summary'],['ros','/turnaround-estimate'],['ros','/:id'],['ros','/:id/invoice']];
for(const [name,url] of metrics){
  for(const [variant,rows] of Object.entries(variants))test(`${name} ${url}: ${variant} rejects forged ordinary fields before business work`,async()=>{
    const f=fixture({rows});const res=await invoke(f.route(name),'get',url);assert.equal(res.statusCode,variant==='fixture'?409:503);
    assert.equal(res.body.excluded,true);assert.deepEqual(f.calls,[]);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.policyCalls[0],[shop]);
  });
  test(`${name} ${url}: late policy change excludes payload`,async()=>{
    const f=fixture({sequence:[ordinary,variants.fixture]});const res=await invoke(f.route(name),'get',url);
    assert.equal(res.statusCode,409);assert.equal(res.body.excluded,true);assert.ok(!JSON.stringify(res.body).includes('SYN-1'));
  });
  test(`${name} ${url}: ordinary result matches exact parent`,async()=>{
    const a=fixture(),b=fixture();const current=await invoke(a.route(name),'get',url),before=await invoke(b.route(name,true),'get',url);
    assert.equal(current.statusCode,200);assert.deepEqual(current.body,before.body);
  });
}
for(const [variant,rows] of Object.entries(variants))for(const role of ['owner','admin','superadmin'])test(`plan ${variant}/${role}: no entitlement or next/usage write`,async()=>{
  const f=fixture({rows});const {requirePlan}=load('middleware/planGuard.js',{'../db':f.db,'../services/shopPolicy':f.policy});
  const res=response();let next=0;await requirePlan('pro')({user:{shop_id:shop,role,plan:'agency',is_internal_test_shop:false}},res,()=>next++);
  assert.equal(res.statusCode,variant==='fixture'?409:503);assert.equal(res.body.excluded,true);assert.equal(next,0);assert.deepEqual(f.calls,[]);
});
for(const [plan,trial,status] of [['agency',null,200],['free',null,403],['free','2099-01-01',200]])test(`plan ordinary ${plan}/${trial}: entitlement parity`,async()=>{
  const f=fixture({plan,trial});const res=response();let next=0;const guard=load('middleware/planGuard.js',{'../db':f.db,'../services/shopPolicy':f.policy});
  await guard.requirePlan('pro')({user:{shop_id:shop}},res,()=>next++);assert.equal(res.statusCode,status);assert.equal(next,status===200?1:0);
});
test('plan late change before next denies usage mutation',async()=>{
  const f=fixture({sequence:[ordinary,variants.fixture]});const res=response();const guard=load('middleware/planGuard.js',{'../db':f.db,'../services/shopPolicy':f.policy});
  await guard.requirePlan('free')({user:{shop_id:shop,role:'superadmin'}},res,()=>assert.fail('usage'));assert.equal(res.statusCode,409);
});
for(const [variant,rows] of Object.entries(variants))for(const method of ['calculatePersistedProfit','calculatePersistedTrueProfit'])test(`profit ${method}: ${variant} denies supplied false flag`,async()=>{
  const f=fixture({rows});await assert.rejects(f.profit[method]({...f.state.ro,is_internal_test_shop:false}),e=>e.reason===(variant==='fixture'?'INTERNAL_TEST_SHOP':'SHOP_POLICY_UNAVAILABLE'));
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
});
test('profit ordinary arithmetic exactly matches parent for legacy/profile/explicit hours/rate fallback',async()=>{
  const f=fixture(),old=load('services/profit.js',{'./panelEstimator':{calculateEstimate:()=>({})}},{parent:true});
  // Public arithmetic helpers retain their synchronous, DB-free contracts.
  assert.deepEqual(f.profit.calculateProfit(f.state.ro),old.calculateProfit(f.state.ro));
  for(const profile of [null,{}, {blended_labor_cost_per_hr:20,parts_margin_pct:0.3,sublet_margin_pct:0.2}])for(const opts of [{},{laborHours:2},{laborRate:100}]) {
    assert.deepEqual(f.profit.calculateTrueProfit(f.state.ro,profile,opts),old.calculateTrueProfit(f.state.ro,profile,opts));
  }
  assert.deepEqual(f.policyCalls,[]);assert.deepEqual(f.calls,[]);
  assert.deepEqual(await f.profit.calculatePersistedProfit(f.state.ro),old.calculateProfit(f.state.ro));
  for(const profile of [null,{}, {blended_labor_cost_per_hr:20,parts_margin_pct:0.3,sublet_margin_pct:0.2}])for(const opts of [{},{laborHours:2},{laborRate:100}]) {
    assert.deepEqual(await f.profit.calculatePersistedTrueProfit(f.state.ro,profile,opts),old.calculateTrueProfit(f.state.ro,profile,opts));
  }
});
for(const resourceRows of [[],[{id:'ro',shop_id:'other'}],[{id:'other',shop_id:shop}],[{id:'ro',shop_id:shop},{id:'ro',shop_id:shop}]])test('profit rejects unavailable/mismatched persisted resource identity',async()=>{
  const f=fixture({resourceRows});await assert.rejects(f.profit.calculatePersistedProfit(f.state.ro),{reason:'SHOP_POLICY_UNAVAILABLE'});
});
test('profit late policy change and missing identity never yield zero/ordinary metric',async()=>{
  const f=fixture({sequence:[ordinary,variants.fixture]});await assert.rejects(f.profit.calculatePersistedProfit(f.state.ro),{reason:'INTERNAL_TEST_SHOP'});
  const g=fixture();for(const ro of [{},{...g.state.ro,id:null},{...g.state.ro,shop_id:null}])await assert.rejects(g.profit.calculatePersistedProfit(ro),{reason:'SHOP_POLICY_UNAVAILABLE'});
  for(const resourceRows of [[null],{}]) {
    const malformed=fixture({resourceRows});
    await assert.rejects(malformed.profit.calculatePersistedProfit(malformed.state.ro),{reason:'SHOP_POLICY_UNAVAILABLE'});
    assert.deepEqual(malformed.writes,[]);
  }
});
for(const [variant,rows] of Object.entries(variants))test(`parts ${variant}: no schema/provider/claim/cooldown/mark writes`,async()=>{
  const f=fixture({rows});const result=await f.parts.notifyPartUpdate(f.db,shop,{id:'part',delivery_revision:2,is_internal_test_shop:false,shop_id:'forged'},1);
  assert.equal(result.status,'suppressed');assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.effects,[]);
});
test('parts strict false forwards verified shop into actual mailer and records acceptance',async()=>{
  const f=fixture();const result=await f.parts.notifyPartUpdate(f.db,shop,{id:'part',delivery_revision:2},1);
  assert.equal(result.channels.find(c=>c.channel==='email').status,'accepted');assert.equal(f.effects.filter(e=>e.kind==='mail').length,1);
  assert.ok(f.policyCalls.every(p=>p[0]===shop));assert.ok(f.writes.some(w=>w.sql.startsWith('UPDATE parts_delivery_notifications')));
});
for(const sequence of [[ordinary,variants.fixture],[ordinary,ordinary,variants.fixture]])test('parts policy flip before claim/cooldown stops effects',async()=>{
  const f=fixture({sequence});const result=await f.parts.notifyPartUpdate(f.db,shop,{id:'part',delivery_revision:2},1);
  assert.equal(result.status,'suppressed');assert.equal(f.effects.filter(e=>e.kind==='mail').length,0);assert.ok(!f.writes.some(w=>/WITH clock|UPDATE parts_delivery/.test(w.sql)));
});
test('parts late pre-provider refusal releases only acquired cooldown, never marks accepted',async()=>{
  const f=fixture({onWrite:async(sql,state)=>{if(sql.startsWith('WITH clock'))state.rows=variants.fixture;}});
  const result=await f.parts.notifyPartUpdate(f.db,shop,{id:'part',delivery_revision:2},1);
  assert.equal(result.status,'suppressed');assert.equal(f.effects.filter(e=>e.kind==='mail').length,0);
  const claim=f.writes.find(w=>w.sql.startsWith('WITH clock')),release=f.writes.find(w=>w.sql.startsWith('DELETE FROM parts_notification_cooldowns'));
  assert.equal(release.params[3],claim.params[3]);assert.ok(!f.writes.some(w=>w.sql.startsWith('UPDATE')));
});
test('parts late post-provider policy refusal never records acceptance or releases uncertain claim',async()=>{
  const f=fixture({onSend:async state=>{state.rows=variants.fixture;}});const result=await f.parts.notifyPartUpdate(f.db,shop,{id:'part',delivery_revision:2},1);
  assert.equal(result.status,'suppressed');assert.equal(f.effects.filter(e=>e.kind==='mail').length,1);
  assert.ok(!f.writes.some(w=>/^(UPDATE|DELETE)/.test(w.sql)));
});
for(const [variant,rows] of Object.entries(variants))test(`payment receipt ${variant}: zero notifications/providers`,async()=>{
  const f=fixture({rows});const res=await invoke(f.route('payments'),'post','/webhook');await f.drain();assert.equal(res.statusCode,variant==='fixture'?409:503);assert.deepEqual(f.effects,[]);
});
test('ordinary detached receipt reaches actual mailer with settlement tenancy',async()=>{
  const f=fixture();const res=await invoke(f.route('payments'),'post','/webhook');assert.equal(res.statusCode,200);assert.equal(f.pending.length,1);await f.drain();
  assert.equal(f.effects.filter(e=>e.kind==='mail').length,1);const body=JSON.parse(f.effects.find(e=>e.kind==='mail').args.body);assert.match(body.html,/\$123\.45/);
  assert.deepEqual(body.to,['customer@example.invalid']);assert.ok(f.policyCalls.every(p=>p[0]===shop));
  assert.match(f.calls.find(c=>/SELECT c.email/.test(c.sql)).sql,/c.shop_id = ro.shop_id/);
});
test('detached receipt rechecks after settlement and customer preparation',async()=>{
  for(const sequence of [[ordinary,variants.fixture],[ordinary,ordinary,variants.fixture]]){
    const f=fixture({sequence});await invoke(f.route('payments'),'post','/webhook');await f.drain();assert.equal(f.effects.filter(e=>['mail','closedInvoice'].includes(e.kind)).length,0);
  }
});
for(const variant of ['fixture','missing'])test(`RO invoice/QB ${variant}: no sends`,async()=>{
  const f=fixture({rows:variants[variant]}),r=f.route('ros');const res=await invoke(r,'post','/:id/email-invoice');assert.equal(res.statusCode,variant==='fixture'?409:503);
  r.queues.queueQuickBooksSync('ro',shop);await f.drain();assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
});
test('RO invoice/QB ordinary and late policy outcomes',async()=>{
  const f=fixture(),r=f.route('ros');assert.equal((await invoke(r,'post','/:id/email-invoice')).statusCode,200);r.queues.queueQuickBooksSync('ro',shop);await f.drain();
  assert.equal(f.effects.filter(e=>e.kind==='mail').length,1);assert.deepEqual(f.effects.find(e=>e.kind==='qb').args,[shop,'ro']);
  const g=fixture({sequence:[ordinary,variants.fixture]}),s=g.route('ros');s.queues.queueQuickBooksSync('ro',shop);await g.drain();assert.deepEqual(g.effects,[]);
});
for(const name of ['leads','waitlist'])for(const user of [undefined,{shop_id:shop,role:'owner',is_internal_test_shop:false}])test(`${name} no global capability for public/authenticated fixture/forged intake`,async()=>{
  for(const rows of [ordinary,variants.fixture,variants.missing]){
    const f=fixture({rows});const res=await invoke(f.route(name),'post','/',{user});await f.drain();assert.equal(res.statusCode,200);
    assert.deepEqual(res.body,name==='leads'?{success:true}:{ok:true});assert.deepEqual(f.effects,[]);assert.deepEqual(f.policyCalls,[]);
    if(name==='waitlist'){const insert=f.writes.find(w=>w.sql.startsWith('INSERT INTO waitlist'));assert.deepEqual(insert.params,['fixture@example.invalid','landing']);}
  }
});
test('public intake validation remains unchanged',async()=>{
  for(const name of ['leads','waitlist']){const f=fixture();assert.equal((await invoke(f.route(name),'post','/',{body:{},user:undefined})).statusCode,400);assert.deepEqual(f.effects,[]);}
});
test('caller migrations await guarded profit with persisted identity before financial writes',async()=>{
  for(const name of ['ros','estimateLineItems']){
    const f=fixture();const r=f.route(name);const fn=name==='ros'?r.queues.syncImportedRoFinancials:r.sync;
    if(name==='ros')await fn('ro',shop);
    else await fn('ro',shop,{parts_total:20,labor_total:100,sublet_total:5});
    assert.ok(f.writes.some(w=>/UPDATE repair_orders/.test(w.sql)));assert.ok(f.policyCalls.length>=2);
    for(const rows of [variants.fixture,variants.missing]) {
      const denied=fixture({rows}),router=denied.route(name);
      const call=name==='ros'?()=>router.queues.syncImportedRoFinancials('ro',shop)
        :()=>router.sync('ro',shop,{parts_total:20,labor_total:100,sublet_total:5});
      await assert.rejects(call,e=>['INTERNAL_TEST_SHOP','SHOP_POLICY_UNAVAILABLE'].includes(e.reason));
      assert.deepEqual(denied.writes,[]);assert.deepEqual(denied.effects,[]);
    }
  }
});

for (const scenario of ['ordinary', 'flagged', 'unavailable', 'late flip', 'wrong resource']) {
  test(`import profit uses the uncommitted transaction reader: ${scenario}`, async () => {
    const f = fixture();
    // The separate pool cannot see this new row. Never mask that with a fixture
    // that lets uncommitted data leak into global reads.
    f.db.dbAll = async () => assert.fail('Import escaped its transaction');
    const sync = f.route('ros').queues.syncImportedRoFinancials;
    const reads = [], writes = [];
    let policyReads = 0;
    const readRows = async (sql, params) => {
      reads.push({ sql, params });
      if (sql.includes('is_internal_test_shop')) {
        assert.deepEqual(params, [shop]);
        policyReads++;
        if (scenario === 'unavailable') throw Error('Synthetic transaction failure');
        return scenario === 'flagged' || (scenario === 'late flip' && policyReads === 2) ? variants.fixture : ordinary;
      }
      assert.match(sql, /WHERE id::text = \$1 AND shop_id::text = \$2$/);
      assert.deepEqual(params, ['new-ro', shop]);
      return [{ id: 'new-ro', shop_id: scenario === 'wrong resource' ? 'other' : shop }];
    };
    const queryOne = async sql => sql.includes('FROM repair_orders') ? { id: 'new-ro' }
      : sql.includes('FROM shops') ? { tax_rate: 0 } : { labor_total: 100, subtotal: 100 };
    const run = () => sync('new-ro', shop, queryOne, async (sql, params) => { writes.push({ sql, params }); }, readRows);
    if (scenario === 'ordinary') {
      await run();
      assert.equal(reads.length, 3);
      assert.equal(writes.length, 1);
      assert.match(writes[0].sql, /WHERE id = \$8 AND shop_id = \$9/);
      assert.equal(writes[0].params[6], 100);
      assert.deepEqual(writes[0].params.slice(-2), ['new-ro', shop]);
    } else {
      await assert.rejects(run, e => ['INTERNAL_TEST_SHOP', 'SHOP_POLICY_UNAVAILABLE'].includes(e.reason));
      assert.deepEqual(writes, []);
    }
  });
}

test('a missing guarded profit export cannot make routes fall back to pure arithmetic', async () => {
  const f = fixture();
  delete f.profit.calculatePersistedProfit;
  const sync = f.route('ros').queues.syncImportedRoFinancials;
  await assert.rejects(() => sync('ro', shop), /calculatePersistedProfit is not a function/);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.effects, []);
});
