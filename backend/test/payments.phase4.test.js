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
    if (['express','uuid','crypto'].includes(name)) return local(name);
    throw new Error(`Unmocked dependency ${name}`);
  }, module, module.exports);
  return module.exports;
}
async function invoke(router, route, body, role = 'owner', shop = 'shop') {
  const layer = router.stack.find(l => l.route?.path === route && (route !== '/:id' || l.route.methods.delete));
  const req = { body, params: { id: 'ro' }, user: { id:'user', shop_id:shop, role } };
  const res = { statusCode:200, status(n) { this.statusCode=n; return this; }, json(value) { this.body=value; return this; } };
  let index=0; const pending=[];
  const next = () => { const result=layer.route.stack[index++]?.handle(req,res,next); if (result?.then) pending.push(result); return result; };
  next(); await Promise.all(pending); return res;
}
function fixture({ total=10000, paid=2500, ro: overrides={} }={}) {
  const calls=[], writes=[];
  const db = {
    dbGet: async (sql, params) => {
      if (/FROM repair_orders/.test(sql)) {
        assert.match(sql,/shop_id = \$2/);
        return params[1] === 'shop' ? { id:'ro', shop_id:'shop', payment_status:'unpaid', ...overrides } : null;
      }
      if (/SUM\(amount_cents\)/.test(sql)) {
        assert.match(sql,/shop_id = \$2/); assert.match(sql,/IN \('succeeded', 'paid'\)/);
        return { paid_cents:paid };
      }
      throw new Error(`Unexpected query ${sql}`);
    },
    dbAll: async () => [], dbRun: async (sql, params) => { writes.push({sql,params}); },
  };
  const money = load('services/roMoney.js', { '../db':db });
  const router=load('routes/payments.js', {
    '../db':db, '../middleware/auth':(req,res,next)=>next(), '../middleware/roles':roles,
    '../services/roMoney':{ ...money, getRoMoneySummary:async (id, shop)=> { assert.equal(id,'ro'); assert.equal(shop,'shop'); return { totalCents:total,lineCount:1 }; } },
    '../services/stripe':{ createPaymentIntent:async (...args)=> { calls.push(args); return {id:'pi_mock',client_secret:'mock',status:'pending'}; } },
    '../services/notifications':{}, '../services/mailer':{}, '../services/emailTemplates':{}, '../services/customerBilling':{},
  });
  return {router,calls,writes};
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
      assert.equal(f.writes.find(w=>/UPDATE repair_orders/.test(w.sql)).params[2],7500);
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

function deletionFixture(fact) {
  const queries=[];
  const query=async (sql,params=[])=> {
    queries.push({sql,params});
    if (/FOR UPDATE/.test(sql)) { assert.match(sql,/shop_id = \$2/); return {rows:params[1]==='shop'?[{id:'ro',payment_status:fact==='paid'||fact==='partial'?fact:'unpaid',payment_received:fact==='received'?1:0,amount_paid_cents:fact==='legacy'?1:0}]:[]}; }
    if (/to_regclass/.test(sql)) return {rows:[{relation:params[0]==='ro_panel_estimator_drafts'?(fact==='draft'?'draft':null):params[0]}]};
    if (/SUM\(amount_cents\)/.test(sql)) { assert.match(sql,/shop_id = \$2/); assert.match(sql,/IN \('paid', 'succeeded'\)/); return {rows:[{paid_cents:fact==='ledger'?1:0}]}; }
    if (/SELECT 1 FROM ro_panel/.test(sql)) return {rows:[{}],rowCount:1};
    if (/DELETE/.test(sql)) assert.match(sql,/shop_id = \$2/);
    return {rows:[],rowCount:1};
  };
  const mocks={ '../db':{pool:{connect:async()=>({query,release:()=>{}})}},
    '../middleware/auth':(req,res,next)=>next(), '../middleware/roles':roles,
    '../middleware/roLimitGuard':(req,res,next)=>next(),
    'express-rate-limit':()=> (req,res,next)=>next(),
    './insuranceOcr':{insuranceOcrLimiter:(req,res,next)=>next()},
    '../services/panelEstimatorApproval':{panelPublicHandler:()=> (req,res,next)=>next(), publicRequestError:()=> (req,res,next)=>next(), noStore:(req,res,next)=>next()},
  };
  for (const name of ['customerConsent','panelEstimatorEconomics','profit','roMoney','sms','mailer','emailTemplates','ownerActivity','notifications','deliveryFees','customerBilling','quickbooks','customerOptInConfirmation']) mocks[`../services/${name}`]={};
  return {router:load('routes/ros.js',mocks),queries};
}
for (const role of ['tech','technician','employee','staff','owner','admin','assistant','superadmin','customer']) {
  for (const fact of ['ledger','paid','partial','received','legacy','unpaid','draft']) test(`DELETE ${role}/${fact}`,async()=> {
    const f=deletionFixture(fact), result=await invoke(f.router,'/:id',{},role);
    const admitted=roles.getRoleRank(role)>=roles.ROLE_RANK.technician;
    const blockedPaid=roles.getRoleRank(role)<roles.ROLE_RANK.admin && !['unpaid','draft'].includes(fact);
    const expected=!admitted||blockedPaid?403:fact==='draft'?409:200;
    assert.equal(result.statusCode,expected);
    const deletes=f.queries.filter(q=>/^DELETE/.test(q.sql));
    if (expected!==200) { assert.equal(deletes.length,0); if(admitted) assert.equal(f.queries.at(-1).sql,'ROLLBACK'); }
    else { assert.equal(deletes.length,13); assert.equal(f.queries[0].sql,'BEGIN ISOLATION LEVEL READ COMMITTED'); assert.equal(f.queries.at(-1).sql,'COMMIT'); }
  });
}
test('DELETE cross-shop rolls back without writes',async()=> {
  const f=deletionFixture('ledger'); assert.equal((await invoke(f.router,'/:id',{},'technician','other')).statusCode,404);
  assert.equal(f.queries.at(-1).sql,'ROLLBACK'); assert.equal(f.queries.filter(q=>/^DELETE/.test(q.sql)).length,0);
});
