const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
const rejectUnauthorized = String(process.env.PGSSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true';

if (!connectionString) {
  throw new Error('DATABASE_URL is required for PostgreSQL connection');
}

const pool = new Pool({
  connectionString,
  ssl: sslMode === 'disable'
    ? false
    : { rejectUnauthorized },
});

async function query(text, params = []) {
  return pool.query(text, params);
}

module.exports = {
  pool,
  query,
};
