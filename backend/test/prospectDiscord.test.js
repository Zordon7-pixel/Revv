'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const root = path.resolve(__dirname, '../src');
const secret = 'synthetic-test-signing-key-never-deployed';
function load(file, mocks, fetch) {
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports,process,fetch){${fs.readFileSync(path.join(root,file),'utf8')}\n})`, {
    console: { log() {}, warn() {}, error() {} },
  })(name => { assert.ok(Object.hasOwn(mocks,name), `Unapproved dependency: ${name}`); return mocks[name]; },
    module,module.exports,{env:{JWT_SECRET:secret,DISCORD_WEBHOOK_URL:'https://discord.example.invalid/mock'}},fetch);
  return module.exports;
}
function harness(route, { flag = false, rows, revoked = false, fail = false } = {}) {
  const sends = [], queries = [], writes = [], handlers = [];
  const db = {
    dbGet: async sql => /revoked_tokens/.test(sql) && revoked ? { id:'revoked' } : null,
    dbAll: async (sql,params) => {
      queries.push({sql,params}); if(fail) throw Error('synthetic DB unavailable');
      return rows ?? [{user_id:'synthetic-user',is_internal_test_shop:flag}];
    },
  };
  const auth = load('middleware/auth.js', { jsonwebtoken:jwt,'../db':db });
  const discord = load('utils/discord.js', {
    '../db':db,'../middleware/auth':auth,
    '../services/shopPolicy':{resolveShopPolicy:()=>assert.fail('Prospects must use persisted membership, not client shop IDs')},
  },async(url,args)=>{sends.push({url,args});return {ok:true};});
  load(`routes/${route}.js`, {
    express:{Router:()=>({post:(_url,...fns)=>handlers.push(...fns)})},
    'express-rate-limit':()=>((_req,_res,next)=>next()),'../utils/discord':discord,
    '../db/postgres':{pool:{query:async(sql,params)=>{writes.push({sql,params});return {rows:[]};}}},
  });
  async function invoke({ token, body = {}, query = {}, user } = {}) {
    const req = {headers:token?{authorization:`Bearer ${token}`}:{},body:{name:'Synthetic',email:'synthetic@example.invalid',...body},query,user};
    const res = {statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    for(const fn of handlers){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
    return res;
  }
  return {sends,queries,writes,invoke};
}
const token = extra => jwt.sign({id:'synthetic-user',shop_id:'forged-shop',is_internal_test_shop:false,...extra},secret,{expiresIn:'1h'});
for(const route of ['leads','waitlist']) {
  test(`${route}: ordinary anonymous prospect sends one mocked Discord alert`,async()=>{
    const h=harness(route),res=await h.invoke();assert.equal(res.statusCode,200);assert.equal(h.sends.length,1);assert.equal(h.queries.length,0);
    const embed=JSON.parse(h.sends[0].args.body).embeds[0];assert.match(embed.title,route==='leads'?/New Lead/:/Waitlist/);
  });
  test(`${route}: ordinary authenticated prospect resolves persisted membership and sends`,async()=>{
    const h=harness(route);assert.equal((await h.invoke({token:token({is_internal_test_shop:true})})).statusCode,200);
    assert.equal(h.sends.length,1);assert.match(h.queries[0].sql,/JOIN shops s ON s.id = u.shop_id/);
    assert.deepEqual(Array.from(h.queries[0].params),['synthetic-user']);
  });
  test(`${route}: trusted internal fixture suppresses despite forged ordinary claims`,async()=>{
    const h=harness(route,{flag:true});assert.equal((await h.invoke({token:token(),body:{shop_id:'ordinary',is_test:false,is_internal_test_shop:false}})).statusCode,200);
    assert.equal(h.sends.length,0);assert.equal(h.queries.length,1);
  });
  test(`${route}: public flags, email, source and shop IDs cannot suppress alerts`,async()=>{
    const h=harness(route,{flag:true});const res=await h.invoke({body:{is_test:true,is_internal_test_shop:true,shop_id:'fixture',source:'internal-test',email:'test+fixture@example.invalid'},
      query:{is_test:'true',shop_id:'fixture'},user:{id:'synthetic-user',shop_id:'fixture',is_internal_test_shop:true}});
    assert.equal(res.statusCode,200);assert.equal(h.sends.length,1);assert.equal(h.queries.length,0);
  });
  for(const [name,badToken,revoked] of [
    ['invalid signature',jwt.sign({id:'synthetic-user'},'wrong-synthetic-key'),false],
    ['missing subject',token({id:undefined}),false],['revoked',token({jti:'synthetic-revoked'}),true],
    ['expired',jwt.sign({id:'synthetic-user',exp:1},secret),false],
  ]) test(`${route}: ${name} cannot establish trusted identity`,async()=>{
    const h=harness(route,{revoked});assert.equal((await h.invoke({token:badToken})).statusCode,401);assert.equal(h.sends.length,0);assert.equal(h.queries.length,0);
  });
  for(const [name,options] of [ ['missing',{rows:[]}],['malformed',{flag:null}],['wrong user',{rows:[{user_id:'other',is_internal_test_shop:false}]}],
    ['duplicate',{rows:[{user_id:'synthetic-user',is_internal_test_shop:false},{user_id:'synthetic-user',is_internal_test_shop:false}]}],['unavailable',{fail:true}] ]) {
    test(`${route}: ${name} persisted identity fails without a transport call`,async()=>{
      const h=harness(route,options);assert.equal((await h.invoke({token:token()})).statusCode,500);assert.equal(h.sends.length,0);
    });
  }
  test(`${route}: invalid ordinary input does not send`,async()=>{
    const h=harness(route);assert.equal((await h.invoke({body:{name:'',email:''}})).statusCode,400);assert.equal(h.sends.length,0);
  });
}
