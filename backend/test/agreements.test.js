const assert = require('node:assert/strict');
const test = require('node:test');
const { PDFDocument } = require('pdf-lib');
const { requiredText, parseSections, validatePdf, signatureInput, CONSENT_VERSION, CONSENT_TEXT } = require('../src/services/agreements');

test('signature validation preserves accents and rejects invalid consent, names and initials', () => {
  assert.equal(requiredText(' José López ', 'Name'), 'José López');
  assert.throws(() => requiredText('A\nB', 'Name'));
  assert.throws(() => requiredText('', 'Name'));
  assert.throws(() => requiredText('🙂', 'Name'));
  const request = { document_sha256: 'hash', initial_sections: ['Storage'] };
  const req = { ip: '127.0.0.1', get: () => 'test-agent' };
  const body = { name: 'José López', consent: true, consent_version: CONSENT_VERSION, document_sha256: 'hash', initials: { Storage: 'JL' } };
  const signature = signatureInput(body, request, 'customer', req);
  assert.equal(signature.consent_text, CONSENT_TEXT); assert.equal(signature.initials.Storage, 'JL');
  assert.throws(() => signatureInput({ ...body, consent: 'true' }, request, 'customer', req));
  assert.throws(() => signatureInput({ ...body, consent_version: 'wrong' }, request, 'customer', req));
  assert.throws(() => signatureInput({ ...body, document_sha256: 'changed' }, request, 'customer', req));
  assert.throws(() => signatureInput({ ...body, initials: {} }, request, 'customer', req));
});
test('template initial sections are bounded and unique', () => {
  assert.deepEqual(parseSections('["Page 2 - Storage"]'), ['Page 2 - Storage']);
  assert.throws(() => parseSections('{"key":"value"}'));
  assert.throws(() => parseSections(['Duplicate', 'Duplicate']));
  assert.throws(() => parseSections(Array.from({ length: 13 }, (_, i) => `Page ${i}`)));
});
test('only readable static PDFs within limits are accepted', async () => {
  await assert.rejects(validatePdf(Buffer.from('%PDF-broken')));
  await assert.rejects(validatePdf(Buffer.alloc(10 * 1024 * 1024 + 1)));
  const doc = await PDFDocument.create(); doc.addPage();
  assert.equal(await validatePdf(Buffer.from(await doc.save())), 1);
  doc.getForm().createTextField('signature');
  await assert.rejects(validatePdf(Buffer.from(await doc.save())), /static PDF/);
});
