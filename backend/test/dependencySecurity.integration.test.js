const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const proxyaddr = require('proxy-addr');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const nodemailer = require('nodemailer');
const addressparser = require('nodemailer/lib/addressparser');
const semver = require('semver');

// No app bootstrap, dotenv, DB, credentials, SMTP, or provider client requests.
// Listening failures are real failures: Hermes must run the loopback tests on host.
async function serve(t, app) {
  const server = http.createServer(app);
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
      path, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        data: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('Loopback request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

test('proxy-addr stops at untrusted hops and recognizes mapped IPv6 loopback', () => {
  const trust = proxyaddr.compile(['loopback']);
  const forwarded = remoteAddress => ({ socket: { remoteAddress },
    headers: { 'x-forwarded-for': '192.0.2.10, 198.51.100.20' } });
  assert.equal(proxyaddr(forwarded('203.0.113.30'), trust), '203.0.113.30');
  assert.equal(proxyaddr(forwarded('::ffff:127.0.0.1'), trust), '198.51.100.20');
  assert.deepEqual(proxyaddr.all(forwarded('127.0.0.1'), trust), ['127.0.0.1', '198.51.100.20']);
  assert.equal(trust('::ffff:127.0.0.1'), true);
  assert.equal(trust('::ffff:198.51.100.20'), false);
  assert.equal(ipKeyGenerator('2001:db8:abcd:1200::1'), ipKeyGenerator('2001:db8:abcd:12ff::2'));
  assert.notEqual(ipKeyGenerator('2001:db8:abcd:1200::1'), ipKeyGenerator('2001:db8:abcd:1300::1'));
});

for (const [label, trust, expected] of [
  ['untrusted socket ignores forwarded headers', false, '127.0.0.1'],
  ['one-hop application policy uses nearest forwarded hop', 1, '198.51.100.20'],
  ['trusted loopback stops at nearest untrusted hop', ['loopback'], '198.51.100.20'],
]) {
  test(`Express HTTP: ${label}`, { timeout: 5000 }, async t => {
    const app = express();
    app.set('trust proxy', trust);
    app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
    const request = await serve(t, app);
    const response = await request('/', { headers: { 'X-Forwarded-For': '192.0.2.10, 198.51.100.20' } });
    assert.equal(response.status, 200);
    assert.equal(response.data.ip, expected);
    assert.deepEqual(response.data.ips, trust === false ? [] : ['198.51.100.20']);
  });
}

test('real rate limiter cannot be reset by spoofing the leftmost XFF hop', { timeout: 5000 }, async t => {
  const app = express();
  app.set('trust proxy', 1); // Same policy as backend/src/app.js; deployment topology is a separate gate.
  app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true,
    legacyHeaders: false, message: { error: 'rate_limited' } }));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const request = await serve(t, app);
  for (const leftmost of ['192.0.2.1', '192.0.2.2']) {
    assert.equal((await request('/', { headers: { 'X-Forwarded-For': `${leftmost}, 198.51.100.20` } })).status, 200);
  }
  const blocked = await request('/', { headers: { 'X-Forwarded-For': '192.0.2.3, 198.51.100.20' } });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.data, { error: 'rate_limited' });
  assert.equal((await request('/', { headers: { 'X-Forwarded-For': '192.0.2.3, 203.0.113.40' } })).status, 200);
});

test('real Express parsers preserve raw bytes, reject malformed JSON and return 413', { timeout: 5000 }, async t => {
  const app = express();
  app.post('/raw', express.raw({ type: 'application/json', limit: '128b' }),
    (req, res) => res.json({ hex: req.body.toString('hex') }));
  // Deliberately small fixture limit; production's limit remains 1mb.
  app.use(express.json({ limit: '128b' }));
  app.use(express.urlencoded({ extended: true, limit: '128b', parameterLimit: 3 }));
  app.post('/', (req, res) => res.json({ body: req.body }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  const request = await serve(t, app);
  const json = body => request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.deepEqual((await json('{"ok":true}')).data, { body: { ok: true } });
  const malformed = await json('{"private":"fixture",');
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.data, { error: 'entity.parse.failed' });
  assert.equal((await json(JSON.stringify({ bounded: 'x'.repeat(160) }))).status, 413);
  const form = await request('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=fixture&items[]=one&items[]=two' });
  assert.deepEqual(form.data, { body: { name: 'fixture', items: ['one', 'two'] } });
  assert.equal((await request('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'a=1&b=2&c=3&d=4' })).status, 413);
  const raw = '{ "fixture": 1 }';
  assert.equal((await request('/raw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })).data.hex,
    Buffer.from(raw).toString('hex'));
});

test('CommonJS Nodemailer stream transport preserves recipients and sanitizes subject newlines', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix',
    disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail({ from: 'REVV Fixture <sender@example.test>',
    to: '"Fixture, Customer" <recipient@example.test>',
    subject: 'Synthetic status\r\nX-Untrusted: marker', html: '<p>Synthetic body</p>' });
  assert.deepEqual(result.envelope, { from: 'sender@example.test', to: ['recipient@example.test'] });
  const message = result.message.toString();
  assert.match(message, /To: "Fixture, Customer" <recipient@example\.test>/);
  assert.doesNotMatch(message, /^X-Untrusted:/m);
  assert.match(message, /<p>Synthetic body<\/p>/);
  assert.deepEqual(addressparser('"Fixture, Customer" <recipient@example.test>, Second <second@example.test>'), [
    { address: 'recipient@example.test', name: 'Fixture, Customer' },
    { address: 'second@example.test', name: 'Second' },
  ]);
});

test('real email service runs through offline JSON transport with no recipient/body logging', async t => {
  const createTransport = nodemailer.createTransport.bind(nodemailer);
  const captured = [];
  const logs = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  const env = { NODE_ENV: 'production', EMAIL_HOST: 'smtp.example.test', EMAIL_PORT: '465',
    EMAIL_USER: 'synthetic-user', EMAIL_PASS: 'synthetic-password', EMAIL_FROM: 'sender@example.test' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.secure, true);
    assert.equal(options.host, 'smtp.example.test');
    const offline = createTransport({ jsonTransport: true, disableFileAccess: true, disableUrlAccess: true });
    return { sendMail: async message => { const result = await offline.sendMail(message); captured.push(result); return result; } };
  });
  const { sendEmail } = require('../src/services/email');
  assert.deepEqual(await sendEmail('recipient@example.test', 'Fixture subject', '<p>Private fixture</p>'), { ok: true });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].envelope.to, ['recipient@example.test']);
  const message = JSON.parse(captured[0].message);
  assert.equal(message.html, '<p>Private fixture</p>');
  assert.equal(message.subject, 'Fixture subject');
  assert.deepEqual(logs, []);
});

test('Twilio CommonJS signature helpers verify bounded synthetic data without a provider call', () => {
  const twilio = require('twilio');
  const url = 'https://example.test/api/sms/webhook';
  const token = 'offline-fixture-only';
  const params = { Body: 'STOP', From: '+12025550101', To: '+12025550102' };
  const signature = twilio.getExpectedTwilioSignature(token, url, params);
  assert.equal(twilio.validateRequest(token, signature, url, params), true);
  assert.equal(twilio.validateRequest(token, signature, url, { ...params, Body: 'changed' }), false);
  assert.equal(twilio.validateRequest(token, signature, `${url}/wrong`, params), false);
});

test('security-target parent ranges are checked with npm semver, without incompatible overrides', () => {
  const expressPackage = require('express/package.json');
  const twilioPackage = require('twilio/package.json');
  const parser = require('body-parser/package.json');
  assert.equal(semver.satisfies('2.0.8', expressPackage.dependencies['proxy-addr']), true);
  assert.equal(semver.satisfies('1.20.6', expressPackage.dependencies['body-parser']), true);
  assert.equal(semver.satisfies('1.20.0', twilioPackage.dependencies.axios), true);
  // Current Express/parser pins do NOT admit qs 6.16.0; updating only qs is insufficient.
  assert.ok(semver.validRange(expressPackage.dependencies.qs));
  assert.ok(semver.validRange(parser.dependencies.qs));
  for (const name of ['proxy-addr', 'body-parser', 'qs']) {
    assert.equal(semver.satisfies(require(`${name}/package.json`).version, expressPackage.dependencies[name]), true);
  }
});
