const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOwnerActivityDigestHtml, redactActivityValue } = require('../services/ownerActivity');

test('owner activity redacts sensitive nested values', () => {
  const redacted = redactActivityValue({
    status: 'closed',
    token: 'secret-token',
    nested: {
      api_key: 'secret-key',
      normal: 'safe',
    },
    list: [{ password: 'pw', amount: 123 }],
  });

  assert.deepEqual(redacted, {
    status: 'closed',
    token: '[redacted]',
    nested: {
      api_key: '[redacted]',
      normal: 'safe',
    },
    list: [{ password: '[redacted]', amount: 123 }],
  });
});

test('owner digest escapes event content', () => {
  const html = buildOwnerActivityDigestHtml({
    shopName: '<Miles>',
    since: '2026-07-10T00:00:00.000Z',
    until: '2026-07-11T00:00:00.000Z',
    events: [{
      created_at: '2026-07-10T12:00:00.000Z',
      actor_name: '<script>bad()</script>',
      summary: 'Closed <RO-1>',
      event_type: 'status_changed',
    }],
  });

  assert.match(html, /&lt;Miles&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /Closed &lt;RO-1&gt;/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
});
