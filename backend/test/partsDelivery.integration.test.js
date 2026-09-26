const test=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');const {Pool}=require('pg');const express=require('express');const jwt=require('jsonwebtoken');
const {ensureDelivery,savePart,applyCarrier}=require('../src/services/partsDelivery');
const url=process.env.PARTS_TEST_DATABASE_URL;
for(const idType of ['TEXT','UUID']) test(`parts delivery lifecycle and boundaries (${idType})`,{skip:!url},async t=>{
  const address=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(address.hostname)&&address.pathname==='/revv_parts_test');
  const root=new Pool({connectionString:url,ssl:false});const schema=`delivery_${randomUUID().replaceAll('-','')}`;await root.query(`CREATE SCHEMA ${schema}`);
  const db=new Pool({connectionString:url,ssl:false,options:`-c search_path=${schema}`});let server;
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
  await db.query(`CREATE TABLE shops(id ${idType} PRIMARY KEY,name TEXT,phone TEXT,address TEXT,city TEXT,state TEXT,zip TEXT,tracking_api_key TEXT);
    CREATE TABLE users(id ${idType},revoke_all_before TIMESTAMPTZ);
    CREATE TABLE revoked_tokens(id TEXT,token_jti TEXT);
    CREATE TABLE customers(id ${idType},shop_id ${idType},name TEXT,phone TEXT,email TEXT);
    CREATE TABLE vehicles(id ${idType},shop_id ${idType},year TEXT,make TEXT,model TEXT,color TEXT,plate TEXT,vin TEXT);
    CREATE TABLE repair_orders(id ${idType} PRIMARY KEY,shop_id ${idType},customer_id ${idType},vehicle_id ${idType},ro_number TEXT,status TEXT,job_type TEXT,intake_date TEXT,estimated_delivery TEXT,actual_delivery TEXT,notes TEXT,parts_cost REAL,labor_cost REAL,total REAL,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE parts_orders(id ${idType} PRIMARY KEY,shop_id ${idType},ro_id ${idType},part_name TEXT,part_number TEXT,vendor TEXT,quantity INTEGER,unit_cost REAL,status TEXT,ordered_date TEXT,expected_date TEXT,received_date TEXT,notes TEXT,tracking_number TEXT,carrier TEXT,tracking_status TEXT,tracking_detail TEXT,tracking_updated_at TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE portal_tokens(id TEXT,token TEXT,ro_id ${idType},shop_id ${idType},created_at TIMESTAMPTZ,expires_at TIMESTAMPTZ);
    CREATE TABLE ro_photos(id TEXT,ro_id ${idType},photo_url TEXT,caption TEXT,photo_type TEXT,created_at TIMESTAMPTZ);
    CREATE TABLE job_status_log(ro_id ${idType},to_status TEXT,note TEXT,created_at TIMESTAMPTZ);
    CREATE TABLE ro_ratings(ro_id ${idType},rating INTEGER);`);
  const a=idType==='TEXT'?'shop-a':randomUUID(),b=idType==='TEXT'?'shop-b':randomUUID(),ro=randomUUID(),otherRo=randomUUID(),user=randomUUID(),customer=randomUUID(),vehicle=randomUUID();
  await db.query('INSERT INTO shops(id,name) VALUES($1,$3),($2,$3)',[a,b,'Test shop']);
  await db.query("INSERT INTO repair_orders(id,shop_id,status,customer_id,vehicle_id) VALUES($1,$2,'parts',$4,$5),($3,$2,'closed',$4,$5)",[ro,a,otherRo,customer,vehicle]);
  await db.query('INSERT INTO customers(id,shop_id,name) VALUES($1,$2,$3)',[customer,a,'Synthetic customer']);
  await db.query('INSERT INTO vehicles(id,shop_id) VALUES($1,$2)',[vehicle,a]);
  const legacy=randomUUID();await db.query("INSERT INTO parts_orders(id,shop_id,ro_id,part_name,status,quantity) VALUES($1,$2,$3,'Legacy','received',3)",[legacy,a,ro]);
  await ensureDelivery(db);await ensureDelivery(db);
  await t.test('migration preserves legacy received counts and is idempotent',async()=>{assert.equal((await db.query('SELECT received_quantity FROM parts_orders WHERE id=$1',[legacy])).rows[0].received_quantity,3);});
  const dbPath=require.resolve('../src/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:db,dbGet:async(s,p)=>(await db.query(s,p)).rows[0],dbAll:async(s,p)=>(await db.query(s,p)).rows,dbRun:(s,p)=>db.query(s,p)}};
  for(const module of ['../src/middleware/auth','../src/routes/parts','../src/routes/tracking','../src/routes/portal'])delete require.cache[require.resolve(module)];
  // No customer messages or provider requests are needed for these lifecycle tests.
  for(const [name,exports] of [['notifications',{createNotification:async()=>{throw Error('unexpected notification')}}],['customerBilling',{createPaymentCheckoutLinkForRo:async()=>{},ensureTrackingToken:async()=>{}}],['mediaStorage',{discardUploadedMedia:async()=>{},persistUploadedFile:async()=>{}}]]) {const path=require.resolve('../src/services/'+name);require.cache[path]={id:path,filename:path,loaded:true,exports};}
  process.env.JWT_SECRET='delivery-test-only';const app=express();app.use(express.json());app.use('/parts',require('../src/routes/parts'));app.use('/tracking',require('../src/routes/tracking'));app.use('/portal',require('../src/routes/portal'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const token=(role='admin',shop=a)=>jwt.sign({id:user,shop_id:shop,role,customer_id:customer},process.env.JWT_SECRET);
  const api=async(path,{method='GET',body,auth=token()}={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
  let part;
  await t.test('staff creation records supplier and history; customer cannot mutate',async()=>{
    assert.equal((await api(`/parts/ro/${ro}`,{method:'POST',body:{part_name:'Lamp'},auth:token('customer')})).status,403);
    assert.equal((await api('/tracking/poll-shop',{method:'POST',auth:token('customer')})).status,403);
    const res=await api(`/parts/ro/${ro}`,{method:'POST',body:{part_name:'Lamp',quantity:4,vendor:'PRIVATE',supplier_order_ref:'PRIVATE',unit_cost:100,notes:'PRIVATE',customer_note:'Waiting for lamp',expected_date:'2026-10-01',eta_source:'supplier',tracking_number:'1Z999AA10123456784'}});assert.equal(res.status,201);part=res.data;
    assert.equal((await api(`/parts/${part.id}/delivery-history`)).data.events.length,1);
  });
  await t.test('cross-shop reads and writes are denied',async()=>{
    for(const path of [`/parts/ro/${ro}`,`/parts/${part.id}/delivery-history`])assert.equal((await api(path,{auth:token('admin',b)})).status,404);
    assert.equal((await api(`/parts/${part.id}`,{method:'PUT',body:{vendor:'wrong'},auth:token('admin',b)})).status,404);
    await api(`/parts/${part.id}`,{method:'DELETE',auth:token('admin',b)});assert.ok((await api(`/parts/ro/${ro}`)).data.parts.some(p=>p.id===part.id));
  });
  await t.test('partial receipt and ETA updates persist with history; stale edits conflict',async()=>{
    const body={status:'partially_received',received_quantity:2,expected_date:'2026-10-03',eta_source:'supplier',delivery_revision:part.delivery_revision};
    const results=await Promise.all([api(`/parts/${part.id}/delivery`,{method:'PUT',body}),api(`/parts/${part.id}/delivery`,{method:'PUT',body})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);part=results.find(r=>r.status===200).data;
    assert.equal(part.received_quantity,2);assert.equal(part.received_date,null);assert.equal((await api(`/parts/${part.id}/delivery-history`)).data.events.length,2);
  });
  await t.test('carrier delivered never receives units; old concurrent observation is discarded',async()=>{
    const captured={...part};await applyCarrier(db,captured,{tracking_status:'delivered',tracking_detail:'PRIVATE carrier address'});
    await applyCarrier(db,captured,{tracking_status:'in_transit',tracking_detail:'older observation'});
    part=(await db.query('SELECT * FROM parts_orders WHERE id=$1',[part.id])).rows[0];assert.equal(part.tracking_status,'delivered');assert.equal(part.status,'partially_received');assert.equal(part.received_quantity,2);
    const oldTracking={...part};part=await savePart(db,a,user,{tracking_number:'NEW'}, {id:part.id});await applyCarrier(db,oldTracking,{tracking_status:'delivered'});assert.equal((await db.query('SELECT tracking_status FROM parts_orders WHERE id=$1',[part.id])).rows[0].tracking_status,null);
  });
  await t.test('customer portal exposes safe parts and tenant-scoped tokens',async()=>{
    await db.query("INSERT INTO portal_tokens(id,token,ro_id,shop_id) VALUES('ok','safe-token',$1,$2),('wrong','wrong-shop',$1,$3)",[ro,a,b]);
    const result=await api('/portal/track/safe-token',{auth:null});assert.equal(result.status,200);assert.equal(result.data.parts_summary.waiting,true);assert.ok(!JSON.stringify(result.data.parts).includes('PRIVATE'));assert.equal(result.data.parts.find(p=>p.part_name==='Lamp').received_quantity,2);
    assert.equal((await api('/portal/track/wrong-shop',{auth:null})).status,404);
    const mine=await api('/portal/my-ros',{auth:token('customer')});assert.equal(mine.status,200);assert.ok(!JSON.stringify(mine.data).includes('PRIVATE'));
  });
  await t.test('received and cancelled orders leave pending board; no inventory side effect',async()=>{
    assert.ok((await api('/parts/all-pending')).data.parts.some(p=>p.id===part.id));
    part=await savePart(db,a,user,{status:'received',received_quantity:4,delivery_revision:part.delivery_revision},{id:part.id,requireRevision:true});assert.ok(part.received_date);
    assert.ok(!(await api('/parts/all-pending')).data.parts.some(p=>p.id===part.id));
    const cancelled=await savePart(db,a,user,{part_name:'Cancelled',status:'cancelled'},{roId:ro});await applyCarrier(db,{...cancelled,tracking_number:null},{tracking_status:'delivered'});assert.equal((await db.query('SELECT status FROM parts_orders WHERE id=$1',[cancelled.id])).rows[0].status,'cancelled');
    assert.equal((await db.query("SELECT to_regclass('parts_inventory') AS table_name")).rows[0].table_name,null);
  });
});
