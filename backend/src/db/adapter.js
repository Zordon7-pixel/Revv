require('dotenv').config();

const usePostgres = Boolean(process.env.DATABASE_URL);

let sqliteDb = null;
let pgClient = null;

if (usePostgres) {
  pgClient = require('./postgres');
} else {
  sqliteDb = require('./index');
}

async function query(text, params = []) {
  if (usePostgres) {
    return pgClient.query(text, params);
  }

  const stmt = sqliteDb.prepare(text);
  const normalized = text.trim().toUpperCase();

  if (normalized.startsWith('SELECT') || normalized.startsWith('PRAGMA')) {
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  const result = stmt.run(...params);
  return {
    rows: [],
    rowCount: result.changes || 0,
    lastInsertRowid: result.lastInsertRowid,
  };
}

async function get(text, params = []) {
  if (usePostgres) {
    const result = await pgClient.query(text, params);
    return result.rows[0] || null;
  }
  const stmt = sqliteDb.prepare(text);
  return stmt.get(...params) || null;
}

module.exports = {
  query,
  get,
  isPostgres: usePostgres,
  raw: usePostgres ? pgClient : sqliteDb,
};
