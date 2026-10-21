'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const express = require('express');
const { Readable, Writable } = require('node:stream');
const root = path.resolve(__dirname, '../src');
const secret = 'synthetic-test-signing-key-never-deployed';
const privateError = 'synthetic@example.invalid Bearer PRIVATE_TOKEN private SQL and stack';
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(route, options = {}) {
  const { flag = false, rows, revoked = false, fail = false, transport, insertFail = false,
    revokeAll = false, authStoreFail = false, policyPending } = options;
  const sends = [], queries = [], writes = [], handlers = [], logs = [], saved = new Map(), timers = new Set();
  function load(file, mocks, fetch) {
    const module = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports,process,fetch){${fs.readFileSync(path.join(root,file),'utf8')}\n})`, {
      console: Object.fromEntries(['log','warn','error'].map(key => [key, (...args) => logs.push(args)])),
      AbortController,
      setTimeout(callback, ms) { assert.equal(ms, 5000); const timer = { callback, unref() {} }; timers.add(timer); return timer; },
      clearTimeout(timer) { timers.delete(timer); },
    })(name => { assert.ok(Object.hasOwn(mocks,name), `Unapproved dependency: ${name}`); return mocks[name]; },
      module,module.exports,{env:{JWT_SECRET:secret,DISCORD_WEBHOOK_URL:'https://discord.example.invalid/mock'}},fetch);
    return module.exports;
  }
  const db = {
    dbGet: async sql => {
      if (authStoreFail) throw Error(privateError);
      if (/revoked_tokens/.test(sql)) return revoked ? { id:'revoked' } : null;
      return revokeAll ? { revoke_all_before: '2099-01-01' } : null;
    },
    dbAll: async (sql,params) => {
      queries.push({sql,params});
      if (policyPending) await policyPending.promise;
      if (fail) throw Error(privateError);
      return rows ?? [{user_id:'synthetic-user',is_internal_test_shop:flag}];
    },
  };
  const auth = load('middleware/auth.js', { jsonwebtoken:jwt,'../db':db });
  const discord = load('utils/discord.js', {
    '../db':db,'../middleware/auth':auth,
    '../services/shopPolicy':{resolveShopPolicy:()=>assert.fail('Prospects must use persisted membership, not client shop IDs')},
  },(url,args)=>{sends.push({url,args});return transport ? transport(args) : Promise.resolve({ok:true});});
  load(`routes/${route}.js`, {
    express:{Router:()=>({post:(_url,...fns)=>handlers.push(...fns)})},
    'express-rate-limit':()=>((_req,_res,next)=>next()),'../utils/discord':discord,
    '../db/postgres':{pool:{query:async(sql,params)=>{
      writes.push({sql,params});
      if (/INSERT/.test(sql)) {
        if (insertFail) throw Error(privateError);
        if (!saved.has(params[0])) saved.set(params[0], params[1]);
      } else assert.match(sql, /CREATE TABLE IF NOT EXISTS waitlist/, 'no rollback or unexpected write');
      return {rows:[]};
    }}},
  });
  const response = () => ({statusCode:200,jsonCalls:0,status(code){this.statusCode=code;return this;},
    json(value){assert.equal(++this.jsonCalls,1,'single response');this.body=value;return this;}});
  async function invoke({ token, authorization, body = {}, query = {}, user } = {}) {
    const req = {headers:{authorization: authorization ?? (token ? `Bearer ${token}` : undefined)},
      body:{name:'Synthetic',email:'synthetic@example.invalid',...body},query,user};
    const res = response();
    for(const fn of handlers){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
    return res;
  }
  async function protectedRequest(authorization) {
    const req = {headers:{authorization}}, res = response();
    let admitted = false;
    await auth(req,res,()=>{admitted=true;res.json({ok:true});});
    return {res,admitted,user:req.user};
  }
  return {sends,queries,writes,logs,saved,timers,invoke,protectedRequest,handlers,auth,
    expire() { for (const timer of [...timers]) timer.callback(); }};
}

// Real Express HTTP serialization without opening any socket. DB and Discord
// remain the closed mocks above; the process also runs with networking denied.
function inject(app, { method = 'POST', url, authorization, body = {} }) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = Readable.from([data]);
    Object.assign(req, { method, url, headers: { 'content-type':'application/json',
      'content-length':String(data.length), ...(authorization ? {authorization} : {}) } });
    req.socket = req.connection = { remoteAddress:'127.0.0.1' };
    const chunks = [], headers = {};
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.statusCode = 200;
    res.setHeader = (key, value) => { headers[key.toLowerCase()] = value; };
    res.getHeader = key => headers[key.toLowerCase()];
    res.removeHeader = key => { delete headers[key.toLowerCase()]; };
    res.end = chunk => {
      if (chunk) chunks.push(Buffer.from(chunk));
      Writable.prototype.end.call(res);
    };
    res.on('error', reject);
    res.on('finish', () => resolve({ status:res.statusCode, body:JSON.parse(Buffer.concat(chunks).toString()) }));
    app.handle(req, res, reject);
  });
}

for (const route of ['leads','waitlist']) test(`${route}: Express finishes public HTTP before delivery and enforces protected auth`,async()=>{
  const pending=deferred(),h=harness(route,{transport:()=>pending.promise});
  const app=express();app.use(express.json());
  app.post(`/api/${route}`,...h.handlers);
  app.get('/protected',h.auth,(req,res)=>res.json({id:req.user.id}));
  const res=await inject(app,{url:`/api/${route}`,authorization:'Bearer malformed',body:{name:'Synthetic',email:'synthetic@example.invalid'}});
  assert.equal(res.status,200);assert.deepEqual(res.body,route==='leads'?{success:true}:{ok:true});
  assert.equal(h.sends.length,1);assert.equal(h.timers.size,1,'webhook still pending after HTTP finish');
  for (const [name,authorization] of invalidCredentials.filter(([, ,options])=>!options.revoked&&!options.revokeAll)) {
    const denied=await inject(app,{method:'GET',url:'/protected',authorization});
    assert.equal(denied.status,401,name);
  }
  const admitted=await inject(app,{method:'GET',url:'/protected',authorization:`Bearer ${token()}`});
  assert.equal(admitted.status,200);assert.equal(admitted.body.id,'synthetic-user');
  pending.resolve({ok:true});await flush();assert.equal(h.sends.length,1);assert.equal(h.timers.size,0);
});
const token = extra => jwt.sign({id:'synthetic-user',shop_id:'forged-shop',is_internal_test_shop:false,...extra},secret,{expiresIn:'1h'});
const invalidCredentials = [
  ['absent', undefined, {}],
  ['invalid signature', `Bearer ${jwt.sign({id:'synthetic-user'},'wrong-synthetic-key')}`, {}],
  ['revoked', `Bearer ${token({jti:'synthetic-revoked'})}`, {revoked:true}],
  ['revoked-all', `Bearer ${token()}`, {revokeAll:true}],
  ['expired', `Bearer ${jwt.sign({id:'synthetic-user',exp:1},secret)}`, {}],
  ['malformed JWT', 'Bearer not.a.jwt', {}],
  ['empty bearer', 'Bearer ', {}],
  ['wrong scheme', 'Basic synthetic', {}],
  ['no separator', 'Bearersynthetic', {}],
  ['extra words', `Bearer ${token()} extra`, {}],
];
function success(route, res) {
  assert.equal(res.statusCode,200);
  assert.equal(JSON.stringify(res.body),JSON.stringify(route==='leads'?{success:true}:{ok:true}));
  assert.equal(res.jsonCalls,1);
}
function sanitized(h) {
  assert.ok(h.logs.length, 'failure is logged');
  for (const log of h.logs) {
    assert.equal(log.length,1);
    assert.match(log[0], /^\[(Discord|waitlist)\] (Prospect policy unavailable; alert suppressed|Webhook failed or timed out|Webhook rejected|Submission failed)$/);
  }
}
for(const route of ['leads','waitlist']) {
  for (const [name,authorization,options] of invalidCredentials) {
    test(`${route}: ${name} optional credentials are anonymous with an ordinary alert`,async()=>{
      const h=harness(route,options),res=await h.invoke({authorization});
      success(route,res); await flush(); assert.equal(h.sends.length,1);assert.equal(h.queries.length,0);
      assert.equal(h.timers.size,0);
      const embed=JSON.parse(h.sends[0].args.body).embeds[0];assert.match(embed.title,route==='leads'?/New Lead/:/Waitlist/);
      if(route==='waitlist') assert.equal(h.saved.size,1);
    });
  }
  test(`${route}: signed token without subject cannot establish trusted identity`,async()=>{
    const h=harness(route); success(route,await h.invoke({token:token({id:undefined})}));
    await flush();assert.equal(h.sends.length,1);assert.equal(h.queries.length,0);
  });
  test(`${route}: valid ordinary identity resolves current membership despite spoofed fixture metadata`,async()=>{
    const h=harness(route);success(route,await h.invoke({token:token({is_internal_test_shop:true}),
      body:{is_test:true,is_internal_test_shop:true,shop_id:'fixture',source:'internal-test'},query:{shop_id:'fixture',is_test:'true'}}));
    await flush(); assert.equal(h.sends.length,1);assert.match(h.queries[0].sql,/JOIN shops s ON s.id = u.shop_id/);
    assert.deepEqual(Array.from(h.queries[0].params),['synthetic-user']);
  });
  test(`${route}: trusted internal fixture has zero transport despite forged ordinary claims`,async()=>{
    const h=harness(route,{flag:true});success(route,await h.invoke({token:token(),body:{shop_id:'ordinary',is_test:false,is_internal_test_shop:false}}));
    await flush();assert.equal(h.sends.length,0);assert.equal(h.queries.length,1);assert.equal(h.timers.size,0);
  });
  test(`${route}: public flags, email, source and shop IDs cannot suppress alerts`,async()=>{
    const h=harness(route,{flag:true});const res=await h.invoke({body:{is_test:true,is_internal_test_shop:true,shop_id:'fixture',source:'internal-test',email:'test+fixture@example.invalid'},
      query:{is_test:'true',shop_id:'fixture'},user:{id:'synthetic-user',shop_id:'fixture',is_internal_test_shop:true}});
    success(route,res);await flush();assert.equal(h.sends.length,1);assert.equal(h.queries.length,0);
  });
  for(const [name,options] of [ ['missing',{rows:[]}],['malformed',{flag:null}],['wrong user',{rows:[{user_id:'other',is_internal_test_shop:false}]}],
    ['duplicate',{rows:[{user_id:'synthetic-user',is_internal_test_shop:false},{user_id:'synthetic-user',is_internal_test_shop:false}]}],['unavailable',{fail:true}],
    ['verification store unavailable',{authStoreFail:true}] ]) {
    test(`${route}: ${name} stored identity preserves success without unsafe transport`,async()=>{
      const h=harness(route,options);success(route,await h.invoke({token:token()}));await flush();
      assert.equal(h.sends.length,0);sanitized(h);
      if(route==='waitlist') {assert.equal(h.saved.size,1);assert.equal(h.writes.filter(w=>/INSERT/.test(w.sql)).length,1);}
    });
  }
  test(`${route}: HTTP response completes while Discord is still pending`,async()=>{
    const pending=deferred(),h=harness(route,{transport:()=>pending.promise});
    const res=await h.invoke();success(route,res);assert.equal(h.sends.length,1);assert.equal(h.timers.size,1);
    pending.resolve({ok:true});await flush();success(route,res);assert.equal(h.sends.length,1);assert.equal(h.timers.size,0);
  });
  for (const mode of ['reject','throw','http rejection','timeout with late rejection','timeout with late success']) {
    test(`${route}: ${mode} is contained with one send and one successful response`,async()=>{
      const pending=deferred();
      const h=harness(route,{transport:()=>{
        if(mode==='throw') throw Error(privateError);
        if(mode==='http rejection') return Promise.resolve({ok:false,status:429});
        return pending.promise;
      }});
      const res=await h.invoke();success(route,res);
      if(mode==='reject') pending.reject(Error(privateError));
      if(mode.startsWith('timeout')) {
        h.expire();await flush();assert.equal(h.sends[0].args.signal.aborted,true);assert.equal(h.timers.size,0);
        if(mode.endsWith('rejection')) pending.reject(Error(privateError));else pending.resolve({ok:true});
      }
      await flush();success(route,res);assert.equal(h.sends.length,1);assert.equal(h.timers.size,0);sanitized(h);
      assert.equal(h.logs.length,1,'late settlement does not log or send again');
    });
  }
  test(`${route}: pending policy rejection occurs after success and never sends`,async()=>{
    const pending=deferred(),h=harness(route,{policyPending:pending});
    const res=await h.invoke({token:token()});success(route,res);assert.equal(h.sends.length,0);
    if(route==='waitlist') assert.equal(h.saved.size,1);
    pending.reject(Error(privateError));await flush();success(route,res);sanitized(h);assert.equal(h.sends.length,0);
    if(route==='waitlist') {assert.equal(h.saved.size,1);assert.equal(h.writes.filter(w=>/INSERT/.test(w.sql)).length,1);}
  });
  test(`${route}: invalid ordinary input does not send`,async()=>{
    const h=harness(route);assert.equal((await h.invoke({body:{name:'',email:''}})).statusCode,400);await flush();assert.equal(h.sends.length,0);
  });
}
test('waitlist: actual insert failure returns 500, saves nothing, and starts no policy lookup or alert',async()=>{
  const h=harness('waitlist',{insertFail:true}),res=await h.invoke({token:token()});
  assert.equal(res.statusCode,500);await flush();assert.equal(h.saved.size,0);assert.equal(h.queries.length,0);assert.equal(h.sends.length,0);
  assert.equal(h.writes.filter(w=>/INSERT/.test(w.sql)).length,1);sanitized(h);
});
for (const [name,authorization,options] of invalidCredentials) {
  test(`protected auth: ${name} still rejects with 401`,async()=>{
    const h=harness('leads',options),{res,admitted}=await h.protectedRequest(authorization);
    assert.equal(res.statusCode,401);assert.equal(admitted,false);assert.equal(h.sends.length,0);
  });
}
test('protected auth: valid identity remains intact',async()=>{
  const h=harness('leads'),{res,admitted,user}=await h.protectedRequest(`Bearer ${token()}`);
  assert.equal(res.statusCode,200);assert.equal(admitted,true);assert.equal(user.id,'synthetic-user');assert.equal(user.shop_id,'forged-shop');
});
test('protected auth: verification storage failure still rejects',async()=>{
  const h=harness('leads',{authStoreFail:true}),{res,admitted}=await h.protectedRequest(`Bearer ${token()}`);
  assert.equal(res.statusCode,401);assert.equal(admitted,false);
});
