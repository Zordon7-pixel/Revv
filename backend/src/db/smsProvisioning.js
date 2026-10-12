'use strict';

// No foreign-key cascade: purchase evidence must survive shop deletion and rollback.
// TEXT identities intentionally support both legacy TEXT and UUID shops.
async function up(db) {
  await db.query(`
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_phone_sid TEXT;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_messaging_service_sid TEXT;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_sender_mode TEXT;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS twilio_sender_updated_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS sms_provision_control (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      run_id TEXT UNIQUE,
      purchase_cap INTEGER CHECK (purchase_cap BETWEEN 0 AND 1000),
      consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
      CHECK (consumed <= purchase_cap)
    );
    INSERT INTO sms_provision_control(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS sms_provision_mapping (
      shop_id TEXT PRIMARY KEY,
      account_sid TEXT NOT NULL,
      service_sid TEXT NOT NULL UNIQUE,
      campaign_sid TEXT NOT NULL UNIQUE,
      brand_sid TEXT NOT NULL,
      authorization_ref TEXT NOT NULL CHECK (length(authorization_ref) > 0)
    );
    CREATE TABLE IF NOT EXISTS sms_provision_jobs (
      shop_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','failed')),
      reason TEXT NOT NULL DEFAULT 'DISCOVERED',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      admin_attention BOOLEAN NOT NULL DEFAULT FALSE,
      binding JSONB,
      intent_id UUID UNIQUE,
      candidate TEXT,
      run_id TEXT,
      phone_sid TEXT,
      phone_number TEXT,
      registration_source TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((intent_id IS NULL) = (candidate IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sms_provision_candidate_unique
      ON sms_provision_jobs ((binding->>'account_sid'), candidate) WHERE candidate IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS sms_provision_phone_unique
      ON sms_provision_jobs (phone_sid) WHERE phone_sid IS NOT NULL;
    CREATE TABLE IF NOT EXISTS sms_provision_history (
      id BIGSERIAL PRIMARY KEY,
      shop_id TEXT NOT NULL,
      event TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sms_provision_alerts (
      code TEXT PRIMARY KEY,
      next_at TIMESTAMPTZ NOT NULL
    );
  `);
}

// Logical rollback is deliberately non-destructive. up() does not undo this pause.
async function down(db) {
  await db.query(`UPDATE sms_provision_control SET enabled=FALSE;
    UPDATE sms_provision_jobs SET admin_attention=TRUE, updated_at=now();`);
}
module.exports = { up, down };
