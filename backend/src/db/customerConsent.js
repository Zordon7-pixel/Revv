// One query per direction: PostgreSQL executes each multi-statement query
// atomically, on one connection. Keep the ledger/columns/trigger on rollback:
// historical TRUE is restored only as historical data, never invented evidence.
const upSql = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN;
ALTER TABLE customers ALTER COLUMN sms_consent SET DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent_method TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent_revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS customer_consent_migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), rolled_back_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS customer_consent_resets (
  customer_id TEXT NOT NULL, shop_id TEXT, prior_consent BOOLEAN,
  prior_at TIMESTAMPTZ, prior_method TEXT, prior_by TEXT,
  reset_revision BIGINT NOT NULL, reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL, restored_at TIMESTAMPTZ, PRIMARY KEY(customer_id)
);
CREATE OR REPLACE FUNCTION advance_customer_consent_revision() RETURNS trigger AS $$
BEGIN
  NEW.sms_consent_revision := OLD.sms_consent_revision + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS customer_consent_revision_write ON customers;
CREATE TRIGGER customer_consent_revision_write
BEFORE UPDATE OF sms_consent, sms_consent_at, sms_consent_method, sms_consent_by ON customers
FOR EACH ROW EXECUTE FUNCTION advance_customer_consent_revision();
LOCK TABLE customers IN SHARE ROW EXCLUSIVE MODE;
WITH first_run AS (
  INSERT INTO customer_consent_migrations(name) VALUES ('explicit_sms_consent_v1')
  ON CONFLICT DO NOTHING RETURNING name
), audited AS (
  INSERT INTO customer_consent_resets
    (customer_id, shop_id, prior_consent, prior_at, prior_method, prior_by, reset_revision, reason)
  SELECT id::text, shop_id::text, sms_consent, sms_consent_at, sms_consent_method, sms_consent_by,
    sms_consent_revision + 1, 'Legacy TRUE without complete explicit provenance'
  FROM customers WHERE EXISTS (SELECT 1 FROM first_run) AND sms_consent IS TRUE
    AND NOT (sms_consent_at IS NOT NULL AND isfinite(sms_consent_at)
      AND COALESCE(sms_consent_method IN ('verbal','written'), FALSE)
      AND COALESCE(length(trim(sms_consent_by)) > 0, FALSE))
  RETURNING customer_id, shop_id
)
UPDATE customers c SET sms_consent = FALSE
FROM audited a WHERE c.id::text = a.customer_id AND c.shop_id::text IS NOT DISTINCT FROM a.shop_id;
`;

const downSql = `
LOCK TABLE customers IN SHARE ROW EXCLUSIVE MODE;
WITH restored AS (
  UPDATE customers c SET sms_consent = a.prior_consent,
    sms_consent_at = a.prior_at, sms_consent_method = a.prior_method, sms_consent_by = a.prior_by
  FROM customer_consent_resets a
  WHERE c.id::text = a.customer_id AND c.shop_id::text IS NOT DISTINCT FROM a.shop_id
    AND a.restored_at IS NULL AND c.sms_consent_revision = a.reset_revision
    AND c.sms_consent IS FALSE
    AND c.sms_consent_at IS NOT DISTINCT FROM a.prior_at
    AND c.sms_consent_method IS NOT DISTINCT FROM a.prior_method
    AND c.sms_consent_by IS NOT DISTINCT FROM a.prior_by
    AND EXISTS (SELECT 1 FROM customer_consent_migrations
      WHERE name = 'explicit_sms_consent_v1' AND rolled_back_at IS NULL)
  RETURNING c.id::text AS id
)
UPDATE customer_consent_resets a SET restored_at = now() FROM restored r WHERE a.customer_id = r.id;
UPDATE customer_consent_migrations SET rolled_back_at = COALESCE(rolled_back_at, now())
WHERE name = 'explicit_sms_consent_v1';
`;

async function up(db) { await db.query(upSql); }
async function down(db) { await db.query(downSql); }
module.exports = { up, down };
