const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('insurance OCR imports notifyOps and handles provider failure branches', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');

  assert.match(source, /require\('\.\.\/services\/notifyOps'\)/);
  assert.match(source, /notifyOps\('high', providerCode/);
  assert.match(source, /status === 401 \|\| status === 403/);
  assert.match(source, /status === 429/);
  assert.match(source, /status >= 500 && status <= 599/);
  assert.match(source, /invalid_api_key/);
  assert.match(source, /rate_limit_exceeded/);
  assert.match(source, /provider_5xx/);
});

test('insurance OCR parse and analyze routes are rate limited and accept PDF imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');

  assert.match(source, /require\('express-rate-limit'\)/);
  assert.match(source, /const insuranceOcrLimiter = rateLimit\(/);
  assert.match(source, /windowMs: 10 \* 60 \* 1000/);
  assert.match(source, /max: 15/);
  assert.match(source, /keyGenerator: insuranceOcrLimiterKeyGenerator/);
  assert.match(source, /req\.user\.shop_id/);
  assert.match(source, /message: \{ error: 'Too many requests\. Try again in 10 minutes\.' \}/);
  assert.match(source, /router\.post\('\/parse', auth, insuranceOcrLimiter, upload\.single\('estimate_image'\)/);
  assert.match(source, /router\.post\('\/analyze', auth, insuranceOcrLimiter/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /filename\.endsWith\('\.pdf'\)/);
  assert.match(source, /"vin": "string or null"/);
  assert.match(source, /vin: parsed\.vin \|\| null/);
});

test('insurance OCR limiter key generator falls back to normalized request IP', () => {
  const { insuranceOcrLimiterKeyGenerator } = require('../routes/insuranceOcr');

  assert.equal(
    insuranceOcrLimiterKeyGenerator({ user: { shop_id: 1, id: 2 }, ip: '9.9.9.9' }),
    '1:2'
  );
  assert.equal(
    insuranceOcrLimiterKeyGenerator({ user: {}, ip: '9.9.9.9' }),
    '9.9.9.9'
  );
  assert.equal(
    insuranceOcrLimiterKeyGenerator({ user: {}, ip: '2001:db8::1' }),
    '2001:db8::/56'
  );
});
