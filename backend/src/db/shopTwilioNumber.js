'use strict';

const SHOP_TWILIO_NUMBER_UNIQUE = 'shops_twilio_phone_number_unique';
const SHOP_TWILIO_SCHEMA_REQUIRED = 'SHOP_TWILIO_SCHEMA_REQUIRED';

async function ensureShopTwilioNumber(db) {
  try {
    // One query is one implicit transaction: a failed index install also rolls
    // back the column addition. No legacy values are rewritten to resolve conflicts.
    // IDs are deliberately absent, supporting both TEXT and UUID shop schemas.
    await db.query(`
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS ${SHOP_TWILIO_NUMBER_UNIQUE}
        ON shops (twilio_phone_number)
        WHERE twilio_phone_number ~ '[^[:space:]]';
      DO $routing_guard$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attname = 'twilio_phone_number'
          WHERE i.indrelid = 'shops'::regclass AND c.relname = '${SHOP_TWILIO_NUMBER_UNIQUE}'
            AND i.indisunique AND i.indisvalid AND i.indisready
            AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indkey[0] = a.attnum
            AND i.indexprs IS NULL
            AND pg_get_expr(i.indpred, i.indrelid) = '(twilio_phone_number ~ ''[^[:space:]]''::text)'
        ) THEN
          RAISE EXCEPTION 'Shop SMS routing index requires operator repair';
        END IF;
      END; $routing_guard$;
    `);
  } catch (err) {
    // PostgreSQL detail/message can contain phone numbers. Never retain it as a
    // cause or log it, including errors other than duplicate data.
    const message = err.code === '23505'
      ? 'Shop SMS routing migration blocked by duplicate nonempty numbers. An operator must review and resolve ownership conflicts before retrying; no numbers were changed.'
      : 'Shop SMS routing uniqueness could not be installed. An operator must check schema permissions and index state, then retry before starting the server.';
    throw Object.assign(new Error(message), { code: SHOP_TWILIO_SCHEMA_REQUIRED });
  }
}

module.exports = { ensureShopTwilioNumber, SHOP_TWILIO_NUMBER_UNIQUE, SHOP_TWILIO_SCHEMA_REQUIRED };
