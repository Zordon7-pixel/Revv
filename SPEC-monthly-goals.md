# SPEC: Monthly Goals Feature

## Overview
Add a Monthly Goals system to REVV that lets shop owners set monthly revenue and RO targets, and track progress on the Dashboard.

## User Story
As a shop owner, I want to set a monthly revenue target and RO count target so I can see at a glance how my shop is tracking toward its goals.

## Scope

### Backend
1. **New table: `shop_goals`**
   ```sql
   CREATE TABLE IF NOT EXISTS shop_goals (
     id SERIAL PRIMARY KEY,
     shop_id INTEGER NOT NULL REFERENCES shops(id),
     month INTEGER NOT NULL,         -- 1-12
     year INTEGER NOT NULL,
     revenue_goal NUMERIC(10,2),     -- monthly revenue target in dollars
     ro_goal INTEGER,                -- monthly RO completion target
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(shop_id, month, year)
   );
   ```

2. **New route file: `backend/src/routes/goals.js`**
   - `GET /api/goals?month=M&year=Y` — fetch current goal for shop (scoped to `req.user.shop_id`)
   - `POST /api/goals` — upsert goal for given month/year `{ month, year, revenue_goal, ro_goal }`
   - All routes require auth middleware

3. **Register in `app.js`:**
   ```js
   const goalsRouter = require('./routes/goals');
   app.use('/api/goals', require('./middleware/auth'), goalsRouter);
   ```

4. **Create table in `initDb()` in `app.js`** — add the `shop_goals` CREATE TABLE IF NOT EXISTS block alongside existing table creation.

### Frontend
1. **Dashboard.jsx — Goals Progress Section**
   - Fetch current month's goals from `GET /api/goals?month=M&year=Y`
   - If no goal set: show "Set a goal" prompt with pencil icon (opens modal)
   - If goal set: show two progress bars side by side
     - Revenue: `$X,XXX / $X,XXX` with % fill (green when ≥ 100%)
     - ROs Completed: `X / X` with % fill (green when ≥ 100%)
   - Add a small edit icon (pencil) to open the set-goal modal when goals exist

2. **GoalModal component (can be inline in Dashboard.jsx)**
   - Two inputs: "Revenue Goal ($)" and "RO Completion Goal"
   - Current month/year auto-populated, displayed as label ("April 2026 Goals")
   - Save button → `POST /api/goals` → refreshes goal data
   - Cancel button closes modal

3. **Styling:** Match existing REVV dark theme (slate backgrounds, amber accents). Progress bar uses amber fill, transitions to green at 100%.

## Auth & Security
- All `/api/goals` routes scoped to `req.user.shop_id` — no cross-shop access
- Input validation: `revenue_goal` must be positive number, `ro_goal` must be positive integer

## Files to Touch
- `backend/src/app.js` — add table init + route registration
- `backend/src/routes/goals.js` — NEW FILE
- `frontend/src/pages/Dashboard.jsx` — add goals section + modal

## Build Order
1. Backend first: create `goals.js` route + table init in `app.js`
2. Frontend: add goals fetch, progress bars, and modal to Dashboard.jsx
3. Rebuild frontend dist: `cd frontend && npm run build`
4. Commit all: backend routes, app.js changes, frontend/src changes, frontend/dist

## DO NOT TOUCH
- `frontend/dist/` — Codex builds this; commit the new dist after vite build
- Any other route files (ros.js, sms.js, auth.js, etc.)
- `.env` or Railway environment variables

## Commit Message
`feat(goals): monthly revenue and RO goals with dashboard progress tracking`
