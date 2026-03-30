# REVV Demo Seed Script

One-command seed script that populates demo data for Revv Auto Body Shop — ideal for walkthroughs, testing, and demos.

## What It Creates

### Shop
- **Name:** Revv Auto Body
- **Address:** 123 Collision Way, Brentwood MD 20722
- **Phone:** (202) 555-0100
- **Labor Rate:** $95/hr
- **Parts Markup:** 40%
- **Tax Rate:** 8.75%

### Users (4 total)
| Email | Role | Password |
|-------|------|----------|
| demo@revvauto.com | Owner | RevvDemo123! |
| tech1@revvauto.com | Technician | TechPass123! |
| tech2@revvauto.com | Technician | TechPass123! |
| admin@revvauto.com | Owner/Admin | AdminPass123! |

### Repair Orders (3 total)

#### RO #001 — 2024 Honda Accord Front Collision
- **Customer:** John Smith | (202) 555-1234
- **Vehicle:** 2024 Honda Accord (Silver, LIC: DEMO001)
- **Status:** In Progress (day 2 of 5)
- **Estimate:** $8,500 (parts $5.2K, labor $3.3K)
- **Insurance:** Progressive (claim CLM-2026-001)
- **Deductible:** $500 (waived)
- **Notes:** Frame alignment, headlight replacement
- **Photos:** 3 damage shots

#### RO #002 — 2022 Tesla Model 3 Hail Damage
- **Customer:** Sarah Johnson | (301) 555-2345
- **Vehicle:** 2022 Tesla Model 3 (Pearl White, LIC: DEMO002)
- **Status:** Estimate Ready (awaiting approval)
- **Estimate:** $12,000 (dent repair + repaint, 12+ panels)
- **Insurance:** Allstate (claim CLM-2026-002)
- **Deductible:** $500 (not waived)
- **Notes:** Hail damage — PDR vs. repaint decision
- **Photos:** 2 damage shots

#### RO #003 — 2018 Ford F-150 Frame Damage
- **Customer:** Mike Rodriguez | (240) 555-3456
- **Vehicle:** 2018 Ford F-150 (Black, LIC: DEMO003)
- **Status:** Waiting for Parts (ETA: 3/31)
- **Estimate:** $6,200 (frame, suspension, alignment)
- **Insurance:** Geico (claim CLM-2026-003)
- **Deductible:** $500 (not waived)
- **Notes:** Frame straightening, suspension rebuild, wheel alignment
- **Photos:** 2 damage shots

## Usage

### Option 1: npm (Root or Backend)
```bash
# From root directory
npm run seed:demo

# With --force flag (wipe and recreate)
npm run seed:demo:force
```

### Option 2: bash (Root or Backend)
```bash
# From root directory
bash scripts/seed-demo.sh

# With --force flag
bash scripts/seed-demo.sh --force
```

### Option 3: Direct Node
```bash
cd backend
node ../scripts/seed-demo.js

# With --force flag
node ../scripts/seed-demo.js --force
```

## Requirements

### Setup
1. **PostgreSQL running** — local or Railway
2. **.env file configured**
   ```bash
   # Copy template
   cp backend/.env.example backend/.env
   
   # Edit DATABASE_URL
   export DATABASE_URL="postgresql://user:password@localhost:5432/revv"
   ```
3. **Dependencies installed**
   ```bash
   npm run install:all
   ```
4. **Schema migrated** (if fresh database)
   ```bash
   # Schema is created automatically on first connection
   ```

## Behavior

### Idempotent Mode (Default)
By default, the script is **idempotent** — it checks if the demo shop already exists:
- ✅ If demo shop **does NOT exist** → creates all data
- ⏭️ If demo shop **already exists** → skips (prints message)
- 🔄 To force wipe and recreate → use `--force` flag

### Force Mode (`--force`)
Wipes the existing demo shop (and all its data) and recreates it fresh:
```bash
npm run seed:demo:force
```
Use this to reset demo data before a customer walkthrough or presentation.

## Output

```
🚀 REVV Demo Seed Script
📅 Timestamp: 2026-03-30T10:21:00Z

📦 Creating shop...
   ✓ Shop: Revv Auto Body (123 Collision Way)
👥 Creating users...
   ✓ Demo Owner (demo@revvauto.com) — owner
   ✓ Tech 1 (tech1@revvauto.com) — employee
   ✓ Tech 2 (tech2@revvauto.com) — employee
   ✓ Admin (admin@revvauto.com) — owner
🛠️  Creating repair orders...
   ✓ RO #001 — John Smith / 2024 Honda Accord — repair
      📸 Generated 3 placeholder photos
   ✓ RO #002 — Sarah Johnson / 2022 Tesla Model 3 — estimate
      📸 Generated 2 placeholder photos
   ✓ RO #003 — Mike Rodriguez / 2018 Ford F-150 — parts
      📸 Generated 2 placeholder photos

✅ Demo seed complete!

📋 Demo Credentials:
   demo@revvauto.com / RevvDemo123!
   tech1@revvauto.com / TechPass123!
   tech2@revvauto.com / TechPass123!
   admin@revvauto.com / AdminPass123!

📊 Created:
   • 1 shop (Revv Auto Body)
   • 4 users
   • 3 repair orders
   • 7 sample photos
```

## Files

- **Script:** `scripts/seed-demo.js` — Node.js seed script
- **Wrapper:** `scripts/seed-demo.sh` — Bash wrapper for convenience
- **Docs:** `SEED-DEMO.md` — this file
- **Photos:** Generated in `backend/uploads/photos/` as placeholder PNGs

## Troubleshooting

### "No .env file found"
```bash
cp backend/.env.example backend/.env
# Edit DATABASE_URL in backend/.env
```

### "connect ECONNREFUSED"
PostgreSQL is not running. Check:
```bash
# Local PostgreSQL
brew services list | grep postgres

# Railway PostgreSQL
# Check DATABASE_URL is correct
echo $DATABASE_URL
```

### "relation \"shops\" does not exist"
Database schema hasn't been created. The schema is created automatically on first app startup.
Try running the backend once:
```bash
cd backend && npm start
```
(Then stop it with Ctrl+C)

### "Demo shop already exists"
Use `--force` to wipe and recreate:
```bash
npm run seed:demo:force
```

### Photo files not creating
Check write permissions on `backend/uploads/photos/`:
```bash
ls -la backend/uploads/photos/
chmod 755 backend/uploads/photos/
```

## Demo Workflow

Typical walkthrough:
1. **Reset demo data** → `npm run seed:demo:force`
2. **Start backend** → `npm start` (from backend dir)
3. **Start frontend** → `npm run dev` (from frontend dir, in another terminal)
4. **Log in** → Use any demo credentials above
5. **Navigate** → View ROs, assign techs, track progress, generate estimates

## Customization

To modify demo data, edit `scripts/seed-demo.js`:
- `DEMO_CONFIG.shop` — shop details
- `DEMO_CONFIG.users` — user credentials
- `DEMO_CONFIG.ros` — repair order templates

Then re-seed:
```bash
npm run seed:demo:force
```

## Notes

- ✅ Script is **safe** to run multiple times (idempotent by default)
- ✅ Photos are **placeholder PNGs** (1x1 pixel valid files, not corrupted)
- ✅ Credentials are **demo-only** — change in production
- ✅ Respects existing data unless `--force` is used
- ❌ Never runs without explicit database configuration (.env file)
