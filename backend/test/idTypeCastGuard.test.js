const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const routeFiles = fs.readdirSync(routesDir)
  .filter(file => file.endsWith('.js'))
  .sort();

function routeSource(file) {
  return fs.readFileSync(path.join(routesDir, file), 'utf8');
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function failuresMessage(failures) {
  return failures.map(({ file, line, text }) => `${file}:${line}: ${text}`).join('\n');
}

test('routes do not cast request id parameters back to uuid', () => {
  const failures = [];
  const forbiddenCast = /=\s*(?:ANY\s*\(\s*)?\$\d+::uuid(?:\[\])?/gi;

  for (const file of routeFiles) {
    const src = routeSource(file);
    for (const match of src.matchAll(forbiddenCast)) {
      failures.push({
        file,
        line: lineNumber(src, match.index),
        text: match[0],
      });
    }
  }

  assert.equal(failures.length, 0, failuresMessage(failures));
});

test('mixed id joins keep text casts on both sides', () => {
  const failures = [];
  const mixedTables = new Set([
    'analytics_events',
    'estimate_requests',
    'inspections',
    'notifications',
    'parts_inventory',
    'proof_packet_links',
    'rental_inventory_items',
    'ro_internal_notes',
    'ro_inventory_items',
    'ro_supplements',
    'shop_reviews',
    'sms_messages',
    'storage_charges',
    'vehicle_diagnostic_scans',
  ]);
  const parentTables = new Set(['repair_orders', 'shops', 'customers', 'vehicles']);
  const joinWithOn = /\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+|CROSS\s+)?JOIN\s+([a-z_][a-z0-9_]*)\s+([a-z_][a-z0-9_]*)\s+ON\s+([\s\S]*?)(?=\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+|CROSS\s+)?JOIN\b|\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|[`'"];)/gi;
  const comparison = /([a-z_][a-z0-9_]*\.(?:id|[a-z0-9_]+_id)(?:::text)?)\s*=\s*([a-z_][a-z0-9_]*\.(?:id|[a-z0-9_]+_id)(?:::text)?)/gi;

  for (const file of routeFiles) {
    const src = routeSource(file);
    const notificationAliases = new Set();
    for (const tableRef of src.matchAll(/\b(?:FROM|JOIN)\s+notifications\s+([a-z_][a-z0-9_]*)/gi)) {
      notificationAliases.add(tableRef[1]);
    }

    for (const join of src.matchAll(joinWithOn)) {
      const [, table, alias, onPredicate] = join;
      const aliasToTable = new Map([[alias, table]]);
      const touchesGuardedJoinTable = parentTables.has(table) || table === 'notifications';

      for (const predicate of onPredicate.matchAll(comparison)) {
        const [fullComparison, left, right] = predicate;
        const leftAlias = left.split('.')[0];
        const rightAlias = right.split('.')[0];
        const leftTable = aliasToTable.get(leftAlias);
        const rightTable = aliasToTable.get(rightAlias);
        const touchesMixedTable =
          mixedTables.has(table) ||
          mixedTables.has(leftTable) ||
          mixedTables.has(rightTable) ||
          table === 'notifications' ||
          leftTable === 'notifications' ||
          rightTable === 'notifications' ||
          notificationAliases.has(leftAlias) ||
          notificationAliases.has(rightAlias);

        if (touchesGuardedJoinTable && touchesMixedTable && (!left.endsWith('::text') || !right.endsWith('::text'))) {
          failures.push({
            file,
            line: lineNumber(src, join.index + predicate.index),
            text: fullComparison.trim(),
          });
        }
      }
    }
  }

  assert.equal(failures.length, 0, failuresMessage(failures));
});

test('claim tracker compares mixed UUID/TEXT IDs as text on both sides', () => {
  const src = routeSource('claimTracker.js');

  assert.match(src, /u\.id::text = e\.uploaded_by::text/);
  assert.match(src, /u\.id::text = c\.logged_by::text/);
  assert.match(src, /u\.id::text = d\.created_by::text/);
  assert.match(src, /e\.ro_id::text = \$1::text AND e\.shop_id::text = \$2::text/);
  assert.match(src, /c\.ro_id::text = \$1::text AND c\.shop_id::text = \$2::text/);
  assert.match(src, /d\.ro_id::text = \$1::text AND d\.shop_id::text = \$2::text/);
});

test('bulk status uses text IDs and does not leak raw postgres operator errors', () => {
  const src = routeSource('ros.js');

  assert.doesNotMatch(src, /ANY\(\$3::uuid\[\]\)/);
  assert.match(src, /id::text = ANY\(\$3::text\[\]\)/);
  assert.match(src, /res\.status\(500\)\.json\(\{ error: 'Bulk status update failed' \}\)/);
});
