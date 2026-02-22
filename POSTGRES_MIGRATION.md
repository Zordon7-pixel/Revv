# PostgreSQL Migration Guide

## When to run
- Before accepting real paying customers
- After upgrading Railway to paid plan

## Steps
1. Add Railway PostgreSQL add-on
2. Copy DATABASE_URL from Railway PostgreSQL service
3. Set DATABASE_URL in the app service environment variables
4. Push — app auto-runs migrations on startup

## Files changed
- backend/src/db/postgres.js — pg connection pool
- backend/src/db/schema.pg.sql — full PostgreSQL schema
- backend/src/db/migrate.js — migration runner
- backend/src/db/seed.pg.js — PostgreSQL seed data
- backend/src/db/adapter.js — SQLite/PG abstraction layer

## Route migration (when ready)
Each route file needs async/await added and db.prepare().all() → adapter.query() swapped.
Estimated: 2-3 hours with Codex.
