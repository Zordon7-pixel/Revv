const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ensureStock, saveStock, findStock } = require('../src/services/stockCapture');
const url = process.env.PARTS_TEST_DATABASE_URL;

test('photo and stock sequence with real disposable PostgreSQL', { skip: !url }, async (t) => {
  const address = new URL(url); assert.ok(['127.0.0.1','localhost'].includes(address.hostname) && address.pathname === '/revv_parts_test');
  const root = new Pool({ connectionString: url, ssl: false });
  const schema = `parts_${randomUUID().replaceAll('-','')}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({ connectionString: url, ssl: false, options: `-c search_path=${schema}` });
  let server;
  t.after(async () => { if(server) await new Promise(resolve => server.close(resolve)); await db.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); });
  await db.query('CREATE TABLE shops(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY,revoke_all_before TIMESTAMPTZ); CREATE TABLE revoked_tokens(id UUID,token_jti TEXT)');
  const shopA=randomUUID(),shopB=randomUUID(),user=randomUUID();
  await db.query('INSERT INTO shops VALUES ($1),($2)',[shopA,shopB]);
  await ensureStock(db); await ensureStock(db);
  const dbPath=require.resolve('../src/db'); require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:db,dbGet:async(sql,params)=>(await db.query(sql,params)).rows[0],dbAll:async(sql,params)=>(await db.query(sql,params)).rows,dbRun:(sql,params)=>db.query(sql,params)}};
  process.env.JWT_SECRET='part-capture-test-secret';
  const {createPartCaptureRouter}=require('../src/routes/partCapture');
  const app=express();app.use(express.json());
  let extracts=0,lookups=0;
  app.use('/api/part-capture',createPartCaptureRouter({database:db,env:{},extract:async()=>{extracts++;return {raw_text:'AB-123',candidates:[{part_number:'AB-123'}]};},lookup:async()=>{lookups++;return {status:'available',candidates:[]};}}));
  app.use('/api/inventory',require('../src/routes/inventory'));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const token=(role='admin',shop=shopA)=>jwt.sign({id:user,shop_id:shop,role},process.env.JWT_SECRET);
  async function api(path,{method='GET',body,auth=token()}={}) { const headers=auth?{Authorization:`Bearer ${auth}`} : {};if(body && !(body instanceof FormData))headers['Content-Type']='application/json'; const r=await fetch(base+path,{method,headers,body:body?body instanceof FormData?body:JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}; }
  const item={part_number:'AB-123',name:'Headlamp',brand:'Example',qty_on_hand:2,location:'B3',cost_cents:2500};
  let stock;
  await t.test('staff access required before paid processing',async()=>{
    assert.equal((await api('/part-capture/lookup?part_number=AB123',{auth:null})).status,401);
    assert.equal((await api('/part-capture/extract',{method:'POST',auth:token('customer')})).status,403);
    assert.equal(extracts,0);
  });
  await t.test('photo extraction is read-only and source text returned',async()=>{
    const form=new FormData();form.append('photo',new Blob([Buffer.from([255,216,255])],{type:'image/jpeg'}),'label.jpg');
    const result=await api('/part-capture/extract',{method:'POST',body:form});assert.equal(result.status,200);assert.equal(result.data.raw_text,'AB-123');
    assert.equal((await db.query('SELECT * FROM parts_inventory')).rowCount,0);
  });
  await t.test('new confirmed stock saved via existing route with source metadata',async()=>{
    const result=await api('/inventory',{method:'POST',body:{...item,source_details:{source:'Photo label',raw_text:'AB-123 Headlamp',source_url:'javascript:alert(1)'}}});
    assert.equal(result.status,201);stock=result.data.item;assert.equal(stock.source_details.source_url,'');assert.equal(stock.qty_on_hand,2);
  });
  await t.test('normalized matches are shop scoped and external lookup is explicit',async()=>{
    await saveStock(db,shopB,{...item,name:'Other shop part'});
    const result=await api('/part-capture/lookup?part_number=ab%20123&brand=Different');
    assert.equal(result.data.stock.length,1);assert.equal(result.data.stock[0].id,stock.id);assert.equal(result.data.stock[0].brand_match,'different');assert.equal(lookups,0);
    await api('/part-capture/lookup?part_number=AB123&external=true');assert.equal(lookups,1);
  });
  await t.test('normalized duplicates blocked without replacing existing quantity',async()=>{
    const result=await api('/inventory',{method:'POST',body:{...item,part_number:'ab123',qty_on_hand:99}});assert.equal(result.status,409);
    assert.equal((await findStock(db,shopA,'AB123'))[0].qty_on_hand,2);
  });
  await t.test('simultaneous saves create a single stock item',async()=>{
    const results=await Promise.allSettled(['X-999','x999'].map(part_number=>saveStock(db,shopA,{...item,part_number})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  });
  await t.test('cross-shop editing and invalid counts rejected; existing stock can be reviewed',async()=>{
    assert.equal((await api(`/inventory/${stock.id}`,{method:'PUT',body:{qty_on_hand:3},auth:token('admin',shopB)})).status,404);
    assert.equal((await api(`/inventory/${stock.id}`,{method:'PUT',body:{qty_on_hand:1.5}})).status,400);
    const result=await api(`/inventory/${stock.id}`,{method:'PUT',body:{qty_on_hand:3,location:'B4'}});assert.equal(result.data.item.qty_on_hand,3);assert.equal(result.data.item.location,'B4');
    assert.equal((await api(`/inventory/${stock.id}`,{method:'PUT',body:{part_number:'X999'}})).status,409);
  });
  await t.test('different known brands may share a number; unknown brand stays ambiguous', async()=>{
    const created=await saveStock(db,shopA,{...item,brand:'Different maker'});
    assert.notEqual(created.id,stock.id);assert.equal((await findStock(db,shopA,'AB123')).length,2);
    await assert.rejects(saveStock(db,shopA,{...item,brand:''}),{status:409});
    await assert.rejects(saveStock(db,shopA,{...item,brand:'EX-AMPLE'}),{status:409});
    await assert.rejects(saveStock(db,shopA,{brand:'Example'},created.id),{status:409});
  });

});

test('legacy TEXT shop ids and cost-only inventory migrate without losing values', { skip: !url }, async(t)=>{
  const address=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(address.hostname)&&address.pathname==='/revv_parts_test');
  const root=new Pool({connectionString:url,ssl:false});const schema=`legacy_${randomUUID().replaceAll('-','')}`;await root.query(`CREATE SCHEMA ${schema}`);
  const db=new Pool({connectionString:url,ssl:false,options:`-c search_path=${schema}`});
  t.after(async()=>{await db.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
  await db.query("CREATE TABLE shops(id TEXT PRIMARY KEY);INSERT INTO shops VALUES('legacy-shop')");
  await db.query("CREATE TABLE parts_inventory(id TEXT PRIMARY KEY,shop_id TEXT,part_number TEXT,name TEXT,qty_on_hand INTEGER,reorder_point INTEGER,cost REAL,supplier TEXT,location TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());CREATE UNIQUE INDEX idx_parts_inventory_shop_part_number ON parts_inventory(shop_id,part_number)");
  await db.query("INSERT INTO parts_inventory(id,shop_id,part_number,name,qty_on_hand,cost) VALUES($1,'legacy-shop','P123','Old item',3,12.34)",[randomUUID()]);
  await ensureStock(db);const row=(await findStock(db,'legacy-shop','p-123'))[0];assert.equal(row.cost_cents,1234);assert.equal(row.qty_on_hand,3);
  await assert.rejects(saveStock(db,'legacy-shop',{part_number:'P123',name:'Duplicate'}),{status:409});
  assert.equal((await saveStock(db,'legacy-shop',{qty_on_hand:4},row.id)).qty_on_hand,4);
  assert.equal((await db.query("SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='idx_parts_inventory_shop_part_number'",[schema])).rowCount,0);
});
