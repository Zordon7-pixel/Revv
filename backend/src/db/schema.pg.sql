CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  onboarded BOOLEAN DEFAULT FALSE,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  market_tier INTEGER DEFAULT 3,
  labor_rate NUMERIC(10,2) DEFAULT 62,
  parts_markup NUMERIC(8,4) DEFAULT 0.30,
  tax_rate NUMERIC(8,4) DEFAULT 0.0700,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geofence_radius DOUBLE PRECISION DEFAULT 0.5,
  tracking_api_key TEXT,
  sms_notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  customer_id UUID,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  insurance_company TEXT,
  policy_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS fk_users_customer_id
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT,
  color TEXT,
  plate TEXT,
  mileage INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_orders (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  ro_number TEXT UNIQUE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  job_type TEXT DEFAULT 'collision',
  status TEXT DEFAULT 'intake',
  payment_type TEXT DEFAULT 'insurance',
  payment_status TEXT DEFAULT 'unpaid',
  claim_number TEXT,
  insurer TEXT,
  adjuster_name TEXT,
  adjuster_phone TEXT,
  adjuster_email TEXT,
  deductible NUMERIC(12,2) DEFAULT 0,
  intake_date TIMESTAMPTZ,
  estimated_delivery TIMESTAMPTZ,
  actual_delivery TIMESTAMPTZ,
  parts_cost NUMERIC(12,2) DEFAULT 0,
  labor_cost NUMERIC(12,2) DEFAULT 0,
  sublet_cost NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  deductible_waived NUMERIC(12,2) DEFAULT 0,
  referral_fee NUMERIC(12,2) DEFAULT 0,
  goodwill_repair_cost NUMERIC(12,2) DEFAULT 0,
  true_profit NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_status_log (
  id UUID PRIMARY KEY,
  ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ro_payments (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT DEFAULT 'pending',
  payment_method TEXT,
  receipt_email TEXT,
  paid_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parts_orders (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_number TEXT,
  vendor TEXT,
  quantity INTEGER DEFAULT 1,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'ordered',
  ordered_date TIMESTAMPTZ,
  expected_date TIMESTAMPTZ,
  received_date TIMESTAMPTZ,
  notes TEXT,
  tracking_number TEXT,
  carrier TEXT,
  tracking_status TEXT,
  tracking_detail TEXT,
  tracking_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  notes TEXT,
  lunch_break_minutes INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lunch_breaks (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  lunch_start TIMESTAMPTZ,
  lunch_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  ro_id UUID REFERENCES repair_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  clock_in_lat DOUBLE PRECISION,
  clock_in_lng DOUBLE PRECISION,
  clock_out_lat DOUBLE PRECISION,
  clock_out_lng DOUBLE PRECISION,
  scheduled_start TIMESTAMPTZ,
  is_late INTEGER DEFAULT 0,
  late_minutes INTEGER DEFAULT 0,
  total_hours NUMERIC(8,2),
  adjusted_by TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_config (
  id BIGSERIAL PRIMARY KEY,
  shop_id UUID UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  market_tier INTEGER DEFAULT 3,
  labor_rate NUMERIC(10,2) DEFAULT 62,
  parts_markup NUMERIC(8,4) DEFAULT 0.30,
  tax_rate NUMERIC(8,4) DEFAULT 0.0700,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geofence_radius DOUBLE PRECISION DEFAULT 0.5,
  tracking_api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_links (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  ro_id UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  adjustor_name TEXT,
  adjustor_company TEXT,
  adjustor_email TEXT,
  approved_labor NUMERIC(12,2),
  approved_parts NUMERIC(12,2),
  supplement_amount NUMERIC(12,2),
  adjustor_notes TEXT,
  assessment_filename TEXT,
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_shop_id ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_shop_id ON vehicles(shop_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_shop_id ON repair_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_vehicle_id ON repair_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_customer_id ON repair_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_status ON repair_orders(status);
CREATE INDEX IF NOT EXISTS idx_job_status_log_ro_id ON job_status_log(ro_id);
CREATE INDEX IF NOT EXISTS idx_ro_payments_shop_id ON ro_payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_ro_payments_ro_id ON ro_payments(ro_id);
CREATE INDEX IF NOT EXISTS idx_ro_payments_pi_id ON ro_payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_parts_orders_shop_id ON parts_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_parts_orders_ro_id ON parts_orders(ro_id);
CREATE INDEX IF NOT EXISTS idx_parts_orders_status ON parts_orders(status);
CREATE INDEX IF NOT EXISTS idx_schedules_shop_id ON schedules(shop_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_date ON schedules(user_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_shop_id ON time_entries(shop_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_open_clock ON time_entries(shop_id, user_id, clock_out);
CREATE INDEX IF NOT EXISTS idx_market_config_shop_id ON market_config(shop_id);
CREATE INDEX IF NOT EXISTS idx_claim_links_shop_id ON claim_links(shop_id);
CREATE INDEX IF NOT EXISTS idx_claim_links_ro_id ON claim_links(ro_id);
CREATE INDEX IF NOT EXISTS idx_claim_links_token ON claim_links(token);
