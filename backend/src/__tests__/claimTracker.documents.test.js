const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyEvidenceMediaType,
  isAllowedEvidenceFile,
  isAllowedEvidenceMimeType,
} = require('../routes/claimTracker');

test('claim tracker accepts appraisal PDFs as documents', () => {
  assert.equal(isAllowedEvidenceMimeType('application/pdf'), true);
  assert.equal(classifyEvidenceMediaType('application/pdf'), 'document');
  assert.equal(classifyEvidenceMediaType('image/jpeg'), 'photo');
  assert.equal(classifyEvidenceMediaType('video/mp4'), 'video');
  assert.equal(isAllowedEvidenceMimeType('text/html'), false);
  assert.equal(isAllowedEvidenceFile({ mimetype: 'application/octet-stream', originalname: 'appraisal.PDF' }), true);
  assert.equal(classifyEvidenceMediaType('application/octet-stream', 'appraisal.PDF'), 'document');
  assert.equal(classifyEvidenceMediaType('text/html'), null);
});
