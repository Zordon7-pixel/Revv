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
    if (['express','uuid','node:crypto','path','../db/shopTwilioNumber'].includes(name)) return local(name);
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
            tax NUMERIC DEFAULT 10,total NUMERIC DEFAULT 100,estimate_amount NUMERIC DEFAULT 100,payment_status TEXT DEFAULT 'unpaid',
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
          increase: f=>['UPDATE estimate_line_items SET unit_price=120 WHERE id=$1 AND shop_id=$2',[f.line,f.shop]],
          taxIncrease: f=>['UPDATE shops SET tax_rate=0.2 WHERE id=$1',[f.shop]],
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
              if(paymentFirst && !['authority','metadata','increase','taxIncrease'].includes(name)) {assert.equal(outcome.status,'rejected');assert.match(outcome.reason.message,/RO_FINANCIAL_HOLD/);}
              else if(paymentFirst) { assert.equal(outcome.status,'fulfilled'); assert.equal((await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents,name==='increase'?13200:name==='taxIncrease'?12000:11000); }
              else if(name==='remove') {assert.equal(outcome.status,'rejected');assert.equal(outcome.reason.status,400);}
              else {assert.equal(outcome.status,'fulfilled');assert.equal(outcome.value.amountCents,(await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents);}
              const total=(await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents;
              const held=Number((await raw.query('SELECT COALESCE(SUM(amount_cents),0) AS n FROM ro_payment_attempts WHERE ro_id=$1',[f.ro])).rows[0].n);
              assert.ok(held<=total);
            } finally {await c.query('ROLLBACK');c.release();if(results)await results;}
          });
        }
        for(const fact of ['manual','paid','failed','zero','reserved','open','retryable','unknown','settled','released']) await t.test(`floor permits repricing and retains ${fact} history`,async()=> {
          const f=await fixture();
          if(fact==='manual') await raw.query('UPDATE repair_orders SET amount_paid_cents=3000 WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]);
          else if(['paid','failed','zero'].includes(fact)) await raw.query('INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),f.shop,f.ro,fact==='zero'?0:3000,fact==='failed'?'failed':'succeeded']);
          else await raw.query('INSERT INTO ro_payment_attempts(id,shop_id,ro_id,idempotency_key,amount_cents,kind,status) VALUES ($1,$2,$3,$4,3000,\'intent\',$5)',[randomUUID(),f.shop,f.ro,randomUUID(),fact]);
          const protectedMoney=!['zero','settled','released'].includes(fact);
          const before=await snapshot(f);
          if(protectedMoney) {
            await assert.rejects(raw.query('UPDATE estimate_line_items SET unit_price=1 WHERE id=$1',[f.line]),/RO_FINANCIAL_HOLD/);
            await assert.rejects(raw.query(...mutations.remove(f)),/RO_FINANCIAL_HOLD/);
            assert.deepEqual(await snapshot(f),before);
          }
          await assert.rejects(raw.query('DELETE FROM repair_orders WHERE id=$1 AND shop_id=$2',[f.ro,f.shop]),/RO_HISTORY_PROTECTED/);
          if(fact!=='manual') {
            const table=['paid','failed','zero'].includes(fact)?'ro_payments':'ro_payment_attempts';
            await assert.rejects(raw.query(`DELETE FROM ${table} WHERE ro_id=$1 AND shop_id=$2`,[f.ro,f.shop]),/RO_HISTORY_PROTECTED/);
          }
          assert.deepEqual(await snapshot(f),before);
          for(const [name,statement] of Object.entries(mutations)) if(!['remove','increase','taxIncrease'].includes(name)) await raw.query(...statement(f));
          assert.equal((await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents,5000);
          await raw.query('UPDATE estimate_line_items SET unit_price=120 WHERE id=$1',[f.line]);
          if(!protectedMoney) await raw.query(...mutations.remove(f));
          await raw.query("UPDATE repair_orders SET status='repair' WHERE id=$1 AND shop_id=$2",[f.ro,f.shop]);
        });
        const transaction=async work=> {
          const c=await raw.connect();
          try {await c.query('BEGIN');await work(c);await c.query('COMMIT');}
          catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
        };
        for(const kind of ['deposit','checkout']) await t.test(`supplement, safe decrease/delete, metadata and atomic replacement after ${kind}`,async()=> {
          const f=await fixture();
          const a=await payments.reservePayment({roId:f.ro,shopId:f.shop,kind:kind==='deposit'?'intent':'checkout',amount:3000,allowPartial:true});
          if(kind==='deposit') await payments.settlePaymentEvent({type:'payment_intent.succeeded',data:{object:{
            id:`pi_${randomUUID()}`,metadata:payments.metadataFor(a),amount_received:3000,currency:'usd'}}});
          const extra=randomUUID();
          await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,unit_price) VALUES ($1,$2,$3,'parts',25)",[extra,f.shop,f.ro]);
          await raw.query('UPDATE estimate_line_items SET unit_price=50 WHERE id=$1',[f.line]);
          await raw.query(...mutations.metadata(f));
          await raw.query('DELETE FROM estimate_line_items WHERE id=$1',[extra]);
          assert.equal((await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents,5500);
          // Temporary zero is legal within a replacement transaction.
          await transaction(async c=> {
            await c.query('DELETE FROM estimate_line_items WHERE ro_id=$1 AND shop_id=$2',[f.ro,f.shop]);
            await c.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,unit_price) VALUES ($1,$2,$3,'parts',40),($4,$2,$3,'labor',10)",[f.line,f.shop,f.ro,extra]);
          });
          const before=await snapshot(f);
          await assert.rejects(transaction(async c=> {
            await c.query(...mutations.metadata(f));
            await c.query('DELETE FROM estimate_line_items WHERE ro_id=$1 AND shop_id=$2',[f.ro,f.shop]);
            await c.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,unit_price) VALUES ($1,$2,$3,'parts',1)",[f.line,f.shop,f.ro]);
          }),/RO_FINANCIAL_HOLD/);
          assert.deepEqual(await snapshot(f),before);
          await assert.rejects(raw.query('DELETE FROM repair_orders WHERE id=$1',[f.ro]),/RO_HISTORY_PROTECTED/);
        });
        await t.test('manual paid plus active reservation is the floor; metadata/parent totals cannot replace authority',async()=> {
          const f=await fixture();
          await raw.query('UPDATE repair_orders SET amount_paid_cents=3000 WHERE id=$1',[f.ro]);
          await payments.reservePayment({roId:f.ro,shopId:f.shop,kind:'checkout',amount:4000,allowPartial:true});
          await raw.query('UPDATE estimate_line_items SET unit_price=70,taxable=FALSE WHERE id=$1',[f.line]);
          await raw.query('UPDATE repair_orders SET total=9999,estimate_amount=9999 WHERE id=$1',[f.ro]);
          await raw.query(...mutations.metadata(f));
          const before=await snapshot(f);
          await assert.rejects(raw.query('UPDATE estimate_line_items SET unit_price=69.99 WHERE id=$1',[f.line]),/RO_FINANCIAL_HOLD/);
          assert.deepEqual(await snapshot(f),before);
          assert.equal((await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents,7000);
        });
        for(const [column,value] of [['payment_status','paid'],['payment_status',' SuCcEeDeD '],
          ['payment_received',1],['payment_received',2],['status',' CLOSED '],['status','completed'],['status','total_loss']]) {
          await t.test(`tax decrease/increase preserves paid/closed snapshots: ${column}=${value}`,async()=> {
            const f=await fixture();
            await raw.query(`UPDATE repair_orders SET total=110,estimate_amount=110,amount_owed_cents=11000,
              amount_paid_cents=11000,${column}=$2 WHERE id=$1 AND shop_id=$3`,[f.ro,value,f.shop]);
            await raw.query("INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status) VALUES ($1,$2,$3,11000,'succeeded')",
              [randomUUID(),f.shop,f.ro]);
            const before=await snapshot(f);
            // A decrease below historical paid money must succeed, not assert a
            // floor at the new default. Neither direction may rewrite history.
            for(const rate of [0,0.2,0.05]) {
              await raw.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[f.shop,rate]);
              assert.equal(Number((await raw.query('SELECT tax_rate FROM shops WHERE id=$1',[f.shop])).rows[0].tax_rate),rate);
              assert.deepEqual(await snapshot(f),before);
            }
          });
        }
        await t.test('open paid-plus-held tax floor rolls back whole shop while paid/closed snapshots stay unchanged',async()=> {
          const f=await fixture();
          await raw.query("UPDATE repair_orders SET amount_paid_cents=3000,payment_status='partial' WHERE id=$1 AND shop_id=$2",[f.ro,f.shop]);
          await payments.reservePayment({roId:f.ro,shopId:f.shop,kind:'checkout',amount:7500,allowPartial:true});
          const sibling=randomUUID();
          await raw.query('INSERT INTO repair_orders(id,shop_id) VALUES ($1,$2)',[sibling,f.shop]);
          await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,unit_price) VALUES ($1,$2,$3,'parts',200)",[randomUUID(),f.shop,sibling]);
          const historical=[];
          for(const [status,payment] of [['delivery','paid'],['closed','unpaid']]) {
            const id=randomUUID();historical.push(id);
            await raw.query('INSERT INTO repair_orders(id,shop_id,status,payment_status,total,estimate_amount,amount_owed_cents) VALUES ($1,$2,$3,$4,110,110,11000)',
              [id,f.shop,status,payment]);
            await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type) VALUES ($1,$2,$3,'parts')",[randomUUID(),f.shop,id]);
            await raw.query('UPDATE repair_orders SET amount_paid_cents=11000 WHERE id=$1 AND shop_id=$2',[id,f.shop]);
          }
          const history=async()=>(await raw.query('SELECT * FROM repair_orders WHERE id::text=ANY($1::text[]) ORDER BY id',[historical])).rows;
          const issued=await history();
          for(const rate of [0.2,0.05]) {
            await raw.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[f.shop,rate]);
            assert.deepEqual(await history(),issued);
            for(const ro of [f.ro,sibling]) {
              const summary=await money.getRoMoneySummary(ro,f.shop,raw);
              const row=(await raw.query('SELECT tax,total,estimate_amount,amount_owed_cents FROM repair_orders WHERE id=$1',[ro])).rows[0];
              assert.equal(Number(row.tax)*100,summary.taxCents);
              assert.equal(Number(row.total)*100,summary.totalCents);
              assert.equal(Number(row.estimate_amount)*100,summary.totalCents);
              assert.equal(row.amount_owed_cents,summary.totalCents);
            }
          }
          const before=await snapshot(f);
          await assert.rejects(raw.query('UPDATE shops SET tax_rate=0.0499 WHERE id=$1',[f.shop]),/RO_FINANCIAL_HOLD/);
          assert.deepEqual(await snapshot(f),before);
          assert.equal(Number((await raw.query('SELECT tax_rate FROM shops WHERE id=$1',[f.shop])).rows[0].tax_rate),0.05);
        });
        await t.test('released failed history permits repricing but cannot be erased; ambiguous failure stays held',async()=> {
          const f=await fixture(),intent=`pi_${randomUUID()}`;
          const a=await payments.reservePayment({roId:f.ro,shopId:f.shop,kind:'intent',amount:3000,allowPartial:true});
          await raw.query("UPDATE ro_payment_attempts SET stripe_payment_intent_id=$2,status='unknown' WHERE id=$1",[a.id,intent]);
          await raw.query("INSERT INTO ro_payments(id,shop_id,ro_id,amount_cents,status,stripe_payment_intent_id) VALUES ($1,$2,$3,3000,'failed',$4)",[randomUUID(),f.shop,f.ro,intent]);
          await assert.rejects(raw.query(...mutations.remove(f)),/RO_FINANCIAL_HOLD/);
          // Terminal cancellation persistence, the same state Phase A writes.
          await raw.query("UPDATE ro_payment_attempts SET status='released' WHERE id=$1",[a.id]);
          await raw.query(...mutations.remove(f));
          assert.equal((await money.getRoMoneySummary(f.ro,f.shop,raw)).totalCents,0);
          for(const table of ['ro_payment_attempts','ro_payments']) {
            await assert.rejects(raw.query(`DELETE FROM ${table} WHERE ro_id=$1`,[f.ro]),/RO_HISTORY_PROTECTED/);
            await assert.rejects(raw.query(`UPDATE ${table} SET amount_cents=1 WHERE ro_id=$1`,[f.ro]),/RO_HISTORY_PROTECTED/);
          }
          await assert.rejects(raw.query('DELETE FROM repair_orders WHERE id=$1',[f.ro]),/RO_HISTORY_PROTECTED/);
        });
        await t.test('moving lines protects both parents and requires exact tenant ownership',async()=> {
          const a=await fixture(),b=await fixture();
          await reserve(a); const before=await snapshot(a);
          await assert.rejects(raw.query('UPDATE estimate_line_items SET ro_id=$2,shop_id=$3 WHERE id=$1',[a.line,b.ro,b.shop]),/RO_FINANCIAL_HOLD/);
          assert.deepEqual(await snapshot(a),before);
          await assert.rejects(raw.query('UPDATE estimate_line_items SET shop_id=$2 WHERE id=$1',[a.line,b.shop]),/RO_NOT_FOUND/);
          const discount=await fixture();
          await raw.query('UPDATE estimate_line_items SET unit_price=-10 WHERE id=$1',[discount.line]);
          await assert.rejects(raw.query('UPDATE estimate_line_items SET ro_id=$2,shop_id=$3 WHERE id=$1',[discount.line,a.ro,a.shop]),/RO_FINANCIAL_HOLD/);
          assert.equal((await raw.query('SELECT ro_id FROM estimate_line_items WHERE id=$1',[discount.line])).rows[0].ro_id,discount.ro);
          await raw.query('UPDATE estimate_line_items SET ro_id=$2,shop_id=$3 WHERE id=$1',[b.line,a.ro,a.shop]);
          assert.equal((await money.getRoMoneySummary(a.ro,a.shop,raw)).totalCents,22000);
        });
        await t.test('DB authoritative money matches roMoney rounding, aggregate order and optional snapshots',async()=> {
          const f=await fixture();
          for(const [price,qty,rate] of [['1.005','1','0.075'],['0.005','1','0.1'],['-0.005','1','0.5'],['2.675','3','0.0725'],['0.29','1','0.5'],['12345.67','1.23','0.06625']]) {
            await raw.query('UPDATE estimate_line_items SET unit_price=$2,quantity=$3 WHERE id=$1',[f.line,price,qty]);
            await raw.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[f.shop,rate]);
            const expected=await money.getRoMoneySummary(f.ro,f.shop,raw);
            const actual=(await raw.query('SELECT revv_authoritative_money($1,$2) AS money',[f.shop,f.ro])).rows[0].money;
            assert.equal(actual.totalCents,expected.totalCents || 0);assert.equal(actual.taxCents,expected.taxCents || 0);
          }
          await raw.query('UPDATE estimate_line_items SET unit_price=0.004,quantity=1 WHERE id=$1',[f.line]);
          await raw.query("INSERT INTO estimate_line_items(id,shop_id,ro_id,type,unit_price) VALUES ($1,$2,$3,'parts',0.004)",[randomUUID(),f.shop,f.ro]);
          const expected=await money.getRoMoneySummary(f.ro,f.shop,raw);
          const actual=(await raw.query('SELECT revv_authoritative_money($1,$2) AS money',[f.shop,f.ro])).rows[0].money;
          assert.equal(expected.totalCents,1);assert.equal(actual.totalCents,expected.totalCents);
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
        for(const flagType of ['BOOLEAN','TEXT']) for(const paid of [false,true]) {
          await t.test(`tax respects optional payment columns and ${flagType} received=${paid}`,async()=> {
            const f=await fixture(),c=await raw.connect();
            try {
              await c.query('BEGIN');
              await c.query('ALTER TABLE repair_orders DROP COLUMN payment_status, DROP COLUMN status');
              await c.query('ALTER TABLE repair_orders ALTER COLUMN payment_received DROP DEFAULT');
              await c.query(`ALTER TABLE repair_orders ALTER COLUMN payment_received TYPE ${flagType} USING ${flagType==='BOOLEAN'?'payment_received<>0':'payment_received::text'}`);
              await c.query('UPDATE repair_orders SET payment_received=$2 WHERE id=$1 AND shop_id=$3',[f.ro,paid,f.shop]);
              await c.query('SET CONSTRAINTS ALL IMMEDIATE');
              const row=async()=>(await c.query('SELECT * FROM repair_orders WHERE id=$1 AND shop_id=$2',[f.ro,f.shop])).rows[0];
              const before=await row();
              for(const rate of [0,0.2]) {
                await c.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[f.shop,rate]);
                if(paid)assert.deepEqual(await row(),before);
                else {
                  const current=await row();assert.equal(Number(current.tax),100*rate);
                  assert.equal(Number(current.total),100*(1+rate));assert.equal(current.amount_owed_cents,10000*(1+rate));
                }
              }
            } finally {await c.query('ROLLBACK');c.release();}
          });
        }
        for(const closed of [false,true]) await t.test(`tax supports missing payment/money columns, closed=${closed}`,async()=> {
          const f=await fixture(),c=await raw.connect();
          try {
            await c.query('BEGIN');
            await c.query('ALTER TABLE repair_orders DROP COLUMN payment_status, DROP COLUMN payment_received, DROP COLUMN amount_paid_cents, DROP COLUMN amount_owed_cents, DROP COLUMN tax, DROP COLUMN total, DROP COLUMN estimate_amount');
            if(closed)await c.query("UPDATE repair_orders SET status='closed' WHERE id=$1 AND shop_id=$2",[f.ro,f.shop]);
            else await c.query('ALTER TABLE repair_orders DROP COLUMN status');
            await c.query('SET CONSTRAINTS ALL IMMEDIATE');
            const before=(await c.query('SELECT * FROM repair_orders WHERE id=$1',[f.ro])).rows;
            for(const rate of [0,0.2]) {
              await c.query('UPDATE shops SET tax_rate=$2 WHERE id=$1',[f.shop,rate]);
              assert.equal(Number((await c.query('SELECT tax_rate FROM shops WHERE id=$1',[f.shop])).rows[0].tax_rate),rate);
              assert.deepEqual((await c.query('SELECT * FROM repair_orders WHERE id=$1',[f.ro])).rows,before);
            }
          } finally {await c.query('ROLLBACK');c.release();}
        });
      } finally {if(raw)await raw.end();if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}
    });
  } finally {await admin.end();}
});
