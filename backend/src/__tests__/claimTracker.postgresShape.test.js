const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../routes/claimTracker.js'),
  'utf8'
);

test('claim tracker user joins cast users.id to text for legacy text actor columns', () => {
  assert.doesNotMatch(
    routeSource,
    /LEFT JOIN users u ON u\.id = [ecd]\.(?:uploaded_by|logged_by|created_by)/,
    'Expected no uuid-vs-text joins between users.id and claim tracker actor columns'
  );

  assert.equal(
    (routeSource.match(/LEFT JOIN users u ON u\.id::text = e\.uploaded_by/g) || []).length,
    2,
    'Expected GET and POST evidence return queries to cast users.id to text'
  );
  assert.equal(
    (routeSource.match(/LEFT JOIN users u ON u\.id::text = c\.logged_by/g) || []).length,
    2,
    'Expected GET and POST contact return queries to cast users.id to text'
  );
  assert.equal(
    (routeSource.match(/LEFT JOIN users u ON u\.id::text = d\.created_by/g) || []).length,
    2,
    'Expected GET and POST dispute return queries to cast users.id to text'
  );
});
