// Explicit, idempotent one-tenant import. No PDF or credentials are shipped in the repository.
// DATABASE_URL=... node scripts/import-miles-authorizations.js /private/prepared-folder [--apply]
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const { MILES_SHOP_ID, profiles } = require('../backend/src/services/milesAgreements');
const { hash, validatePdf } = require('../backend/src/services/agreements');

async function main() {
  if (!process.env.DATABASE_URL || !process.argv[2]) throw new Error('Supply DATABASE_URL and the prepared document directory.');
  const root = path.resolve(process.argv[2]);
  const scoped = JSON.parse(fs.readFileSync(path.join(root, 'scoped-manifest.json')));
  const files = { miles_insurance_v1: '01-repair-authorization-direction-of-pay.pdf', miles_removal_v1: '02-vehicle-removal-release.pdf', miles_cash_v1: '03-repair-authorization-cash-agreement.pdf' };
  const documents = [];
  for (const [kind, filename] of Object.entries(files)) {
    const original = fs.readFileSync(path.join(root, 'output/pdf', filename));
    if (hash(original) !== profiles[kind].hash || await validatePdf(original) !== 1) throw new Error(`Source mismatch: ${kind}`);
    const stages = {};
    if (kind !== 'miles_removal_v1') for (const stage of ['intake', 'completion']) {
      const expected = scoped[kind]?.[stage];
      if (!expected) throw new Error(`Missing scoped document: ${kind}/${stage}`);
      const bytes = fs.readFileSync(expected.path);
      if (hash(bytes) !== expected.sha256 || await validatePdf(bytes) !== 1) throw new Error(`Scoped document mismatch: ${kind}/${stage}`);
      stages[stage] = { pdf: bytes.toString('base64'), sha256: expected.sha256 };
    }
    documents.push({ kind, original, stages });
  }
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }, connectionTimeoutMillis:5000 });
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['revv-miles-authorizations-v1']);
    const identity = (await client.query(`SELECT s.id,s.name,s.address,s.city,u.id AS owner_id FROM shops s JOIN users u ON u.shop_id=s.id
      WHERE s.id::text=$1 AND lower(u.email)=$2 AND u.role='owner' FOR UPDATE OF s`, [MILES_SHOP_ID,'milesautomotivecorp@gmail.com'])).rows;
    if (identity.length !== 1 || identity[0].name !== 'Miles Automotive' || identity[0].address !== '1152 Randall Ave' || identity[0].city !== 'Bronx') throw new Error('Miles account identity did not match. Nothing imported.');
    const rows = [];
    for (const { kind, original, stages } of documents) {
      const existing = (await client.query('SELECT id,preparation_kind,archived FROM agreement_templates WHERE shop_id=$1 AND document_sha256=$2', [MILES_SHOP_ID,profiles[kind].hash])).rows;
      if (existing.length > 1 || existing.some((row) => row.archived || (row.preparation_kind && row.preparation_kind !== kind))) throw new Error('Existing template needs review; not replacing or reactivating it.');
      const id = existing[0]?.id || randomUUID();
      if (process.argv.includes('--apply')) {
        if (existing.length) await client.query('UPDATE agreement_templates SET preparation_kind=$2,stage_documents=$3::jsonb WHERE id=$1 AND shop_id=$4', [id,kind,JSON.stringify(stages),MILES_SHOP_ID]);
        else await client.query(`INSERT INTO agreement_templates(id,shop_id,title,original_pdf,document_sha256,page_count,created_by,preparation_kind,stage_documents)
          VALUES($1,$2,$3,$4,$5,1,$6,$7,$8::jsonb)`, [id,MILES_SHOP_ID,profiles[kind].title,original,profiles[kind].hash,'operator:codex-authorized-import-20260926',kind,JSON.stringify(stages)]);
      }
      rows.push({ id: existing[0]?.id || (process.argv.includes('--apply') ? id : null), kind, source_sha256: profiles[kind].hash, existing: !!existing.length });
    }
    await client.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ applied:process.argv.includes('--apply'),shop_id:MILES_SHOP_ID,templates:rows },null,2));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await database.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode=1; });
