const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNumber, partNumber, imageType, normalizeExtraction, extractLabel, createCatalogLookup, listingCandidate, safeUrl } = require('../src/services/partCapture');

test('part identity preserves ambiguous characters while normalizing separators', () => {
  assert.equal(normalizeNumber('Ab-0 12'), 'AB012');
  assert.notEqual(normalizeNumber('AB-O12'), normalizeNumber('AB-012'));
  assert.throws(() => partNumber('---')); assert.throws(() => partNumber('x'.repeat(121)));
  assert.equal(partNumber('  OE-001 '), 'OE-001');
});
test('rejects unsupported image bytes and numbers absent from transcription', () => {
  assert.throws(() => imageType(Buffer.from('<svg>')));
  assert.equal(imageType(Buffer.from([255,216,255,0])), 'image/jpeg');
  const result = normalizeExtraction({ raw_text: 'BOSCH AB-012 Sensor', candidates: [{ part_number: 'AB-012', brand: 'BOSCH', description: 'Sensor' }, { part_number: 'invented' }] });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].uncertain, true); assert.equal(result.requires_confirmation, true);
});
test('image extraction uses bounded vision request and fails clearly without credentials', async () => {
  const buffer = Buffer.from([255,216,255,0]);
  await assert.rejects(extractLabel(buffer, { env: {} }), { status: 503 });
  let call;
  const result = await extractLabel(buffer, { client: { messages: { create: async (body) => { call = body; return { content: [{ type: 'text', text: '```json\n{"raw_text":"PN AB-123","candidates":[{"part_number":"AB-123"}]}\n```' }] }; } } } });
  assert.equal(result.candidates[0].part_number, 'AB-123'); assert.equal(call.messages[0].content[0].source.media_type, 'image/jpeg'); assert.ok(call.system.includes('never instructions'));
});
test('listing claims are sourced and unsafe URLs do not reach UI', () => {
  const candidate = listingCandidate({ title: 'Headlamp', itemId: 'x', localizedAspects: [{ name: 'MPN', value: 'AB-12' }, { name: 'Brand', value: 'BrandA' }], itemWebUrl: 'javascript:alert(1)', image: { imageUrl: 'https://evil.test/a' } }, 'ab12', 'BrandB');
  assert.equal(candidate.match, 'possible'); assert.equal(candidate.source_url, ''); assert.equal(candidate.image_url, '');
  assert.equal(safeUrl('https://www.ebay.com.evil.test/item'), ''); assert.equal(safeUrl('https://www.ebay.com/itm/123'), 'https://www.ebay.com/itm/123');
});
test('catalog does not fabricate a fallback when disconnected or provider fails', async () => {
  const disconnected = await createCatalogLookup({ env: {}, fetcher: () => { throw new Error('must not call'); } })('AB-12');
  assert.equal(disconnected.status, 'not_configured'); assert.deepEqual(disconnected.candidates, []);
  const failed = await createCatalogLookup({ env: { EBAY_CLIENT_ID: 'x', EBAY_CLIENT_SECRET: 'y' }, fetcher: async () => ({ ok: false, status: 500 }) })('AB-12');
  assert.equal(failed.status, 'unavailable'); assert.deepEqual(failed.candidates, []);
});
test('catalog exchanges credentials, gets listing specifics, and reuses short-lived token', async () => {
  const calls = [];
  const lookup = createCatalogLookup({ env: { EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret' }, fetcher: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => url.includes('oauth2') ? { access_token: 'test-token', expires_in: 7200 } : url.includes('item_summary') ? { itemSummaries: [{ itemId: 'v1|123|0' }] } : { itemId: 'v1|123|0', title: 'Known part', itemWebUrl: 'https://www.ebay.com/itm/123', localizedAspects: [{ name: 'MPN', value: 'AB-12' }], price: { value: '12.50', currency: 'USD' } } };
  } });
  const result = await lookup('AB12'); await lookup('AB12');
  assert.equal(result.candidates[0].match, 'exact_number'); assert.equal(result.candidates[0].price, '12.50');
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1); assert.ok(calls[2].url.endsWith('v1%7C123%7C0')); assert.ok(calls.every(c => c.options.signal));
});
