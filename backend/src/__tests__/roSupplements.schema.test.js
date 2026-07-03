const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const srcRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
}

function firstRoSupplementsCreateBlock(source) {
  const match = source.match(/CREATE TABLE IF NOT EXISTS ro_supplements \(([\s\S]*?)\n\s*\);/);
  assert.ok(match, 'ro_supplements CREATE TABLE block exists');
  return match[1];
}

test('initDb ro_supplements schema includes columns required by supplement inserts', () => {
  const indexSource = read('db/index.js');
  const createBlock = firstRoSupplementsCreateBlock(indexSource);

  assert.match(createBlock, /\bdescription\s+TEXT\s+NOT NULL\s+DEFAULT\s+''/i);
  assert.match(createBlock, /\bamount\s+NUMERIC\(12,2\)\s+NOT NULL\s+DEFAULT\s+0/i);
  assert.match(createBlock, /\bsubmitted_date\s+DATE\s+NOT NULL\s+DEFAULT\s+CURRENT_DATE/i);

  assert.match(indexSource, /ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''/i);
  assert.match(indexSource, /ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS amount NUMERIC\(12,2\) NOT NULL DEFAULT 0/i);
  assert.match(indexSource, /ALTER TABLE ro_supplements ADD COLUMN IF NOT EXISTS submitted_date DATE NOT NULL DEFAULT CURRENT_DATE/i);
});

test('migrate and initDb both declare the supplement insert contract columns', () => {
  const indexBlock = firstRoSupplementsCreateBlock(read('db/index.js'));
  const migrateBlock = firstRoSupplementsCreateBlock(read('db/migrate.js'));

  for (const column of ['description', 'amount', 'amount_cents', 'status', 'submitted_date', 'notes', 'created_at', 'updated_at']) {
    assert.match(indexBlock, new RegExp(`\\b${column}\\b`, 'i'), `index.js declares ${column}`);
    assert.match(migrateBlock, new RegExp(`\\b${column}\\b`, 'i'), `migrate.js declares ${column}`);
  }
});
