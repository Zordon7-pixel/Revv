const { randomUUID } = require('crypto');
const STATUSES = ['ordered', 'backordered', 'shipped', 'partially_received', 'received', 'cancelled'];
const PENDING = STATUSES.filter(s => !['received', 'cancelled'].includes(s));
const SOURCES = ['unknown', 'supplier', 'carrier', 'shop'];
const initialized = new WeakMap();
const fail = (message, status = 400) => Object.assign(new Error(message), { status, publicMessage: true });
function ensureDelivery(db) {
  if (!initialized.has(db)) initialized.set(db, (async () => {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtext('revv-parts-delivery-schema'))");
      await c.query(`ALTER TABLE parts_orders ADD COLUMN IF NOT EXISTS supplier_order_ref TEXT,
        ADD COLUMN IF NOT EXISTS eta_source TEXT NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS customer_note TEXT,
        ADD COLUMN IF NOT EXISTS received_quantity INTEGER,
        ADD COLUMN IF NOT EXISTS delivery_revision INTEGER NOT NULL DEFAULT 0`);
      // Preserve legacy received records without inventing a new receipt event.
      await c.query("UPDATE parts_orders SET received_quantity=CASE WHEN status='received' THEN GREATEST(COALESCE(quantity,1),0) ELSE 0 END WHERE received_quantity IS NULL");
      await c.query('ALTER TABLE parts_orders ALTER COLUMN received_quantity SET DEFAULT 0');
      await c.query(`CREATE TABLE IF NOT EXISTS parts_delivery_events (
        id UUID PRIMARY KEY, part_id TEXT NOT NULL, shop_id TEXT NOT NULL, ro_id TEXT NOT NULL,
        revision INTEGER NOT NULL, actor_id TEXT, source TEXT NOT NULL,
        before_state JSONB, after_state JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(part_id, shop_id, revision))`);
      await c.query('CREATE INDEX IF NOT EXISTS parts_delivery_events_ro ON parts_delivery_events(shop_id,ro_id,created_at)');
      await c.query('COMMIT');
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  })().catch(e => { initialized.delete(db); throw e; }));
  return initialized.get(db);
}
function text(value, name, max) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw fail(`${name} must be text of at most ${max} characters.`);
  return value.trim() || null;
}
function date(value, name) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw fail(`${name} must be a valid date.`);
  return value;
}
function count(value, name, min = 0) {
  if (value === '' || value == null || typeof value === 'boolean' || !Number.isInteger(Number(value)) || Number(value)<min || Number(value)>1000000) throw fail(`${name} must be a whole number from ${min} to 1000000.`);
  return Number(value);
}
function normalize(body, old = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Invalid part update.');
  const f = {};
  const input = {...body};
  if (input.name !== undefined && input.part_name === undefined) input.part_name=input.name;
  if (input.cost !== undefined && input.unit_cost === undefined) input.unit_cost=input.cost;
  for (const [key,max] of Object.entries({part_name:240,part_number:120,vendor:160,supplier_order_ref:160,notes:3000,customer_note:500,tracking_number:160})) {
    if (input[key] !== undefined) f[key]=text(input[key],key,max);
  }
  if ((!old || input.part_name!==undefined) && !f.part_name) throw fail('Part name required.');
  if (!old || input.quantity!==undefined) f.quantity=count(input.quantity??1,'Quantity',1);
  if (!old || input.unit_cost!==undefined) {
    const cost=input.unit_cost===undefined || input.unit_cost===''?0:input.unit_cost;
    if (typeof cost==='boolean' || cost===null || !Number.isFinite(Number(cost)) || Number(cost)<0 || Number(cost)>10000000) throw fail('Unit cost must be a nonnegative number.');
    f.unit_cost=Number(cost);
  }
  for (const key of ['expected_date','received_date']) if (input[key]!==undefined) f[key]=date(input[key],key);
  if (input.eta_source!==undefined) { if (!SOURCES.includes(input.eta_source)) throw fail('Invalid ETA source.'); f.eta_source=input.eta_source; }
  if (input.status!==undefined && !STATUSES.includes(input.status)) throw fail('Invalid part status.');
  const qty=f.quantity??old?.quantity??1;
  const status=input.status??old?.status??'ordered';
  let received=input.received_quantity!==undefined?count(input.received_quantity,'Received quantity'):Number(old?.received_quantity??0);
  if (input.status==='received' && input.received_quantity===undefined) received=qty;
  if (received>qty) throw fail('Received quantity cannot exceed ordered quantity.');
  if (status==='received' && received!==qty) throw fail('Confirm all ordered units before marking received.');
  if (status==='partially_received' && (received===0 || received===qty)) throw fail('Partial receipt must be between zero and the ordered quantity.');
  if (status!=='cancelled' && status!=='received' && received===qty) throw fail('All units are received; select Received.');
  if (status!=='cancelled' && !['received','partially_received'].includes(status) && received>0) throw fail('Select Partially received for a partial receipt.');
  if (!old || input.status!==undefined || input.received_quantity!==undefined || input.quantity!==undefined) {
    f.status=status; f.received_quantity=received;
  }
  f.received_date=status==='received'?(f.received_date||old?.received_date||new Date().toISOString().slice(0,10)):null;
  if (f.expected_date===null) f.eta_source='unknown';
  // A changed date without an explicitly declared source must not inherit supplier authority.
  if (f.expected_date && f.expected_date!==old?.expected_date && f.eta_source===undefined) f.eta_source='shop';
  if (!(f.expected_date===undefined?old?.expected_date:f.expected_date)) f.eta_source='unknown';
  if (f.tracking_number!==undefined && f.tracking_number!==old?.tracking_number) {
    const { detectCarrier }=require('./trackingCarrier');
    f.carrier=f.tracking_number?(detectCarrier(f.tracking_number)||'unknown'):null;
    f.tracking_status=null; f.tracking_detail=null; f.tracking_updated_at=null;
  }
  return f;
}
function customerPart(p) {
  return { part_name:p.part_name, status:p.status, quantity:Number(p.quantity), received_quantity:Number(p.received_quantity??(p.status==='received'?p.quantity:0)),
    expected_date:p.expected_date||null, eta_source:SOURCES.includes(p.eta_source)?p.eta_source:'unknown',
    received_date:p.received_date||null, customer_note:p.customer_note||null,
    carrier_delivered:p.tracking_status==='delivered', updated_at:p.updated_at };
}
function summarize(parts, today=new Date().toISOString().slice(0,10)) {
  const pending=parts.filter(p=>PENDING.includes(p.status));
  const dates=pending.map(p=>p.expected_date).filter(Boolean).sort();
  const uncertain=pending.some(p=>!p.expected_date || p.status==='backordered' || !SOURCES.includes(p.eta_source) || p.eta_source==='unknown' || p.expected_date<today);
  return { waiting:pending.length>0, pending_count:pending.length,
    backordered_count:pending.filter(p=>p.status==='backordered').length,
    overdue_count:pending.filter(p=>p.expected_date && p.expected_date<today).length,
    latest_expected_date:!uncertain && dates.length===pending.length && dates.length?dates.at(-1):null,
    message:pending.length?(uncertain?'Waiting on parts. The shop is confirming delivery dates.':'Waiting on parts. Delivery dates below are estimates.'):
      parts.some(p=>p.status==='received')?'All active part orders have been received by the shop.':'No active part orders.',
    disclaimer:'Parts arrival estimates do not confirm when vehicle repairs will be complete.' };
}
function snapshot(p) {
  return {...customerPart(p), supplier_order_ref:p.supplier_order_ref||null, vendor:p.vendor||null, tracking_number:p.tracking_number||null, tracking_status:p.tracking_status||null};
}
async function savePart(db, shopId, actorId, body, {id=null, roId=null, requireRevision=false}={}) {
  await ensureDelivery(db);
  const c=await db.connect();
  try {
    await c.query('BEGIN');
    const old=id?(await c.query('SELECT * FROM parts_orders WHERE id=$1 AND shop_id=$2 FOR UPDATE',[id,shopId])).rows[0]:null;
    if(id&&!old) throw fail('Part not found.',404);
    if(!id && !(await c.query('SELECT id FROM repair_orders WHERE id=$1 AND shop_id=$2',[roId,shopId])).rowCount) throw fail('RO not found.',404);
    if(id && (requireRevision || body.delivery_revision!==undefined) && (!Number.isInteger(body.delivery_revision) || body.delivery_revision!==old.delivery_revision)) throw fail('This order changed. Reload its latest details before saving.',409);
    const fields=normalize(body,old);
    if(!Object.keys(fields).some(key=>fields[key]!==old?.[key])) { await c.query('COMMIT'); return old; }
    fields.delivery_revision=(old?.delivery_revision??0)+1;
    fields.updated_at=new Date().toISOString();
    if(!old) fields.ordered_date=new Date().toISOString().slice(0,10);
    const keys=Object.keys(fields), values=Object.values(fields);
    const saved=(await c.query(old?
      `UPDATE parts_orders SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND shop_id=$${keys.length+2} RETURNING *`:
      `INSERT INTO parts_orders (id,shop_id,ro_id,${keys.join(',')}) VALUES ($1,$2,$3,${keys.map((_,i)=>`$${i+4}`).join(',')}) RETURNING *`,
      old?[...values,id,shopId]:[randomUUID(),shopId,roId,...values])).rows[0];
    await recordEvent(c, saved, old, actorId, 'staff');
    await c.query('COMMIT'); return saved;
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally {c.release();}
}
async function recordEvent(c, next, old, actorId, source) {
  await c.query(`INSERT INTO parts_delivery_events(id,part_id,shop_id,ro_id,revision,actor_id,source,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(),String(next.id),String(next.shop_id),String(next.ro_id),next.delivery_revision,actorId||null,source,old?JSON.stringify(snapshot(old)):null,JSON.stringify(snapshot(next))]);
}
async function applyCarrier(db, part, result) {
  if(!result) return;
  await ensureDelivery(db);
  const c=await db.connect();
  try {
    await c.query('BEGIN');
    const old=(await c.query('SELECT * FROM parts_orders WHERE id=$1 AND shop_id=$2 FOR UPDATE',[part.id,part.shop_id])).rows[0];
    // A response for an old shipment cannot overwrite a new tracking number or a finalized order.
    if(!old || old.tracking_number!==part.tracking_number || old.delivery_revision!==part.delivery_revision || !PENDING.includes(old.status)) { await c.query('COMMIT'); return; }
    const next=(await c.query(`UPDATE parts_orders SET tracking_status=$1,tracking_detail=$2,tracking_updated_at=$3,updated_at=$4,delivery_revision=delivery_revision+1 WHERE id=$5 AND shop_id=$6 RETURNING *`,
      [result.tracking_status,String(result.tracking_detail||'').slice(0,1000),new Date().toISOString(),new Date().toISOString(),part.id,part.shop_id])).rows[0];
    if(old.tracking_status!==next.tracking_status) await recordEvent(c,next,old,null,'carrier');
    await c.query('COMMIT');
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
module.exports={ensureDelivery,normalize,customerPart,summarize,savePart,applyCarrier,STATUSES,PENDING,fail};
