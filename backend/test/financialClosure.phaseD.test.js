'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const roles = require('../src/middleware/roles');
const migration = require('../src/db/paymentReservations');

function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src', file), module = { exports: {} };
  const local = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports,__dirname){${fs.readFileSync(filename,'utf8')}\n})`, { filename })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['express','uuid','node:crypto','path'].includes(name)) return local(name);
    throw Error(`Unmocked dependency ${name}`);
  }, module, module.exports, path.dirname(filename));
  return module.exports;
}
function services(db) {
  const money = load('services/roMoney.js', { '../db': db });
  return { money, payments: load('services/paymentReservations.js', { '../db': db, './roMoney': money }) };
}
function routes(db, payments) {
  const next = (_req,_res,next) => next();
  const common = { '../db': db, '../services/paymentReservations': payments,
    '../middleware/auth': next, '../middleware/roles': roles };
  const multer = () => ({ single: () => next }); multer.diskStorage = () => ({});
  return {
    settings: load('routes/settings.js', common),
    market: load('routes/market.js', { ...common, fs: { mkdirSync() {} }, multer,
      '../data/market-rates': {}, '../services/sms': {}, '../services/mediaStorage': {} }),
  };
}
async function invoke(router, route, shop, section, role='owner') {
  const layer = router.stack.find(l => l.route?.path === route);
  const req = { user: { shop_id: shop, role }, params: { section } };
  const res = { statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } };
  const pending=[]; let i=0;
  const next=()=> { const result=layer.route.stack[i++]?.handle(req,res,next); if (result?.then) pending.push(result); };
  next(); await Promise.all(pending); return res;
}
for (const target of ['ros','all','customers','vehicles','timeclock','demo']) {
  for (const failure of ['history','late',null]) test(`bulk ${target}: ${failure || 'success'} uses one atomic transaction`, async () => {
    const queries=[]; let released=false;
    const client={ release() { released=true; }, query: async (sql,params) => {
      queries.push({sql,params});
      if (/SELECT id FROM repair_orders/.test(sql)) return { rows:[{id:'ro'}] };
      if (/revv_assert_ro_deletable/.test(sql) && failure==='history') throw Object.assign(Error('RO_HISTORY_PROTECTED'),{code:'23514'});
      if (/DELETE/.test(sql) && failure==='late') throw Error('Synthetic late failure');
      return { rows:[], rowCount:1 };
    } };
    const db={pool:{connect:async()=>client},dbRun:()=>assert.fail('reset escaped transaction')};
    const {payments}=services(db), r=routes(db,payments);
    const result=target==='demo'?await invoke(r.market,'/demo-data','shop'):await invoke(r.settings,'/reset/:section','shop',target);
    assert.equal(result.statusCode,failure==='history'?409:failure==='late'?500:200);
    assert.equal(released,true);
    assert.match(queries[0].sql,/BEGIN.*READ COMMITTED/);
    assert.match(queries[1].sql,/ORDER BY id FOR UPDATE/);
    assert.equal(queries.at(-1).sql,failure?'ROLLBACK':'COMMIT');
    assert.ok(queries.every(q=>!/DELETE FROM ro_payments|DELETE FROM ro_payment_attempts/.test(q.sql)));
    if(failure==='history') assert.equal(queries.some(q=>/DELETE|UPDATE users/.test(q.sql)),false);
    else assert.ok(queries.some(q=>/DELETE/.test(q.sql)));
    for(const q of queries.filter(q=>/DELETE/.test(q.sql))) assert.deepEqual(q.params,['shop']);
  });
}

const TEST_DATABASE='postgresql://revv_panel@127.0.0.1:55459/revv_panel_test';
test('real PostgreSQL Phase D financial mutation and bulk deletion closure', {timeout:60000}, async t => {
  assert.equal(process.env.PANEL_ESTIMATOR_TEST_DATABASE_URL,TEST_DATABASE,'Dedicated disposable database required');
  const {Pool}=require('pg');
  const config={host:'127.0.0.1',port:55459,user:'revv_panel',database:'revv_panel_test',
    password:async()=>'',ssl:false,connectionTimeoutMillis:2000,statement_timeout:7000};
  const admin=new Pool(config);
  try {
    for(const type of ['TEXT','UUID']) await t.test(type,async t=> {
      const schema=`financial_d_${randomUUID().replaceAll('-','')}`; let raw,created=false;
      try {
        await admin.query(`CREATE SCHEMA ${schema}`); created=true;
        raw=new Pool({...config,options:`-c search_path=${schema}`,application_name:schema,max:8});
        await raw.query(`CREATE TABLE shops(id ${type} PRIMARY KEY,tax_rate NUMERIC DEFAULT 0.1);
          CREATE TABLE repair_orders(id ${type} PRIMARY KEY,shop_id ${type},status TEXT DEFAULT 'estimate',
            total NUMERIC DEFAULT 100,estimate_amount NUMERIC DEFAULT 100,payment_status TEXT DEFAULT 'unpaid',
            payment_received INTEGER DEFAULT 0,paid_amount INTEGER,paid_at TEXT,payment_received_at TEXT,
            payment_method TEXT,stripe_payment_intent_id TEXT,updated_at TIMESTAMPTZ,
            estimate_status TEXT,estimate_approved_at TEXT,insurance_approved_amount NUMERIC);
          CREATE TABLE estimate_line_items(id TEXT PRIMARY KEY,shop_id TEXT,ro_id TEXT,type TEXT,
            quantity NUMERIC DEFAULT 1,unit_price NUMERIC DEFAULT 100,
            total NUMERIC GENERATED ALWAYS AS (quantity*unit_price) STORED,taxable BOOLEAN DEFAULT TRUE);
          CREATE TABLE estimate_metadata(id TEXT,shop_id TEXT,ro_id TEXT,adjuster_totals JSONB);
          CREATE TABLE ro_photos(id TEXT,ro_id TEXT);
          CREATE TABLE parts_orders(id TEXT,shop_id TEXT,ro_id TEXT);
          CREATE TABLE job_status_log(id TEXT,ro_id TEXT);
          CREATE TABLE parts_requests(id TEXT,ro_id TEXT);
          CREATE TABLE customers(id TEXT,shop_id TEXT);
          CREATE TABLE vehicles(id TEXT,shop_id TEXT);
          CREATE TABLE users(id TEXT,shop_id TEXT,role TEXT,customer_id TEXT);
          CREATE TABLE lunch_breaks(id TEXT,shop_id TEXT);
          CREATE TABLE time_entries(id TEXT,shop_id TEXT);
          CREATE TABLE schedules(id TEXT,shop_id TEXT);
          CREATE TABLE agreement_requests(id TEXT,shop_id TEXT,ro_id TEXT,status TEXT,customer_signature JSONB);
          CREATE TABLE claim_links(id TEXT,shop_id TEXT,ro_id TEXT);
          CREATE TABLE estimate_approval_links(id TEXT,shop_id TEXT,ro_id TEXT,responded_at TEXT,decline_reason TEXT)`);
        await migration.up(raw); await migration.up(raw);
        const sqlErrors=[];
        const observedPool={connect:async()=> {
          const c=await raw.connect();
          return {release:()=>c.release(),query:async(sql,args)=> {
            try {return await c.query(sql,args);} catch(error) {sqlErrors.push(error.message);throw error;}
          }};
        }};
        const db={pool:observedPool,dbRun:()=>assert.fail('reset escaped client')};
        const {payments,money}=services(db), r=routes(db,payments);
        const fixture=async()=> {
          const shop=randomUUID(),ro=randomUUID(),line=randomUUID();
          await raw.query('INSERT INTO shops(id) VALUES ($1)',[shop]);
          await raw.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)',[ro,shop]);
          await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type) VALUES ($1,$2,$3,'labor')",[line,shop,ro]);
          await raw.query('INSERT INTO estimate_metadata VALUES ($1,$2,$3,$4)',[randomUUID(),shop,ro,{total:100}]);
          for(const table of ['ro_photos','job_status_log','parts_requests']) await raw.query(`INSERT INTO ${table} VALUES ($1,$2)`,[randomUUID(),ro]);
          await raw.query('INSERT INTO parts_orders VALUES ($1,$2,$3)',[randomUUID(),shop,ro]);
          for(const table of ['customers','vehicles','time_entries','schedules','lunch_breaks']) await raw.query(`INSERT INTO ${table} VALUES ($1,$2)`,[randomUUID(),shop]);
          await raw.query("INSERT INTO users VALUES ($1,$2,'customer',NULL)",[randomUUID(),shop]);
          return {shop,ro,line};
        };
        const reserve=f=>payments.reservePayment({roId:f.ro,shopId:f.shop,kind:'intent'});
        const mutations={
          price: f=>['UPDATE estimate_line_items SET unit_price=50 WHERE id=$1 AND shop_id=$2',[f.line,f.shop]],
          remove: f=>['DELETE FROM estimate_line_items WHERE id=$1 AND shop_id=$2',[f.line,f.shop]],
          taxable: f=>['UPDATE estimate_line_items SET taxable=FALSE WHERE id=$1 AND shop_id=$2',[f.line,f.shop]],
          authority: f=>['UPDATE repair_orders SET total=50,estimate_amount=50 WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]],
          metadata: f=>["UPDATE estimate_metadata SET adjuster_totals='{\"total\":50}' WHERE ro_id=$1 AND shop_id=$2",[f.ro,f.shop]],
          tax: f=>['UPDATE shops SET tax_rate=0 WHERE id=$1',[f.shop]],
        };
        const snapshot=async f=> {
          const result={};
          for(const table of ['repair_orders','estimate_line_items','estimate_metadata','ro_photos','parts_orders',
            'job_status_log','parts_requests','customers','vehicles','users','lunch_breaks','time_entries','schedules',
            'ro_payments','ro_payment_attempts','agreement_requests','claim_links','estimate_approval_links']) {
            const column=['ro_photos','job_status_log','parts_requests'].includes(table)?'ro_id': 'shop_id';
            result[table]=(await raw.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column}::text=$1 ORDER BY to_jsonb(t)::text`,[column==='ro_id'?f.ro:f.shop])).rows;
          }
          return result;
        };
        // Observe a real PostgreSQL lock wait before releasing the first writer.
        const blockedBy=async pid=> {
          const end=Date.now()+3000;
          while(Date.now()<end) {
            const hit=await raw.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2::int=ANY(pg_blocking_pids(pid))',[schema,pid]);
            if(hit.rowCount) return;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          assert.fail('Competitor did not wait on the held transaction');
        };
        for(const [name,statement] of Object.entries(mutations)) for(const paymentFirst of [false,true]) {
          await t.test(`reserve vs ${name}, payment first=${paymentFirst}`,async()=> {
            const f=await fixture(), c=await raw.connect(); let second,results;
            try {
              await c.query('BEGIN');
              const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
              if(paymentFirst) {
                // Run the actual reservation helper but retain its COMMIT until the
                // competitor is visibly blocked. BEGIN/COMMIT belong to this fixture.
                const adapter={pool:{connect:async()=>({query:(sql,args)=> /^(BEGIN|COMMIT)/.test(sql)?Promise.resolve({rows:[]}):c.query(sql,args),release(){}})}};
                const a=await services(adapter).payments.reservePayment({roId:f.ro,shopId:f.shop,kind:'intent'});
                assert.equal(a.amountCents,11000);
                second=raw.query(...statement(f));
              } else {
                await c.query(...statement(f));
                second=reserve(f);
              }
              results=Promise.allSettled([second]);
              await blockedBy(pid); await c.query('COMMIT');
              const [outcome]=await results;
              if(paymentFirst) {assert.equal(outcome.status,'rejected');assert.match(outcome.reason.message,/RO_FINANCIAL_HOLD/);}
              else if(name==='remove') {assert.equal(outcome.status,'rejected');assert.equal(outcome.reason.status,400);}
              else {assert.equal(outcome.status,'fulfilled');assert.equal(outcome.value.amountCents,(await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents);}
              const total=(await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents;
              const held=Number((await raw.query('SELECT COALESCE(SUM(amount_cents),0) AS n FROM ro_payment_attempts WHERE ro_id=$1',[f.ro])).rows[0].n);
              assert.ok(held<=total);
            } finally {await c.query('ROLLBACK');c.release();if(results)await results;}
          });
        }
        for(const fact of ['manual','paid','failed','zero','reserved','open','retryable','unknown','settled']) await t.test(`hold preserves ${fact} evidence and operational edits`,async()=> {
          const f=await fixture();
          if(fact==='manual') await raw.query('UPDATE repair_orders SET amount_paid_cents=3000 WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]);
          else if(['paid','failed','zero'].includes(fact)) await raw.query('INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),f.shop,f.ro,fact==='zero'?0:3000,fact==='failed'?'failed':'succeeded']);
          else await raw.query('INSERT INTO ro_payment_attempts(id,shop_id,ro_id,idempotency_key,amount_cents,kind,status) VALUES ($1,$2,$3,$4,3000,\'intent\',$5)',[randomUUID(),f.shop,f.ro,randomUUID(),fact]);
          const before=await snapshot(f);
          for(const statement of Object.values(mutations)) await assert.rejects(raw.query(...statement(f)),/RO_FINANCIAL_HOLD/);
          await assert.rejects(raw.query('DELETE FROM repair_orders WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]),/RO_HISTORY_PROTECTED/);
          if(fact!=='manual') {
            const table=['paid','failed','zero'].includes(fact)?'ro_payments':'ro_payment_attempts';
            await assert.rejects(raw.query(`DELETE FROM ${table} WHERE ro_id=$1 AND shop_id=$2`,[f.ro,f.shop]),/RO_HISTORY_PROTECTED/);
          }
          assert.deepEqual(await snapshot(f),before);
          await raw.query("UPDATE repair_orders SET status='repair' WHERE id=$1 AND shop_id=$2",[f.ro,f.shop]);
        });
        await t.test('success bookkeeping works after reservation and ledger triggers, including manual floor',async()=> {
          const f=await fixture();
          await raw.query('UPDATE repair_orders SET amount_paid_cents=3000 WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]);
          const a=await reserve(f);assert.equal(a.amountCents,8000);
          const event={type:'payment_intent.succeeded',data:{object:{id:`pi_${randomUUID()}`,metadata:payments.metadataFor(a),amount_received:8000,currency:'usd'}}};
          await payments.settlePaymentEvent(event);await payments.settlePaymentEvent(event);
          assert.equal((await raw.query('SELECT amount_paid_cents FROM repair_orders WHERE id=$1',[f.ro])).rows[0].amount_paid_cents,11000);
          assert.equal((await raw.query('SELECT status FROM ro_payment_attempts WHERE id=$1',[a.id])).rows[0].status,'settled');
          await assert.rejects(raw.query('UPDATE repair_orders SET amount_paid_cents=0 WHERE id=$1',[f.ro]),/RO_FINANCIAL_HOLD/);
        });
        for(const target of ['ros','all','demo']) for(const fact of ['reserved','paid','approved','signed','claim','link']) await t.test(`bulk ${target} refuses ${fact} atomically`,async()=> {
          const f=await fixture();
          if(fact==='reserved') await reserve(f);
          if(fact==='paid') await raw.query("UPDATE repair_orders SET payment_status='paid' WHERE id=$1",[f.ro]);
          if(fact==='approved') await raw.query("UPDATE repair_orders SET estimate_approved_at='2026-01-01' WHERE id=$1",[f.ro]);
          if(fact==='signed') await raw.query("INSERT INTO agreement_requests VALUES ($1,$2,$3,'voided',$4)",[randomUUID(),f.shop,f.ro,{signed_at:'2026-01-01'}]);
          if(fact==='claim') await raw.query('INSERT INTO claim_links VALUES ($1,$2,$3)',[randomUUID(),f.shop,f.ro]);
          if(fact==='link') await raw.query("INSERT INTO estimate_approval_links VALUES ($1,$2,$3,'2026-01-01',NULL)",[randomUUID(),f.shop,f.ro]);
          const before=await snapshot(f);
          const result=target==='demo'?await invoke(r.market,'/demo-data',f.shop):await invoke(r.settings,'/reset/:section',f.shop,target);
          assert.equal(result.statusCode,409,JSON.stringify(result.body));assert.deepEqual(await snapshot(f),before);
        });
        for(const target of ['all','demo']) await t.test(`bulk ${target} late failure restores children; ordinary deletion succeeds`,async()=> {
          const f=await fixture(),before=await snapshot(f);
          await raw.query(`CREATE FUNCTION reject_bulk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            IF EXISTS (SELECT 1 FROM parts_orders WHERE ro_id=OLD.id::text) THEN RAISE EXCEPTION 'CHILD_NOT_DELETED'; END IF;
            RAISE EXCEPTION 'LATE_BULK'; END $$;
            CREATE TRIGGER z_reject_bulk BEFORE DELETE ON repair_orders FOR EACH ROW EXECUTE FUNCTION reject_bulk()`);
          const call=()=>target==='demo'?invoke(r.market,'/demo-data',f.shop):invoke(r.settings,'/reset/:section',f.shop,target);
          try {assert.equal((await call()).statusCode,500);assert.equal(sqlErrors.at(-1),'LATE_BULK');assert.deepEqual(await snapshot(f),before);}
          finally {await raw.query('DROP TRIGGER z_reject_bulk ON repair_orders');await raw.query('DROP FUNCTION reject_bulk()');}
          assert.equal((await call()).statusCode,200);
          assert.equal((await raw.query('SELECT 1 FROM repair_orders WHERE id=$1',[f.ro])).rowCount,0);
        });
        for(const deleteFirst of [false,true]) await t.test(`bulk deletion vs direct financial evidence, delete first=${deleteFirst}`,async()=> {
          const f=await fixture(),c=await raw.connect();let results;
          try {
            await c.query('BEGIN');const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            const insert=client=>client.query("INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,0,'succeeded')",[randomUUID(),f.shop,f.ro]);
            if(deleteFirst) {
              const adapter={pool:{connect:async()=>({query:(sql,args)=> /^(BEGIN|COMMIT)/.test(sql)?Promise.resolve({rows:[]}):c.query(sql,args),release(){}})}};
              const heldRoutes=routes(adapter,services(adapter).payments);
              assert.equal((await invoke(heldRoutes.settings,'/reset/:section',f.shop,'all')).statusCode,200);
              results=Promise.allSettled([insert(raw)]);
            } else {
              await insert(c);results=Promise.allSettled([invoke(r.settings,'/reset/:section',f.shop,'all')]);
            }
            await blockedBy(pid);await c.query('COMMIT');
            const [outcome]=await results;
            if(deleteFirst){assert.equal(outcome.status,'rejected');assert.match(outcome.reason.message,/RO_NOT_FOUND/);}
            else {assert.equal(outcome.value.statusCode,409);assert.equal((await raw.query('SELECT 1 FROM ro_photos WHERE ro_id=$1',[f.ro])).rowCount,1);}
          } finally {await c.query('ROLLBACK');c.release();if(results)await results;}
        });
      } finally {if(raw)await raw.end();if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}
    });
  } finally {await admin.end();}
});
