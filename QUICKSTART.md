# REVV Quick Start — Demo Seed

Get up and running with demo data in under 5 minutes.

## 1. Setup (2 min)
```bash
# Install dependencies
npm run install:all

# Copy env template and configure database
cp backend/.env.example backend/.env

# Edit DATABASE_URL in backend/.env
# Example (local PostgreSQL):
# DATABASE_URL=postgresql://postgres:password@localhost:5432/revv
```

## 2. Seed Demo Data (30 sec)
```bash
npm run seed:demo
```

This creates:
- ✅ 1 shop (Revv Auto Body)
- ✅ 4 users (owner, 2 techs, admin)
- ✅ 3 repair orders (Honda, Tesla, Ford)
- ✅ 7 damage photos

## 3. Start Development (1 min)
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend (new terminal)
cd frontend && npm run dev

# Frontend opens at: http://localhost:5173
```

## 4. Log In
Use any of these:
| Email | Password |
|-------|----------|
| demo@revvauto.com | RevvDemo123! |
| tech1@revvauto.com | TechPass123! |
| tech2@revvauto.com | TechPass123! |
| admin@revvauto.com | AdminPass123! |

## 5. Explore
- 👀 View 3 repair orders (different statuses)
- 📸 See damage photos
- 👥 Manage customers & vehicles
- 🛠️ Assign techs to jobs

## Reset Demo Data
Before another demo or walkthrough:
```bash
npm run seed:demo:force
```

This wipes the old demo shop and creates fresh data.

---

## Troubleshooting

**"No .env file"**
```bash
cp backend/.env.example backend/.env
```

**"connect ECONNREFUSED"**
PostgreSQL isn't running. Start it:
```bash
brew services start postgresql
```

**"relation \"shops\" does not exist"**
Database schema missing. Run backend once to auto-create:
```bash
cd backend && npm start
```
Then stop (Ctrl+C) and try seed again.

**"Demo shop already exists"**
Reset with `--force`:
```bash
npm run seed:demo:force
```

---

For more details, see:
- [`SEED-DEMO.md`](./SEED-DEMO.md) — Full seed documentation
- [`scripts/README.md`](./scripts/README.md) — Script details
