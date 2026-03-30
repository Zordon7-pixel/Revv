# REVV Scripts

Utility scripts for demo data, maintenance, and deployment.

## Available Scripts

### seed-demo.js / seed-demo.sh
Demo data seeder for Revv Auto Body Shop.

**Usage:**
```bash
# Node directly (from backend)
cd backend && node ../scripts/seed-demo.js [--force]

# Via npm (from root or backend)
npm run seed:demo                  # Idempotent (skips if exists)
npm run seed:demo:force            # Force wipe and recreate

# Via bash (from root)
bash scripts/seed-demo.sh          # Idempotent
bash scripts/seed-demo.sh --force  # Force wipe
```

**What it creates:**
- 1 shop (Revv Auto Body)
- 4 users (owner, 2 techs, admin)
- 3 realistic repair orders with customers, vehicles, and photos
- 7 placeholder damage photos

**Options:**
- `--force` — Wipe existing demo shop and recreate fresh
- `--db-url <url>` — Custom database connection (overrides DATABASE_URL env)

**Documentation:** See [`../SEED-DEMO.md`](../SEED-DEMO.md)

---

## Setup Instructions

### 1. Install Dependencies
```bash
npm run install:all
```

### 2. Configure Database
```bash
# Copy template
cp backend/.env.example backend/.env

# Edit DATABASE_URL
# Example for local PostgreSQL:
# DATABASE_URL=postgresql://postgres:password@localhost:5432/revv
```

### 3. Run Seed Script
```bash
npm run seed:demo
```

### 4. Start Development
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

### 5. Log In
Use any demo credentials:
- `demo@revvauto.com` / `RevvDemo123!`
- `tech1@revvauto.com` / `TechPass123!`
- `tech2@revvauto.com` / `TechPass123!`
- `admin@revvauto.com` / `AdminPass123!`

---

## Troubleshooting

### PostgreSQL Connection Error
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Verify PostgreSQL is running
brew services list | grep postgres

# If using Railway, verify DATABASE_URL includes full connection string
```

### "Demo shop already exists"
Use `--force` to reset:
```bash
npm run seed:demo:force
```

### Photos not found in uploads/
Check directory exists and has write permissions:
```bash
mkdir -p backend/uploads/photos
chmod 755 backend/uploads/photos
```

---

## File Structure
```
scripts/
├── README.md           ← You are here
├── seed-demo.js        ← Node seed script
└── seed-demo.sh        ← Bash wrapper
```

## Notes
- Scripts are designed to be **idempotent** (safe to run multiple times)
- Demo credentials are for **development/demo only**
- All RO data is realistic and ready for testing workflows
- Photos are valid 1x1 PNG files (placeholder, not real damage images)
