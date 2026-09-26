const { randomUUID } = require('crypto');
const { normalizeNumber, clean, partNumber, safeUrl, inputError } = require('./partCapture');
const initialized = new WeakMap();
function ensureStock(database) {
  if (!initialized.has(database)) initialized.set(database, (async () => {
    const client = await database.connect();
    try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('revv-stock-schema'))");
    const type = (await client.query("SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'shops'::regclass AND attname = 'id'")).rows[0]?.type;
    if (!['uuid', 'text', 'character varying(36)', 'character varying(255)'].includes(type)) throw new Error('Unsupported shop identifier type');
    await client.query(`CREATE TABLE IF NOT EXISTS parts_inventory (
      id UUID PRIMARY KEY, shop_id ${type} NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      part_number TEXT NOT NULL, name TEXT NOT NULL, qty_on_hand INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0,
      supplier TEXT, location TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await client.query('ALTER TABLE parts_inventory ADD COLUMN IF NOT EXISTS cost_cents INTEGER, ADD COLUMN IF NOT EXISTS brand TEXT, ADD COLUMN IF NOT EXISTS source_details JSONB');
    const hasCost = (await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='parts_inventory'::regclass AND attname='cost' AND NOT attisdropped")).rowCount;
    if (hasCost) await client.query('UPDATE parts_inventory SET cost_cents = COALESCE(cost_cents, ROUND(cost * 100)::INTEGER, 0) WHERE cost_cents IS NULL');
    await client.query('UPDATE parts_inventory SET cost_cents=0 WHERE cost_cents IS NULL');
    await client.query('ALTER TABLE parts_inventory ALTER COLUMN cost_cents SET DEFAULT 0');
    await client.query('DROP INDEX IF EXISTS idx_parts_inventory_shop_part_number');
    await client.query('CREATE INDEX IF NOT EXISTS idx_parts_inventory_shop ON parts_inventory(shop_id)');
    await client.query("CREATE INDEX IF NOT EXISTS idx_parts_inventory_number_lookup ON parts_inventory(shop_id, (regexp_replace(upper(part_number), '[^A-Z0-9]', '', 'g')))");
    await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  })().catch((err) => { initialized.delete(database); throw err; }));
  return initialized.get(database);
}
async function findStock(database, shopId, number) {
  await ensureStock(database);
  return (await database.query("SELECT * FROM parts_inventory WHERE shop_id=$1 AND regexp_replace(upper(part_number), '[^A-Z0-9]', '', 'g')=$2 ORDER BY qty_on_hand DESC, created_at", [shopId, normalizeNumber(number)])).rows;
}
function provenance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { source: clean(raw.source, 80), source_url: safeUrl(raw.source_url), raw_text: clean(raw.raw_text, 5000),
    description: clean(raw.description, 240), part_number: clean(raw.part_number, 120), brand: clean(raw.brand, 100),
    confirmed_at: new Date().toISOString() };
}
function wholeNumber(value, label) {
  if (value === '' || value === null || typeof value === 'boolean') throw inputError(`${label} must be a whole number from 0 to 1000000.`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1000000) throw inputError(`${label} must be a whole number from 0 to 1000000.`);
  return number;
}
async function saveStock(database, shopId, body, id = null) {
  await ensureStock(database);
  const fields = {};
  if (!id || body.part_number !== undefined) fields.part_number = partNumber(body.part_number);
  if (!id || body.name !== undefined) { fields.name = clean(body.name, 240); if (!fields.name) throw inputError('Item name is required.'); }
  for (const field of ['qty_on_hand', 'reorder_point', 'cost_cents']) {
    if (!id || body[field] !== undefined) fields[field] = wholeNumber(body[field] ?? 0, field);
  }
  if (body.cost !== undefined && body.cost_cents === undefined) fields.cost_cents = wholeNumber(Math.round(Number(body.cost) * 100), 'Unit cost');
  for (const field of ['brand', 'supplier', 'location']) if (!id || body[field] !== undefined) fields[field] = clean(body[field], 160) || null;
  if (body.source_details !== undefined) fields.source_details = JSON.stringify(provenance(body.source_details));
  if (!Object.keys(fields).length) throw inputError('Nothing to update.');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    // All stock creates/edits for a shop share this lock, including the legacy form.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stock:${shopId}`]);
    const existing = id ? (await client.query('SELECT * FROM parts_inventory WHERE id=$1 AND shop_id=$2 FOR UPDATE', [id, shopId])).rows[0] : null;
    if (id && !existing) throw inputError('Part not found.', 404);
    const number = fields.part_number || existing?.part_number;
    const duplicates = (await client.query("SELECT id, name, brand, qty_on_hand, location FROM parts_inventory WHERE shop_id=$1 AND regexp_replace(upper(part_number), '[^A-Z0-9]', '', 'g')=$2 AND ($3::text IS NULL OR id::text<>$3::text)", [shopId, normalizeNumber(number), id])).rows;
    const nextBrand = fields.brand === undefined ? existing?.brand : fields.brand;
    const collisions = duplicates.filter((item) => !nextBrand || !item.brand || normalizeNumber(item.brand) === normalizeNumber(nextBrand));
    if (collisions.length && (!id || normalizeNumber(number) !== normalizeNumber(existing.part_number) || normalizeNumber(nextBrand) !== normalizeNumber(existing.brand))) {
      throw Object.assign(inputError('This part number is already in shop inventory. Open the existing item to update its count.', 409), { matches: collisions });
    }
    fields.updated_at = new Date().toISOString();
    const keys = Object.keys(fields), values = Object.values(fields);
    const result = id
      ? await client.query(`UPDATE parts_inventory SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(',')} WHERE id=$${keys.length + 1} AND shop_id=$${keys.length + 2} RETURNING *`, [...values, id, shopId])
      : await client.query(`INSERT INTO parts_inventory (id,shop_id,${keys.join(',')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`, [randomUUID(), shopId, ...values]);
    await client.query('COMMIT'); return result.rows[0];
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
module.exports = { ensureStock, findStock, saveStock, provenance };
