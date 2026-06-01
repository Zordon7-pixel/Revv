const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { disallowAssistant } = require('../middleware/roles');

function runMiddleware(req) {
  let statusCode = null;
  let body = null;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  disallowAssistant(req, res, () => {
    nextCalled = true;
  });

  return { statusCode, body, nextCalled };
}

test('disallowAssistant blocks assistant users with the public error contract', () => {
  const result = runMiddleware({ user: { role: 'assistant' } });

  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, { error: 'Assistant access required' });
  assert.equal(result.nextCalled, false);
});

test('disallowAssistant allows owner and admin users through', () => {
  assert.equal(runMiddleware({ user: { role: 'owner' } }).nextCalled, true);
  assert.equal(runMiddleware({ user: { role: 'admin' } }).nextCalled, true);
});

test('billing and reset routes include the assistant guard after admin auth', () => {
  const subscriptions = fs.readFileSync(path.join(__dirname, '../routes/subscriptions.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../routes/settings.js'), 'utf8');

  assert.match(subscriptions, /router\.get\('\/status', auth, requireAdmin, disallowAssistant/);
  assert.match(subscriptions, /router\.post\('\/checkout', auth, requireAdmin, disallowAssistant/);
  assert.match(subscriptions, /router\.post\('\/portal', auth, requireAdmin, disallowAssistant/);
  assert.match(settings, /router\.post\('\/reset\/:section', auth, requireAdmin, disallowAssistant/);
});
