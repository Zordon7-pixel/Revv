const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8');
}

test('claim tracker compares mixed UUID/TEXT IDs as text on both sides', () => {
  const src = source('claimTracker.js');

  assert.match(src, /u\.id::text = e\.uploaded_by::text/);
  assert.match(src, /u\.id::text = c\.logged_by::text/);
  assert.match(src, /u\.id::text = d\.created_by::text/);
  assert.match(src, /e\.ro_id::text = \$1::text AND e\.shop_id::text = \$2::text/);
  assert.match(src, /c\.ro_id::text = \$1::text AND c\.shop_id::text = \$2::text/);
  assert.match(src, /d\.ro_id::text = \$1::text AND d\.shop_id::text = \$2::text/);
});

test('bulk status uses text IDs and does not leak raw postgres operator errors', () => {
  const src = source('ros.js');

  assert.doesNotMatch(src, /ANY\(\$3::uuid\[\]\)/);
  assert.match(src, /id::text = ANY\(\$3::text\[\]\)/);
  assert.match(src, /res\.status\(500\)\.json\(\{ error: 'Bulk status update failed' \}\)/);
});
