# Demo Seed Script — Pre-Deployment Checklist

Use this checklist before deploying to production or conducting a customer walkthrough.

## Pre-Flight (Run Before Walkthrough)

### Database
- [ ] PostgreSQL is running (`brew services list`)
- [ ] DATABASE_URL is configured in `backend/.env`
- [ ] Database exists and schema is initialized
  ```bash
  # To initialize schema, start backend once:
  cd backend && npm start
  # Then stop with Ctrl+C
  ```

### Dependencies
- [ ] Dependencies installed
  ```bash
  npm run install:all
  ```

### Reset Demo Data
- [ ] Run seed script to populate fresh demo
  ```bash
  npm run seed:demo:force
  ```
  Expected output:
  ```
  ✅ Demo seed complete!
  📊 Created:
     • 1 shop (Revv Auto Body)
     • 4 users
     • 3 repair orders
     • 7 sample photos
  ```

## Startup (Walkthrough Day)

### Backend
- [ ] Start backend from `backend/` directory
  ```bash
  npm run dev
  # Should start on port 3000 (or configured PORT)
  # Check no errors in console
  ```

### Frontend
- [ ] Start frontend from `frontend/` directory (new terminal)
  ```bash
  npm run dev
  # Should open http://localhost:5173
  # Check no build errors
  ```

### Health Check
- [ ] Backend API responds
  ```bash
  curl http://localhost:3000/health || curl http://localhost:3000
  ```
- [ ] Frontend loads without errors
  ```bash
  open http://localhost:5173
  # Check console for errors (F12)
  ```

### Authentication
- [ ] Can log in with demo credentials
  - Email: `demo@revvauto.com`
  - Password: `RevvDemo123!`
- [ ] Dashboard loads after login
- [ ] Navigation works (sidebar, links)

## Demo Workflow

### Shop Overview
- [ ] Shop name displays: "Revv Auto Body"
- [ ] 3 repair orders are visible
- [ ] Order statuses are correct:
  - RO #001 — `repair` (Honda Accord)
  - RO #002 — `estimate` (Tesla Model 3)
  - RO #003 — `parts` (Ford F-150)

### Repair Order Details
- [ ] Click RO #001 — view all fields:
  - [ ] Customer: John Smith | (202) 555-1234
  - [ ] Vehicle: 2024 Honda Accord, Silver
  - [ ] Status: In Progress
  - [ ] Parts: $5,200
  - [ ] Labor: $3,300
  - [ ] Photos load (3 damage shots)
  - [ ] Insurance: Progressive
  - [ ] Claim: CLM-2026-001

- [ ] Click RO #002 — view estimate:
  - [ ] Customer: Sarah Johnson | (301) 555-2345
  - [ ] Vehicle: 2022 Tesla Model 3, Pearl White
  - [ ] Status: Estimate Ready
  - [ ] Parts: $6,500
  - [ ] Labor: $5,500
  - [ ] Photos load (2 damage shots)

- [ ] Click RO #003 — view parts order:
  - [ ] Customer: Mike Rodriguez | (240) 555-3456
  - [ ] Vehicle: 2018 Ford F-150, Black
  - [ ] Status: Waiting for Parts
  - [ ] Photos load (2 damage shots)

### User Management (if accessible)
- [ ] Can see 4 users:
  - demo@revvauto.com (owner)
  - tech1@revvauto.com (employee)
  - tech2@revvauto.com (employee)
  - admin@revvauto.com (owner)

- [ ] Can log in as other users:
  - [ ] tech1@revvauto.com / TechPass123!
  - [ ] admin@revvauto.com / AdminPass123!

## Recovery

### If Demo Gets Corrupted
Reset with force flag:
```bash
npm run seed:demo:force
```
Wait for completion, then refresh browser.

### If Database Connection Fails
1. Check DATABASE_URL
   ```bash
   grep DATABASE_URL backend/.env
   ```
2. Verify PostgreSQL is running
   ```bash
   brew services list | grep postgres
   ```
3. Try connecting directly
   ```bash
   psql $DATABASE_URL -c "SELECT version();"
   ```

### If Frontend Won't Load
1. Clear cache
   ```bash
   # In browser: Hard refresh (Cmd+Shift+R on Mac)
   ```
2. Restart frontend
   ```bash
   cd frontend && npm run dev
   ```

### If Backend Crashes
1. Check logs for errors
2. Restart backend
   ```bash
   cd backend && npm run dev
   ```

## Post-Demo

### Cleanup
- [ ] Stop both terminals (Ctrl+C)
- [ ] Commit any changes to git (if applicable)

### Notes for Next Demo
- [ ] Any issues encountered → document in `MISTAKES.md`
- [ ] Any feature requests → add to `tasks.json`
- [ ] Demo duration: ~30 min

---

## Quick Commands Reference

```bash
# Setup (one-time)
npm run install:all
cp backend/.env.example backend/.env
# Edit DATABASE_URL in backend/.env

# Reset demo data
npm run seed:demo          # Idempotent
npm run seed:demo:force    # Force wipe & recreate

# Start development
# Terminal 1:
cd backend && npm run dev

# Terminal 2:
cd frontend && npm run dev

# Test database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM shops;"

# View demo credentials
grep -A 5 "📋 Demo Credentials" SEED-DEMO.md
```

---

**Pro Tip:** Keep this checklist open in a browser tab before demos. Copy it and check off as you go.

Last Updated: 2026-03-30
