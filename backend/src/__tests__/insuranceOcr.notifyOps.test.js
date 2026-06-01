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
