'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../src');
const parent = 'c9c4e9d64d46ebb8ec719c46066c2b6f5b8faee1';
const shop = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ordinary = [{ id: shop, is_internal_test_shop: false }];
const variants = {
  fixture: [{ id: shop, is_internal_test_shop: true }], missing: [],
  duplicate: [...ordinary, ...ordinary], mismatch: [{ id: other, is_internal_test_shop: false }],
  null: [{ id: shop, is_internal_test_shop: null }], string: [{ id: shop, is_internal_test_shop: 'false' }],
  number: [{ id: shop, is_internal_test_shop: 0 }], omitted: [{ id: shop }],
  malformed: {}, failed: new Error('SYNTHETIC_PRIVATE_QUERY_FAILURE'),
};
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-21T23:30:00Z'])); }
  static now() { return new Clock().getTime(); }
}
function load(file, deps, baseline = false) {
  const code = baseline ? execFileSync('git', ['show', `${parent}:backend/src/${file}`], { encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,process,console,Date){${code}\n})`, { filename: file })(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    throw Error(`Forbidden dependency: ${name}`);
  }, module, module.exports, { env: { NODE_ENV: 'test', JWT_SECRET: 'synthetic-only', REVV_AGENT_API_KEY: 'synthetic-agent-only' } },
  { log() {}, info() {}, error() {}, warn() {} }, Clock);
  return module.exports;
}
function routerStub() {
  const routes = [], middleware = [];
  const router = { routes, middleware, use: (...args) => { if (typeof args[0] === 'function') middleware.push(...args); } };
  for (const method of ['get','post','put','delete']) router[method] = (url, ...handlers) => routes.push({method,url,handlers});
  return router;
}
function token() {
  const payload = Buffer.from(JSON.stringify({ro_id:'ro',shop_id:shop,exp:Clock.now()+60000})).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256','synthetic-only').update(payload).digest('base64url')}`;
}
async function invoke(f, method, url, overrides = {}) {
  const req = { user: { id:'user',shop_id:shop,role:'admin',is_internal_test_shop:false },
    headers:{authorization:'Bearer synthetic','x-api-key':'synthetic-agent-only'}, query:{shop:'abcdefghijkl',limit:'17',offset:'3',shop_id:other,is_internal_test_shop:false},
    params:{id:'ro',shopId:shop,slug:'abcdefghijkl',token:token()},
    body:{name:'Synthetic',phone:'2125550100',email:'ordinary@example.invalid',year:2020,make:'Test',model:'Car',damage_type:'hail',
      rating:5,message:'Synthetic feedback',routed_to:'Codex',shop_id:other,is_internal_test_shop:false,plan:'agency',role:'superadmin'}, ...overrides };
  req.get = name => req.headers[name.toLowerCase()];
  const res = { statusCode:200, headers:{}, body:undefined,
    status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;},setHeader(k,v){this.headers[k]=v;} };
  const route=f.router.routes.find(r=>r.method===method&&r.url===url);assert.ok(route);
  for(const fn of [...f.router.middleware,...route.handlers]) {
    let next=false;await fn(req,res,()=>{next=true;});if(!next)break;
  }
  await new Promise(resolve=>setImmediate(resolve));
  return res;
}
function fixture(file, options={}) {
  const calls=[],policyCalls=[],writes=[],effects=[],tx=[],committed=[];
  let index=0,pending=[];
  const rows = params => {
    policyCalls.push(params);
    const value=options.sequence ? options.sequence[Math.min(index++,options.sequence.length-1)] : (options.rows??ordinary);
    if(value instanceof Error)throw value;
    return value;
  };
  const item={id:'ro',shop_id:shop,name:'Synthetic',customer_name:'Synthetic Customer',created_at:'2026-10-01T00:00:00Z',
    updated_at:'2026-10-02T00:00:00Z',total:'12.34',parts_cost:'10.20',labor_cost:'2.14',rating:5,count:2,
    average_rating:'4.5',total_reviews:2,avg_rating:'4.5',review_count:12,owner_activity_digest_time:'00:00'};
  const read=async(sql,params,all)=>{
    if(sql.includes('SELECT id::text AS id, is_internal_test_shop'))return rows(params);
    calls.push({sql,params});
    if(options.read)return options.read(sql,params,all);
    if(/SELECT shop_id FROM repair_orders/.test(sql))return {shop_id:shop};
    if(/SELECT id FROM shop_reviews/.test(sql))return null;
    if(/SELECT id FROM shops WHERE public_intake_slug/.test(sql))return {id:shop};
    if(/FROM shops s\n|^SELECT id FROM shops WHERE is_internal_test_shop/.test(sql))return all?[{id:shop,owner_activity_digest_time:'00:00'}]:item;
    return all?[item]:item;
  };
  const client={query:async(sql,params)=>{
    tx.push({sql,params});
    if(sql==='BEGIN'){pending=[];return {rows:[]};}
    if(sql==='ROLLBACK'){pending=[];return {rows:[]};}
    if(sql==='COMMIT'){committed.push(...pending);pending=[];return {rows:[]};}
    if(sql.includes('SELECT id::text AS id, is_internal_test_shop'))return {rows:rows(params)};
    if(/FOR SHARE/.test(sql))return {rows:[{id:shop}]};
    if(/^(INSERT|UPDATE|DELETE)/.test(sql.trim())){
      writes.push({sql,params});
      const rowCount=options.noClaim?0:/status = 'closed'/.test(sql)?6:/status = CASE/.test(sql)?4:1;
      if(rowCount)pending.push({sql,params});return {rowCount};
    }
    throw Error(`Unexpected transaction SQL: ${sql}`);
  },release:()=>tx.push({sql:'RELEASE'})};
  const db={dbAll:(s,p)=>read(s,p,true),dbGet:(s,p)=>read(s,p,false),
    dbRun:async(sql,params)=>{writes.push({sql,params});return {rowCount:1};},
    pool:{connect:async()=>{tx.push({sql:'CONNECT'});return client;}}};
  const policy=load('services/shopPolicy.js',{'../db':db});
  const router=routerStub();const next=(req,res,n)=>n();
  const deps={express:{Router:()=>router},'../db':db,'../services/shopPolicy':policy,
    '../middleware/auth':(req,res,n)=>req.user?n():res.status(401).json({error:'Unauthorized'}),
    '../middleware/roles':load('middleware/roles.js',{}),'express-rate-limit':()=>next,
    uuid:{v4:()=> 'synthetic-id'},crypto,jsonwebtoken:{verify:()=>({shop_id:options.jwtShop===undefined?shop:options.jwtShop})},
    '../services/customerOptInConfirmation':{sendCustomerOptInConfirmation:async()=>effects.push('optin')},
    '../services/customerConsent':{},'../middleware/apiKeyAuth':load('middleware/apiKeyAuth.js',{crypto}),'./catalog':{},'./inspections':{},
    '../utils/discord':{sendDiscordEmbed:async(...args)=>effects.push(args)},
    '../services/ownerActivity':{sendOwnerActivityDigest:async(args)=>{effects.push(args);if(options.serviceError)throw options.serviceError;return options.serviceResult||{sent:2};}},
  };
  deps['../services/publicShop']=load('services/publicShop.js',{'../db':db,'node:crypto':crypto});
  const exports=load(file,deps,options.baseline);
  return {router,exports,calls,policyCalls,writes,effects,tx,committed};
}
const tenants=[
  ...['/','/:id/full','/:id/history','/:id/autofill','/:id'].map(url=>['customers','get',url]),
  ['customers','delete','/:id'],['reviews','get','/'],['reviews','get','/summary'],
  ['reviews','get','/context/:token'],['reviews','post','/submit/:token'],
  ['public','get','/shop/:shopId'],['public','get','/intake/:slug'],['public','post','/estimate-request'],
  ['export','get','/ro/:id'],['export','get','/shop/ros'],['feedback','get','/'],['feedback','post','/'],
  ['apiV1','get','/estimates/:id'],['apiV1','get','/jobs/:id/status'],
];
for(const [name,method,url] of tenants){
  for(const [variant,value] of Object.entries(variants))test(`${name} ${method} ${url}: ${variant} refuses forged ordinary flags`,async()=>{
    const f=fixture(`routes/${name}.js`,{rows:value});const res=await invoke(f,method,url);
    const reason=variant==='fixture'?'INTERNAL_TEST_SHOP':'SHOP_POLICY_UNAVAILABLE';
    assert.equal(res.statusCode,variant==='fixture'?409:503);assert.equal(res.body.excluded,true);
    assert.deepEqual(res.body,name==='apiV1'?{success:false,error:{code:reason,message:reason},excluded:true}:{error:reason,excluded:true});
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.effects,[]);assert.deepEqual(res.headers,{});assert.deepEqual(f.tx,[]);
    assert.deepEqual(f.policyCalls[0],[shop]);
    // Only minimal persisted resource/link identity may be read before policy.
    assert.ok(f.calls.every(c=>/SELECT shop_id FROM repair_orders|SELECT id FROM shops WHERE public_intake_slug/.test(c.sql)));
  });
  if(!(name==='customers'&&method==='delete'))test(`${name} ${method} ${url}: strict-false parent response parity`,async()=>{
    const current=fixture(`routes/${name}.js`),before=fixture(`routes/${name}.js`,{baseline:true});
    const got=await invoke(current,method,url),expected=await invoke(before,method,url);
    assert.equal(got.statusCode,expected.statusCode);assert.deepEqual(got.body,expected.body);assert.deepEqual(got.headers,expected.headers);
    assert.ok(got.statusCode<400);assert.ok(current.policyCalls.length>=2);
    if(['customers','export'].includes(name))assert.deepEqual(current.calls,before.calls);
  });
  if(method==='get')test(`${name} ${url}: policy change after preparation emits no payload`,async()=>{
    const f=fixture(`routes/${name}.js`,{sequence:[ordinary,variants.fixture]});const res=await invoke(f,method,url);
    assert.equal(res.statusCode,409);assert.equal(res.body.excluded,true);assert.deepEqual(res.headers,{});assert.deepEqual(f.effects,[]);
  });
}
for(const name of ['feedback','reviews','public'])test(`${name}: late policy change stops insert/routing/notification`,async()=>{
  const url={feedback:'/',reviews:'/submit/:token',public:'/estimate-request'}[name];
  const f=fixture(`routes/${name}.js`,{sequence:[ordinary,variants.fixture]});
  assert.equal((await invoke(f,'post',url)).statusCode,409);assert.deepEqual(f.writes,[]);assert.deepEqual(f.effects,[]);
});
test('public notification rechecks after local insert and again in detached callback; only stored tenancy is forwarded',async()=>{
  for(const sequence of [[ordinary,ordinary,variants.fixture],[ordinary,ordinary,ordinary,variants.failed]]){
    const f=fixture('routes/public.js',{sequence});await invoke(f,'post','/estimate-request');assert.equal(f.writes.length,1);assert.deepEqual(f.effects,[]);
  }
  const f=fixture('routes/public.js');await invoke(f,'post','/estimate-request');assert.equal(f.effects.length,1);assert.equal(f.effects[0][1],shop);
  assert.deepEqual(f.effects[0][0].fields.map(row=>row.name),['Shop ID','Request ID','Type']);
  assert.equal(f.writes[0].params[1],shop);
});
test('feedback missing verified JWT tenancy cannot use body or email to authorize routing',async()=>{
  const f=fixture('routes/feedback.js',{jwtShop:null});const res=await invoke(f,'post','/');assert.equal(res.statusCode,503);assert.deepEqual(f.writes,[]);
});
test('public aggregate SQL independently filters shop, ratings count/average and reviews; limit retained',async()=>{
  const f=fixture('routes/public.js');await invoke(f,'get','/shop/:shopId');assert.equal(f.calls.length,3);
  for(const {sql,params} of f.calls){assert.match(sql,/is_internal_test_shop IS FALSE/);assert.deepEqual(params,[shop]);}
  assert.match(f.calls[1].sql,/AVG\(rating\)[\s\S]*COUNT\(\*\)/);assert.match(f.calls[2].sql,/LIMIT 10/);
});
for(const [file,url] of [['feedback','/all'],['apiV1','/estimates']])test(`${file}: mixed global list membership is strict FALSE and pagination survives`,async()=>{
  const population=[{id:'ordinary',shop_id:shop,flag:false},{id:'fixture',shop_id:other,flag:true},{id:'unknown',flag:null}];
  const f=fixture(`routes/${file}.js`,{read:(sql)=>{
    assert.match(sql,/EXISTS \(SELECT 1 FROM shops s WHERE s.id::text = (?:ro|feedback).shop_id::text AND s.is_internal_test_shop IS FALSE\)/);
    return population.filter(row=>row.flag===false);
  }});
  const res=await invoke(f,'get',url,{user:{role:'superadmin'}});assert.equal(res.statusCode,200);
  assert.deepEqual((res.body.feedback||res.body.data).map(row=>row.id),['ordinary']);
  if(file==='feedback'){assert.deepEqual(f.calls[0].params,[17,3]);assert.match(f.calls[0].sql,/LIMIT \$1 OFFSET \$2/);}
  else{assert.match(f.calls[0].sql,/LIMIT 17/);assert.deepEqual(res.body.meta,{count:1});}
});
for(const url of ['/estimates/:id','/jobs/:id/status'])test(`API ${url}: stored identity repeats in business WHERE, forged caller identity ignored`,async()=>{
  const f=fixture('routes/apiV1.js');await invoke(f,'get',url);assert.deepEqual(f.calls[1].params,['ro',shop]);assert.match(f.calls[1].sql,/shop_id = \$2/);
});
const jobs=[['feedbackDailyAudit','closeEstimateImportSuccessNoise'],['feedbackDailyAudit','assignOpenUnassignedFeedback'],['feedbackDailyAudit','runFeedbackDailyAudit'],['ownerActivityDigest','runOwnerActivityDigest']];
for(const [file,method] of jobs){
  for(const [variant,value]of Object.entries(variants))test(`${method}: ${variant} consumes no mutation/claim/date/service`,async()=>{
    const f=fixture(`jobs/${file}.js`,{rows:value});await f.exports[method](shop);
    assert.deepEqual(f.writes,[]);assert.deepEqual(f.committed,[]);assert.deepEqual(f.effects,[]);assert.deepEqual(f.tx,[]);
  });
  for(const [stage,sequence]of Object.entries({locked:[ordinary,variants.fixture],precommit:[ordinary,ordinary,variants.failed]}))test(`${method}: ${stage} policy change rolls back claims and routing`,async()=>{
    const f=fixture(`jobs/${file}.js`,{sequence});await f.exports[method](shop);
    assert.deepEqual(f.committed,[]);assert.deepEqual(f.effects,[]);assert.ok(f.tx.some(c=>c.sql==='ROLLBACK'));
    if(stage==='locked')assert.deepEqual(f.writes,[]);
    const locks=f.tx.filter(c=>/FOR SHARE/.test(c.sql));assert.deepEqual(locks[0].params,[shop]);
  });
}
test('feedback daily audit ordinary counts/routing preserved; every mutation repeats membership and tenant binding',async()=>{
  const f=fixture('jobs/feedbackDailyAudit.js');assert.deepEqual(await f.exports.runFeedbackDailyAudit(),{closedNoise:6,assigned:4});
  assert.equal(f.committed.length,2);assert.equal(f.effects.length,0);
  for(const c of f.calls)assert.match(c.sql,/is_internal_test_shop IS FALSE/);
  for(const c of f.writes){assert.deepEqual(c.params,[shop]);assert.match(c.sql,/WHERE shop_id::text = \$1/);assert.match(c.sql,/s.is_internal_test_shop IS FALSE/);}
  assert.match(f.writes[0].sql,/items imported from insurance estimate/);
  assert.match(f.writes[1].sql,/THEN 'Hermes'[\s\S]*ELSE 'Codex'/);
});
test('digest ordinary preferences, daily claim idempotency and counts preserved',async()=>{
  const f=fixture('jobs/ownerActivityDigest.js');assert.deepEqual(await f.exports.runOwnerActivityDigest(),{shops:1,sent:2,skipped:0});
  assert.equal(f.committed.length,1);assert.equal(f.effects.length,1);
  assert.match(f.calls[0].sql,/s.is_internal_test_shop IS FALSE/);assert.match(f.calls[0].sql,/digest_enabled, TRUE\) = TRUE/);
  assert.deepEqual(f.writes[0].params,[shop,'2026-10-21','23:30']);
  assert.match(f.writes[0].sql,/last_digest_date, ''\) <> \$2/);assert.match(f.writes[0].sql,/digest_enabled, TRUE\) = TRUE/);
  assert.match(f.writes[0].sql,/digest_time, '19:00'\) <= \$3/);
  assert.deepEqual(f.effects[0],{shopId:shop,since:'2026-10-20T23:30:00.000Z',until:'2026-10-21T23:30:00.000Z'});
  const duplicate=fixture('jobs/ownerActivityDigest.js',{noClaim:true});assert.deepEqual(await duplicate.exports.runOwnerActivityDigest(),{shops:1,sent:0,skipped:1});
  assert.deepEqual(duplicate.effects,[]);assert.deepEqual(duplicate.committed,[]);
});
test('digest service or individual transport policy refusal releases pending date',async()=>{
  for(const result of [{skipped:true,reason:'INTERNAL_TEST_SHOP'},{sent:0,results:[{reason:'SHOP_POLICY_UNAVAILABLE',suppressed:true}]}]){
    const f=fixture('jobs/ownerActivityDigest.js',{serviceResult:result});assert.deepEqual(await f.exports.runOwnerActivityDigest(),{shops:1,sent:0,skipped:1});
    assert.deepEqual(f.committed,[]);assert.ok(f.tx.some(c=>c.sql==='ROLLBACK'));
  }
});
test('digest does not consume a claim before configured time',async()=>{
  const f=fixture('jobs/ownerActivityDigest.js',{read:()=>[{id:shop,owner_activity_digest_time:'23:59'}]});
  assert.deepEqual(await f.exports.runOwnerActivityDigest(),{shops:1,sent:0,skipped:1});assert.deepEqual(f.tx,[]);assert.deepEqual(f.writes,[]);
});

test('digest ordinary provider exception retains the daily attempt; policy exceptions do not',async()=>{
  const ordinaryFailure=fixture('jobs/ownerActivityDigest.js',{serviceError:Error('Synthetic provider failure')});
  await ordinaryFailure.exports.runOwnerActivityDigest();assert.equal(ordinaryFailure.committed.length,1);
  assert.equal(ordinaryFailure.tx.some(c=>c.sql==='ROLLBACK'),false);
  const policyFailure=fixture('jobs/ownerActivityDigest.js',{serviceError:Object.assign(Error('policy'),{reason:'INTERNAL_TEST_SHOP'})});
  await policyFailure.exports.runOwnerActivityDigest();assert.deepEqual(policyFailure.committed,[]);
});
for(const method of ['closeEstimateImportSuccessNoise','assignOpenUnassignedFeedback'])test(`${method}: precommit unavailable policy rolls back and releases`,async()=>{
  const f=fixture('jobs/feedbackDailyAudit.js',{sequence:[ordinary,ordinary,new Error('policy query unavailable')]});
  assert.equal(await f.exports[method](shop),0);assert.deepEqual(f.committed,[]);assert.equal(f.tx.at(-1).sql,'RELEASE');
});
for(const value of [undefined,null,'',12,' shop '])test(`invalid authenticated tenant ${JSON.stringify(value)} cannot export`,async()=>{
  const f=fixture('routes/export.js');const res=await invoke(f,'get','/ro/:id',{user:{shop_id:value}});
  assert.equal(res.statusCode,503);assert.deepEqual(f.calls,[]);assert.deepEqual(f.policyCalls,[]);
});
test('cross-shop API retains filters and bound values with strict membership',async()=>{
  const f=fixture('routes/apiV1.js');await invoke(f,'get','/estimates',{query:{status:'APPROVED',ro_status:'CLOSED',limit:'9999',shop_id:other}});
  assert.match(f.calls[0].sql,/is_internal_test_shop IS FALSE/);assert.match(f.calls[0].sql,/LIMIT 200/);
  assert.deepEqual(f.calls[0].params,['approved','closed']);
});
for(const url of ['/estimates/:id','/jobs/:id/status'])test(`missing API resource ${url} does not take tenancy from caller`,async()=>{
  const f=fixture('routes/apiV1.js',{read:()=>null});const res=await invoke(f,'get',url);
  assert.equal(res.statusCode,404);assert.deepEqual(f.policyCalls,[]);assert.equal(f.calls.length,1);
});
test('linked superadmin fixture cannot use cross-shop feedback path',async()=>{
  const f=fixture('routes/feedback.js',{rows:variants.fixture});const res=await invoke(f,'get','/all',{user:{shop_id:shop,role:'superadmin'}});
  assert.equal(res.statusCode,409);assert.deepEqual(f.calls,[]);
});

test('actual API-key middleware rejects invalid key before persisted identity or business reads',async()=>{
  const f=fixture('routes/apiV1.js');const res=await invoke(f,'get','/estimates',{headers:{'x-api-key':'forged'}});
  assert.equal(res.statusCode,401);assert.equal(res.body.error.code,'API_KEY_INVALID');assert.deepEqual(f.calls,[]);assert.deepEqual(f.policyCalls,[]);
});
