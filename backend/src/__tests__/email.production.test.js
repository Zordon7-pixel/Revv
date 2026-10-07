const assert = require('node:assert/strict');
const test = require('node:test');

function mockSMTP(t) {
  const calls = { transports: [], messages: [], logs: [] };
  for (const key of Object.keys(console)) {
    if (typeof console[key] === 'function' && key !== 'Console') {
      t.mock.method(console, key, (...args) => calls.logs.push([key, ...args]));
    }
  }
  t.mock.method(require('nodemailer'), 'createTransport', options => {
    calls.transports.push(options);
    return { sendMail: async message => {
      calls.messages.push(message);
      return { messageId: 'synthetic-message-id' };
    } };
  });
  return calls;
}

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

test('production email without provider fails instead of simulating success', async t => {
  const calls = mockSMTP(t);
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
      assert.deepEqual(calls.logs, []);
      assert.deepEqual(calls.transports, []);
      assert.deepEqual(calls.messages, []);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

test('non-production email simulation logs no recipient or body preview', async t => {
  const calls = mockSMTP(t);
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
      const { sendEmail } = require('../services/email');
      const result = await sendEmail(
        'customer@example.com',
        'Status update',
        '<p>Vehicle VIN and private body text</p>'
      );

      assert.deepEqual(result, { ok: true, simulated: true });
      assert.equal(logs.length, 1);
      assert.equal(logs[0], '[EMAIL] simulated (no provider configured)');
      assert.doesNotMatch(logs[0], /customer@example\.com|Status update|Vehicle VIN|private body text/);
      assert.deepEqual(calls.logs, []);
      assert.deepEqual(calls.transports, []);
      assert.deepEqual(calls.messages, []);
    } finally {
      console.log = originalLog;
    }
  });
});

test('configured SMTP preserves success, transport options and message payload without simulation', async t => {
  const calls = mockSMTP(t);
  await withEnv({
    NODE_ENV: 'production', EMAIL_HOST: 'smtp.example.test', EMAIL_PORT: '465',
    EMAIL_USER: 'synthetic-user', EMAIL_PASS: 'synthetic-password', EMAIL_FROM: 'sender@example.test',
  }, async () => {
    clearEmailCache();
    const { sendEmail } = require('../services/email');
    const args = ['customer@example.test', 'Private subject', '<p>Private body</p>'];
    assert.deepEqual(await sendEmail(...args), { ok: true });
    assert.deepEqual(calls.transports, [{
      host: 'smtp.example.test', port: 465, secure: true,
      auth: { user: 'synthetic-user', pass: 'synthetic-password' },
    }]);
    assert.deepEqual(calls.messages, [{ from: 'sender@example.test', to: args[0], subject: args[1], html: args[2] }]);
    assert.deepEqual(calls.logs, []);

    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_PORT;
    assert.deepEqual(await sendEmail(...args), { ok: true });
    assert.equal(calls.transports.length, 2);
    assert.deepEqual(calls.transports[1], {
      host: 'smtp.example.test', port: 587, secure: false,
      auth: { user: 'synthetic-user', pass: 'synthetic-password' },
    });
    assert.equal(calls.messages.length, 2);
    assert.deepEqual(calls.messages[1], { ...calls.messages[0], from: 'synthetic-user' });
    assert.deepEqual(calls.logs, []);
  });
});
