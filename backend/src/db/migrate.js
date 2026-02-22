const fs = require('fs');
const path = require('path');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set, skipping PostgreSQL migrations.');
    return;
  }

  const { pool, query } = require('./postgres');
  const schemaPath = path.join(__dirname, 'schema.pg.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    const exists = await query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists`
    );

    if (!exists.rows[0]?.exists) {
      await query(schemaSql);
      console.log('PostgreSQL schema created.');
    } else {
      await query(schemaSql);
      console.log('PostgreSQL schema already exists; ensured idempotent statements.');
    }
  } finally {
    await pool.end();
  }
}

module.exports = { runMigrations };
