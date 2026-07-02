const assert = require('node:assert/strict');
const test = require('node:test');

function clearEmailCache() {
  const segment = `${require('node:path').sep}backend${require('node:path').sep}src${require('node:path').sep}services${require('node:path').sep}email.js`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(segment)) delete require.cache[key];
  }
}

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      clearEmailCache();
    });
}

test('production email without provider fails instead of simulating success', async () => {
  await withEnv({
    NODE_ENV: 'production',
    EMAIL_HOST: undefined,
    EMAIL_USER: undefined,
    EMAIL_PASS: undefined,
  }, async () => {
    clearEmailCache();
    const logs = [];
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const { sendEmail } = require('../services/email');
      const result = await sendEmail(
        'customer@example.com',
        'Reset your password',
        '<p>Secret reset token ABC123</p>'
      );

      assert.deepEqual(result, { ok: false, provider: 'none', error: 'no_provider_configured' });
      assert.equal(logs.length, 0);
      assert.equal(errors.length, 1);
      assert.doesNotMatch(errors.join('\n'), /customer@example\.com|ABC123|Secret reset token/);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

test('non-production email simulation masks recipients and drops body preview', async () => {
  await withEnv({
    NODE_ENV: 'development',
    EMAIL_HOST: undefined,
    EMAIL_USER: undefined,
    EMAIL_PASS: undefined,
  }, async () => {
    clearEmailCache();
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const { sendEmail, maskRecipient } = require('../services/email');
      const result = await sendEmail(
        'customer@example.com',
        'Status update',
        '<p>Vehicle VIN and private body text</p>'
      );

      assert.deepEqual(result, { ok: true, simulated: true });
      assert.equal(maskRecipient('customer@example.com'), 'c***@example.com');
      assert.equal(logs.length, 1);
      assert.match(logs[0], /c\*\*\*@example\.com/);
      assert.doesNotMatch(logs[0], /customer@example\.com|Vehicle VIN|private body text/);
    } finally {
      console.log = originalLog;
    }
  });
});
