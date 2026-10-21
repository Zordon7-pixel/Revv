'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../src');
const parent = '36cfb23a6ddce1ceb1dc40ed79423b9887032832';
const ordinary = [{ id: 'shop', is_internal_test_shop: false }];
const variants = {
  fixture: [{ id: 'shop', is_internal_test_shop: true }],
  missing: [], duplicate: [...ordinary, ...ordinary], mismatched: [{ id: 'other', is_internal_test_shop: false }],
  null: [{ id: 'shop', is_internal_test_shop: null }],
  string: [{ id: 'shop', is_internal_test_shop: 'false' }],
  omitted: [{ id: 'shop' }], numeric: [{ id: 'shop', is_internal_test_shop: 0 }],
  invalidResult: {}, failed: new Error('SYNTHETIC_PRIVATE_SQL_ERROR'),
};
const source = (file, baseline) => baseline
  ? execFileSync('git', ['show', `${parent}:backend/src/${file}`], { encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
function load(file, deps, { baseline = false, expose = '' } = {}) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,process,console){${source(file, baseline)}\n${expose}\n})`, { filename: file })(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    throw Error(`Forbidden dependency: ${name}`);
  }, module, module.exports, { env: { NODE_ENV: 'test', JWT_SECRET: 'synthetic-only' } }, { log() {}, error() {}, warn() {} });
  return module.exports;
}
function routerStub() {
  const routes = [], middleware = [];
  const router = { routes, middleware, use: (...handlers) => middleware.push(...handlers) };
  for (const method of ['get','post','put','patch','delete']) router[method] = (url, ...handlers) => routes.push({ method, url, handlers });
  return router;
}
function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; },
    setHeader(k,v) { this.headers[k] = v; }, send(body) { this.body = body; return this; } };
}
async function invoke(router, method, url, overrides = {}) {
  const req = { user: { id: 'user', shop_id: 'shop', role: 'owner', plan: 'agency', is_internal_test_shop: false, email: 'ordinary@example.invalid' },
    headers: { authorization: 'Bearer synthetic' }, query: { month: '2026-10' },
    params: { yearMonth: '2026-10', shopId: 'shop', tab: 'revenue', feedbackId: 'issue', userId: 'user' },
    body: { shop_id: 'ordinary-forged', is_internal_test_shop: false, plan: 'agency', role: 'superadmin', revenue_goal: 123.45, ro_goal: 5 }, ...overrides };
  const res = response();
  const route = router.routes.find(r => r.method === method && r.url === url);
  assert.ok(route, `${method} ${url}`);
  for (const fn of [...router.middleware, ...route.handlers]) {
    let next = false;
    await fn(req, res, err => { if (err) throw err; next = true; });
    if (!next) break;
  }
  return res;
}
function fixture(file, options = {}) {
  const calls = [], writes = [], effects = [], policyCalls = [];
  let policyIndex = 0;
  const getRows = () => {
    const rows = options.sequence ? options.sequence[Math.min(policyIndex++, options.sequence.length - 1)] : (options.rows ?? ordinary);
    if (rows instanceof Error) throw rows;
    return rows;
  };
  const db = {
    dbAll: async (sql, params) => {
      if (sql.includes('SELECT id::text AS id, is_internal_test_shop')) {
        policyCalls.push({sql, params}); return getRows();
      }
      calls.push({sql, params});
      if (options.read) return options.read(sql, params, true);
      if (/FROM time_entries/.test(sql)) return [{ user_id: 'tech', total_hours: '6.25' }];
      if (/FROM users/.test(sql)) return [{ id: 'tech', name: 'Synthetic Tech', role: 'staff' }];
      if (/FROM repair_orders ro/.test(sql) && !/job_status_log|COUNT\(/.test(sql)) return [{ id: 'ro', assigned_to: 'tech', ro_number: 'SYN-1', status: 'closed', total_cost: '123.45', total: '123.45', labor_cost: '100.10', parts_cost: '20.05', customer_name: 'Synthetic, "Customer"', vehicle: 'Test Car', billing_month: '2026-10', carried_over: false, created_at: '2026-10-01T00:00:00Z' }];
      return [];
    },
    dbGet: async (sql, params) => {
      calls.push({sql, params});
      if (/^(INSERT|UPDATE|DELETE)/.test(sql.trim())) writes.push({sql,params});
      if (options.read) return options.read(sql, params, false);
      if (options.noGoal && /FROM monthly_goals/.test(sql)) return null;
      return { id: 'goal', shop_id: 'shop', revenue_goal: '500.55', ro_goal: 7, monthly_revenue_target: '500.55',
        n: 3, r: '123.45', p: '20.05', count: 3, total: '123.45', avg: '41.15', avg_days: '2.5',
        c: 2, revenue_mtd: '123.45', true_profit_mtd: '20.05', ro_count: 3,
        total_supplement_opportunity: '12.34', amount_cents: 12345, this_week: 3, last_week: 2,
        supplement_ro_count: 3, requested_cents: 12345, captured_cents: 9876, pending_parts_count: 2,
        approved_cents: 12345, billed_cents: 15000, open_count: 2, open_amount_cents: 345,
        drp_count: 1, non_drp_count: 2, plan: options.plan || 'free' };
    },
    dbRun: async (sql,params) => { calls.push({sql,params}); writes.push({sql,params}); return { rowCount: 2 }; },
    pool: { query: async sql => { calls.push({sql}); return {rows:[]}; } },
  };
  const policy = load('services/shopPolicy.js', { '../db': db });
  const router = routerStub();
  const auth = (req,res,next) => req.user ? next() : res.status(401).json({error:'Unauthorized'});
  const roles = load('middleware/roles.js', {});
  const superadmin = load('middleware/superadmin.js', { jsonwebtoken: { verify: () => options.adminActor || { id:'support', role:'superadmin' } } });
  const deps = {
    express: {Router: () => router}, '../db': db, '../services/shopPolicy': policy, './shopPolicy': policy,
    '../middleware/auth': auth, '../middleware/roles': roles, '../middleware/superadmin': superadmin,
    '../services/panelEstimatorEconomics': {
      periodEconomics: async (...args) => { effects.push(args); return null; }, aggregateMetadata: () => ({}), redactROs: async rows => rows,
    },
    '../services/roMoney': { dollarsToCents: value => Math.round(Number(value || 0)*100) },
    uuid: {v4: () => 'synthetic-id'}, bcryptjs: { hash: async () => { effects.push('hash'); return 'synthetic-hash'; } },
    jsonwebtoken: {sign: () => { effects.push('token'); return 'synthetic-token'; }},
    fs: { readFileSync: () => '{"activity":[]}', writeFileSync: () => effects.push('activity') },
    '../db/seed': {runSeed: () => { effects.push('seed'); throw Error('SEED_PROHIBITED'); }},
  };
  const exports = load(file, deps, {baseline:options.baseline, expose:options.expose});
  return {router, exports, calls, writes, effects, policyCalls, policy};
}
const tenants = [
  ['reports','get','/summary'], ['reports','get','/monthly/:yearMonth'], ['reports','get','/monthly/:yearMonth/csv'],
  ['reports','get','/tech-workload'], ...['revenue','ros','performance','insurance','unknown'].map(tab => ['reports','get','/:tab',{params:{tab}}]),
  ...['/instruments','/supplements/monthly-opportunity','/owner-kpis','/weekly'].map(url => ['dashboard','get',url]),
  ['performance','get','/'], ['goals','get','/:yearMonth'], ['goals','put','/:yearMonth'],
  ['diagnostics','get','/'], ['diagnostics','post','/heal'],
];
for (const [name, method, url, req] of tenants) {
  for (const [variant, rows] of Object.entries(variants)) test(`${name} ${method} ${url} ${req?.params?.tab || ''}: ${variant} excludes before business work`, async () => {
    const f = fixture(`routes/${name}.js`, {rows});
    const res = await invoke(f.router,method,url,req);
    assert.equal(res.statusCode, variant === 'fixture' ? 409 : 503);
    assert.deepEqual(res.body,{error: variant === 'fixture' ? 'INTERNAL_TEST_SHOP' : 'SHOP_POLICY_UNAVAILABLE',excluded:true});
    assert.deepEqual(f.calls,[]); assert.deepEqual(f.writes,[]); assert.deepEqual(f.effects,[]); assert.deepEqual(res.headers,{});
    assert.deepEqual(f.policyCalls[0].params,['shop']);
  });
  test(`${name} ${method} ${url} ${req?.params?.tab || ''}: strict false preserves parent result`, async () => {
    const current = fixture(`routes/${name}.js`), before = fixture(`routes/${name}.js`,{baseline:true});
    const got = await invoke(current.router,method,url,req), expected = await invoke(before.router,method,url,req);
    assert.equal(got.statusCode,expected.statusCode); assert.deepEqual(got.body,expected.body); assert.deepEqual(got.headers,expected.headers);
    assert.ok(current.policyCalls.length > 0);
    // Tenant report calculations, filters, joins, pagination and parameter bindings are unchanged.
    if (!['diagnostics','goals'].includes(name)) assert.deepEqual(current.calls,before.calls);
  });
}
for (const [file,expose,args] of [
  ['goals','module.exports.direct = ensureGoalForMonth;',['shop','2026-10']],
  ['dashboard','module.exports.direct = getMonthlySupplementOpportunity;',['shop']],
]) for (const [variant,rows] of Object.entries(variants)) test(`direct ${file} helper: ${variant}`,async () => {
  const f=fixture(`routes/${file}.js`,{rows,expose});
  await assert.rejects(f.exports.direct(...args), {reason:variant==='fixture'?'INTERNAL_TEST_SHOP':'SHOP_POLICY_UNAVAILABLE'});
  assert.deepEqual(f.calls,[]); assert.deepEqual(f.writes,[]);
});
for (const name of ['goals','diagnostics']) test(`${name}: late policy denial stops next mutation`,async () => {
  const f=fixture(`routes/${name}.js`,{sequence:[ordinary,variants.fixture]});
  const res=await invoke(f.router,name==='goals'?'put':'post',name==='goals'?'/:yearMonth':'/heal');
  assert.equal(res.statusCode,409); assert.deepEqual(f.writes,[]); assert.deepEqual(f.effects,[]);
});
test('goal auto-create independently rechecks after reads; scoped ordinary update retains cents',async () => {
  const f=fixture('routes/goals.js',{sequence:[ordinary,ordinary,variants.failed],noGoal:true});
  assert.equal((await invoke(f.router,'get','/:yearMonth')).statusCode,503); assert.deepEqual(f.writes,[]);
  const normal=fixture('routes/goals.js'); await invoke(normal.router,'put','/:yearMonth');
  assert.match(normal.writes[0].sql,/WHERE id = \$3 AND shop_id = \$4/);
  assert.deepEqual(normal.writes[0].params,[123.45,5,'goal','shop']);
});
for (const [name, method, url] of tenants.filter(t => t[0] !== 'goals' || t[1] === 'put')) test(`${name} ${url}: existing authorization rejects customer before policy`,async () => {
  const f=fixture(`routes/${name}.js`);
  const res=await invoke(f.router,method,url,{user:{shop_id:'shop',role:'customer'}});
  assert.equal(res.statusCode,403); assert.deepEqual(f.calls,[]); assert.deepEqual(f.policyCalls,[]);
});
for (const [variant,rows] of Object.entries(variants)) for (const plan of ['free','pro','agency']) test(`RO guard ${variant} with ${plan} claims cannot count or grant admission`,async () => {
  const f=fixture('middleware/roLimitGuard.js',{rows,plan}); const res=response(); let admitted=0;
  await f.exports({user:{shop_id:'shop',role:'superadmin',plan,is_internal_test_shop:false},body:{shop_id:'ordinary',is_internal_test_shop:false}},res,()=>admitted++);
  assert.equal(res.statusCode,variant==='fixture'?409:503); assert.equal(admitted,0); assert.deepEqual(f.calls,[]);
});
for (const plan of ['free','pro','agency']) test(`RO guard ordinary ${plan} parity`,async () => {
  const f=fixture('middleware/roLimitGuard.js',{plan}); let admitted=0;
  await f.exports({user:{shop_id:'shop'}},response(),()=>admitted++);
  assert.equal(admitted,1); assert.equal(f.calls.length,plan==='free'?2:1);
  for(const c of f.calls) assert.deepEqual(c.params,['shop']);
});
test('RO free monthly cap and missing identity still reject; late policy stops next()',async () => {
  const f=fixture('middleware/roLimitGuard.js',{read:sql=>sql.includes('SELECT plan')?{plan:'free'}:{count:25}});
  const res=response(); await f.exports({user:{shop_id:'shop'}},res,()=>assert.fail('admitted'));
  assert.deepEqual(res.body,{error:'ro_limit_reached',count:25,limit:25});
  const missing=response();await f.exports({},missing,()=>assert.fail('admitted'));assert.equal(missing.statusCode,401);
  const late=fixture('middleware/roLimitGuard.js',{sequence:[ordinary,variants.fixture]});
  const stopped=response();await late.exports({user:{shop_id:'shop'}},stopped,()=>assert.fail('admitted'));assert.equal(stopped.statusCode,409);
});
const adminMetrics = ['/accounts','/helpdesk','/shops','/shops/:shopId','/stats','/ratings'];
for(const url of ['/accounts','/helpdesk','/shops/:shopId']) for(const [variant,rows] of Object.entries(variants)) test(`admin selected ${url}: ${variant} explicit exclusion before counts`,async()=>{
  const f=fixture('routes/superadmin.js',{rows});
  const res=await invoke(f.router,'get',url,{query:{shop_id:'shop',limit:26}});
  assert.equal(res.statusCode,variant==='fixture'?409:503);assert.equal(res.body.excluded,true);assert.deepEqual(f.calls,[]);
});
for(const url of adminMetrics) for(const [variant,rows] of Object.entries(variants)) test(`linked superadmin ${url}: ${variant} cannot bypass via signed claims`,async()=>{
  const f=fixture('routes/superadmin.js',{rows,adminActor:{id:'actor',shop_id:'shop',role:'superadmin',is_internal_test_shop:false,plan:'agency'}});
  const res=await invoke(f.router,'get',url);
  assert.equal(res.statusCode,variant==='fixture'?409:503);assert.equal(res.body.excluded,true);assert.deepEqual(f.calls,[]);
});
for(const url of adminMetrics) test(`admin ${url}: auth preserved`,async()=>{
  const f=fixture('routes/superadmin.js',{adminActor:{role:'owner',shop_id:'shop'}});
  assert.equal((await invoke(f.router,'get',url)).statusCode,403);assert.deepEqual(f.calls,[]);assert.deepEqual(f.policyCalls,[]);
  assert.equal((await invoke(f.router,'get',url,{headers:{}})).statusCode,401);
});
for(const url of adminMetrics) test(`admin ${url}: strict-false membership at every independent aggregate`,async()=>{
  const f=fixture('routes/superadmin.js');const res=await invoke(f.router,'get',url,{query:{shop_id:'shop',limit:26}});
  assert.equal(res.statusCode,200);
  for(const {sql} of f.calls) {
    assert.match(sql,/is_internal_test_shop IS FALSE/);
    assert.doesNotMatch(sql,/is_internal_test_shop\s*(?:!=|<>|IS NOT TRUE)|COALESCE\([^)]*is_internal_test_shop/);
    // Each independent child grouping must filter before aggregation, not just at its outer parent.
    for(const table of ['repair_orders','users','ro_ratings']) {
      if(new RegExp(`FROM ${table}\\s+WHERE[\\s\\S]*?GROUP BY shop_id`).test(sql) && /GROUP BY shop_id/.test(sql)) {
        assert.match(sql,new RegExp(`FROM ${table}\\s+WHERE EXISTS \\(SELECT 1 FROM shops policy_shop WHERE policy_shop.id = ${table}.shop_id AND policy_shop.is_internal_test_shop IS FALSE\\)\\s+GROUP BY shop_id`));
      }
    }
  }
  if(url==='/helpdesk') {
    assert.equal(f.calls.length,4);
    assert.match(f.calls[0].sql,/INNER JOIN shops s ON s.id = u.shop_id AND s.is_internal_test_shop IS FALSE/);
    assert.match(f.calls[0].sql,/FROM feedback f\s+WHERE EXISTS \(SELECT 1 FROM shops policy_shop WHERE policy_shop.id::text = f.shop_id AND policy_shop.is_internal_test_shop IS FALSE\)\s+GROUP BY f.shop_id/);
    assert.match(f.calls[1].sql,/INNER JOIN shops s ON s.id::text = f.shop_id AND s.is_internal_test_shop IS FALSE/);
    assert.match(f.calls[2].sql,/FROM feedback f\s+WHERE EXISTS/);
    assert.deepEqual(f.calls[1].params,['shop',26]);
  }
  if(url==='/stats') {
    assert.equal((f.calls[0].sql.match(/is_internal_test_shop IS FALSE/g)||[]).length,4);
    for(const table of ['users','repair_orders','customers']) assert.match(f.calls[0].sql,new RegExp(`policy_shop.id = ${table}.shop_id`));
  }
  if(['/shops','/ratings'].includes(url)) {
    assert.equal((f.calls[0].sql.match(/is_internal_test_shop IS FALSE/g)||[]).length,3);
    assert.match(f.calls[0].sql,/WHERE s.is_internal_test_shop IS FALSE\s+ORDER BY/);
  }
});
// SQL-contract adapter deliberately includes TRUE, NULL and orphan data. It models
// membership, not PostgreSQL parsing/execution; exact predicates above are separate gates.
test('admin stats synthetic mixed population includes only persisted-false shop membership',async()=>{
  const shops=[{id:'shop',flag:false},{id:'fixture',flag:true},{id:'unknown',flag:null}];
  const members=['shop','fixture','unknown','missing',null];
  const f=fixture('routes/superadmin.js',{read:sql=>{
    const strict=(sql.match(/is_internal_test_shop IS FALSE/g)||[]).length===4;
    const included=members.filter(id=>shops.some(s=>s.id===id&&s.flag===false)).length;
    return {total_shops:strict?1:shops.length,total_users:strict?included:members.length,total_ros:strict?included:members.length,total_customers:strict?included:members.length};
  }});
  assert.deepEqual((await invoke(f.router,'get','/stats')).body,{total_shops:1,total_users:1,total_ros:1,total_customers:1});
});
test('admin global and selected ordinary response shapes and pagination match parent',async()=>{
  for(const url of adminMetrics) {
    const current=fixture('routes/superadmin.js'),before=fixture('routes/superadmin.js',{baseline:true});
    const req={query:{shop_id:'shop',limit:1000,q:'Synthetic'}};
    const got=await invoke(current.router,'get',url,req),expected=await invoke(before.router,'get',url,req);
    assert.deepEqual(got.body,expected.body);assert.equal(got.statusCode,expected.statusCode);
    assert.deepEqual(current.calls.map(c=>c.params),before.calls.map(c=>c.params));
  }
});
test('diagnostics counts and repairs require ordinary membership; filtered absence never seeds',async()=>{
  const f=fixture('routes/diagnostics.js',{read:()=>({c:0})});
  const result=await invoke(f.router,'post','/heal');assert.equal(result.statusCode,200);
  assert.ok(result.body.actions.includes('Ordinary shop/user records missing; automatic seeding suppressed'));
  assert.ok(!f.effects.includes('seed'));
  for(const c of f.calls) assert.match(c.sql,/is_internal_test_shop IS FALSE/);
  assert.match(f.writes[0].sql,/UPDATE repair_orders[\s\S]*WHERE EXISTS \(SELECT 1 FROM shops policy_shop WHERE policy_shop.id = repair_orders.shop_id AND policy_shop.is_internal_test_shop IS FALSE\)/);
  const read=fixture('routes/diagnostics.js');await invoke(read.router,'get','/');
  for(const c of read.calls.filter(c=>/COUNT\(/.test(c.sql))) assert.match(c.sql,/is_internal_test_shop IS FALSE/);
});
function aiFixture({rows=ordinary,sequence,enabled=true,count,start=0,fail,savedCount}={}) {
  const statements=[],policyCalls=[],releases=[];let connections=0,index=0,pending=0,committed=0;
  const policyRows=()=>{ const result=sequence?sequence[Math.min(index++,sequence.length-1)]:rows; if(result instanceof Error) throw result;return result; };
  const client={release:d=>releases.push(d),query:async(sql,args)=>{
    statements.push(sql);
    if(fail?.test(sql)) throw Error('Synthetic DB failure');
    if(sql.includes('is_internal_test_shop')) { policyCalls.push(args);return {rows:policyRows()}; }
    if(sql.includes('estimate_ai_enabled')) return {rows:[{id:'shop',estimate_ai_enabled:enabled}]};
    if(sql.includes('clock_timestamp')) return {rows:[{now:new Date(600000)}]};
    if(sql.startsWith('SELECT window_started_at')) return {rows:count===undefined?[]:[{window_started_at:new Date(start),admission_count:count}]};
    if(/^(INSERT|UPDATE)/.test(sql)) {pending++;return {rowCount:1,rows:[{identity_type:'text',window_started_at:args[1],admission_count:savedCount??args[2]}]};}
    if(sql==='COMMIT'){committed+=pending;pending=0;}
    if(sql==='ROLLBACK')pending=0;
    return {rows:[]};
  }};
  const db={dbAll:async(sql,args)=>{policyCalls.push(args);return policyRows();},pool:{connect:async()=>{connections++;return client;}}};
  const policy=load('services/shopPolicy.js',{'../db':db});
  const service=load('services/estimateAiPolicy.js',{'../db':db,'./shopPolicy':policy});
  return {service,statements,policyCalls,releases,get connections(){return connections;},get committed(){return committed;}};
}
for(const [variant,rows] of Object.entries(variants)) test(`AI admission direct ${variant}: no connection, eligibility, counter, budget or provider`,async()=>{
  const f=aiFixture({rows});const result=await f.service.admitEstimateAi('shop',{is_internal_test_shop:false,plan:'agency',role:'superadmin'});
  assert.deepEqual(result,{status:variant==='fixture'?'excluded':'unavailable',reason:variant==='fixture'?'INTERNAL_TEST_SHOP':'SHOP_POLICY_UNAVAILABLE',excluded:true});
  assert.equal(f.connections,0);assert.deepEqual(f.statements,[]);assert.equal(f.committed,0);
});
for(const identity of [undefined,null,'',' ',' shop','shop ',{},12]) test(`AI invalid identity ${JSON.stringify(identity)} never defaults ordinary`,async()=>{
  const f=aiFixture();const result=await f.service.admitEstimateAi(identity);
  assert.equal(result.status,'unavailable');assert.equal(result.reason,'SHOP_POLICY_UNAVAILABLE');assert.equal(f.connections,0);assert.deepEqual(f.policyCalls,[]);
});
for(const [stage,sequence] of [['locked',[ordinary,variants.fixture]],['prewrite',[ordinary,ordinary,variants.failed]],['precommit',[ordinary,ordinary,ordinary,variants.fixture]]]) test(`AI ${stage} policy change rolls back without consumption`,async()=>{
  const f=aiFixture({sequence});const result=await f.service.admitEstimateAi('shop');
  assert.ok(['excluded','unavailable'].includes(result.status));assert.equal(f.committed,0);assert.equal(f.statements.at(-1),'ROLLBACK');
  if(stage!=='precommit')assert.ok(!f.statements.some(s=>/^(INSERT|UPDATE)/.test(s)));
  if(stage==='locked')assert.ok(!f.statements.some(s=>/estimate_ai_budgets|clock_timestamp/.test(s)));
  assert.deepEqual(f.releases,[false]);
});
for(const scenario of [
  {name:'initial admission',expected:'admitted'}, {name:'increment',count:3,start:500000,expected:'admitted'},
  {name:'expired full budget',count:15,expected:'admitted'}, {name:'full budget',count:15,start:500000,expected:'quota'},
  {name:'disabled',enabled:false,expected:'off'}, {name:'invalid enable',enabled:'true'},
  {name:'invalid count',count:'1'}, {name:'future window',count:1,start:700000},
  {name:'write failure',fail:/INSERT/}, {name:'commit failure',fail:/COMMIT/},
  {name:'bad saved count',savedCount:'1'}, {name:'rollback failure',fail:/INSERT|ROLLBACK/,discard:true},
]) test(`AI ordinary ${scenario.name} retains admission contract`,async()=>{
  const f=aiFixture(scenario);const result=await f.service.admitEstimateAi('shop');
  assert.deepEqual(result,{status:scenario.expected||'unavailable'});
  assert.deepEqual(f.releases,[scenario.discard||false]);
  assert.equal(f.committed,scenario.expected==='admitted'?1:0);
  assert.doesNotMatch(f.statements.join('\n'),/\b(?:CREATE|ALTER|DROP)\b/);
});
// Execute the real OCR budget wrapper with the actual policy service. No provider
// module is loaded: its getOpenAI boundary is an observable synthetic sentinel.
for(const [variant,rows] of Object.entries(variants)) test(`OCR actual budget wrapper ${variant}: provider factory and counter stay untouched`,async()=>{
  const f=aiFixture({rows});let providers=0;
  const text=source('routes/insuranceOcr.js');
  const begin=text.indexOf('function createEstimateBudget(');
  assert.ok(begin>=0);const end=text.indexOf('\n}',begin)+2;
  const budgetFactory=vm.runInThisContext(`(function(admitEstimateAi,getOpenAI,fallbackError,PDF_IMAGE_PAGE_LIMIT,PDF_TEXT_CHAR_LIMIT){${text.slice(begin,end)};return createEstimateBudget;})`)(
    f.service.admitEstimateAi,()=>{providers++;throw Error('PROVIDER_PROHIBITED');},reason=>Object.assign(Error(reason),{reason}),12,120000);
  const budget=budgetFactory('shop');
  await assert.rejects(budget.create({messages:[{content:'synthetic'}]}));
  assert.equal(providers,0);assert.equal(budget.calls,0);assert.equal(f.connections,0);assert.equal(f.committed,0);
});
for(const [name,method,url,req] of tenants.filter(t=>t[1]==='get'&&t[3]?.params?.tab!=='unknown')) test(`${name} ${url} ${req?.params?.tab||''}: final policy refusal suppresses prepared response`,async()=>{
  const normal=fixture(`routes/${name}.js`);await invoke(normal.router,method,url,req);
  assert.ok(normal.policyCalls.length>=2);
  const sequence=Array.from({length:normal.policyCalls.length-1},()=>ordinary).concat([variants.fixture]);
  const f=fixture(`routes/${name}.js`,{sequence});const res=await invoke(f.router,method,url,req);
  assert.equal(res.statusCode,409);assert.deepEqual(res.body,{error:'INTERNAL_TEST_SHOP',excluded:true});assert.deepEqual(res.headers,{});
});
for(const [name,method,url,req] of tenants) test(`${name} ${url} ${req?.params?.tab||''}: caller true flag cannot suppress ordinary stored false`,async()=>{
  const f=fixture(`routes/${name}.js`);
  const res=await invoke(f.router,method,url,{...req,user:{id:'user',shop_id:'shop',role:'owner',is_internal_test_shop:true,plan:'free',email:'synthetic+qa@example.invalid'}});
  assert.equal(res.statusCode,req?.params?.tab==='unknown'?400:200);
});
for(const identity of [undefined,null,'',' shop','shop ',12,{}]) test(`tenant malformed trusted ID ${JSON.stringify(identity)} refuses without SQL`,async()=>{
  const f=fixture('routes/reports.js');const res=await invoke(f.router,'get','/summary',{user:{shop_id:identity,role:'owner'}});
  assert.equal(res.statusCode,503);assert.deepEqual(f.calls,[]);assert.deepEqual(f.policyCalls,[]);
});
test('direct helpers ordinary behavior and goal creation reuse exact parent values',async()=>{
  for(const [file,expose,args] of [
    ['goals','module.exports.direct = ensureGoalForMonth;',['shop','2026-10']],
    ['dashboard','module.exports.direct = getMonthlySupplementOpportunity;',['shop']],
  ]) {
    const current=fixture(`routes/${file}.js`,{expose,noGoal:true}),before=fixture(`routes/${file}.js`,{expose,noGoal:true,baseline:true});
    assert.deepEqual(await current.exports.direct(...args),await before.exports.direct(...args));
    assert.deepEqual(current.calls,before.calls);
  }
});
test('RO ordinary active trial does not consume the free monthly count',async()=>{
  const f=fixture('middleware/roLimitGuard.js',{read:()=>({plan:'free',trial_ends_at:'2999-01-01'})});let next=0;
  await f.exports({user:{shop_id:'shop'}},response(),()=>next++);assert.equal(next,1);assert.equal(f.calls.length,1);
});
test('diagnostics failure remains a failed check, never healthy',async()=>{
  const f=fixture('routes/diagnostics.js',{read:sql=>{if(sql.includes('FROM repair_orders'))throw Error('synthetic read failure');return {c:2};}});
  const res=await invoke(f.router,'get','/');assert.equal(res.body.ok,false);assert.equal(res.body.canHeal,true);
  assert.equal(res.body.checks.find(c=>c.name==='RO Status Validity').ok,false);
});
for(const url of adminMetrics) test(`admin ${url}: aggregation failure never becomes ordinary zero`,async()=>{
  const f=fixture('routes/superadmin.js',{read:()=>{throw Error('synthetic aggregate failure');}});
  const res=await invoke(f.router,'get',url);
  assert.equal(res.statusCode,500);assert.deepEqual(Object.keys(res.body),['error']);
});
for(const [method,url] of [['patch','/feedback/:feedbackId'],['post','/users/:userId/set-password'],['delete','/users/:userId'],['post','/impersonate']]) for(const [variant,rows] of Object.entries(variants)) test(`linked admin ${method} ${url}: ${variant} cannot gain support effects`,async()=>{
  const f=fixture('routes/superadmin.js',{rows,adminActor:{id:'actor',shop_id:'shop',role:'superadmin',is_internal_test_shop:false}});
  const res=await invoke(f.router,method,url);
  assert.equal(res.statusCode,variant==='fixture'?409:503);assert.deepEqual(f.calls,[]);assert.deepEqual(f.effects,[]);assert.deepEqual(f.writes,[]);
});
test('dashboard legacy PostgreSQL timestamps and UUID/text join shapes remain intact under real policy',async()=>{
  const f=fixture('routes/dashboard.js');await invoke(f.router,'get','/owner-kpis');await invoke(f.router,'get','/weekly');
  const all=f.calls.map(c=>c.sql).join('\n');
  assert.match(all,/NULLIF\(l.created_at::text, ''\)::timestamptz/);
  assert.match(all,/COALESCE\(NULLIF\(ro.actual_delivery::text, ''\)::timestamptz, ro.updated_at\)/);
  assert.match(all,/JOIN users u ON u.id::text = ro.assigned_to::text/);
  assert.doesNotMatch(all,/l.changed_by::uuid|\bl.created_at\s*[<>]/);
});
