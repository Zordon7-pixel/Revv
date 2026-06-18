const assert = require('node:assert/strict');
const test = require('node:test');

const feedbackRouter = require('../routes/feedback');

test('feedback auto-reporter sanitizes provider API key failures before storage', () => {
  const key = ['sk', 'proj-secret'].join('-');
  const docsUrl = ['https://platform', 'openai', 'com/account/api-keys'].join('.');
  const raw = `[AUTO] 401 Incorrect API key provided: ${key}. You can find your API key at ${docsUrl}.`;

  const safe = feedbackRouter.sanitizeFeedbackText(raw);

  assert.equal(safe, '[AUTO] AI estimate extraction is not configured correctly. Please contact support.');
  assert.doesNotMatch(safe, /sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i);
});
