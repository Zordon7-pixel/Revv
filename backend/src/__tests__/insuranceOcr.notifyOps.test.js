const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('insurance OCR imports notifyOps and handles provider failure branches', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');

  assert.match(source, /require\('\.\.\/services\/openai'\)/);
  assert.match(source, /require\('\.\.\/services\/notifyOps'\)/);
  assert.match(source, /notifyOps\('high', providerCode/);
  assert.match(source, /status === 401 \|\| status === 403/);
  assert.match(source, /status === 429/);
  assert.match(source, /status >= 500 && status <= 599/);
  assert.match(source, /invalid_api_key/);
  assert.match(source, /rate_limit_exceeded/);
  assert.match(source, /provider_5xx/);
});

test('insurance OCR uses only OpenAI and preserves local parsing recovery', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');
  assert.doesNotMatch(source, /ANTHROPIC|Anthropic|anthropic-ai/);
  assert.match(source, /parseEstimateTextWithOpenAI/);
  assert.match(source, /parseEstimateImageUrlsWithOpenAI/);
  // Configuration refusal now lives behind the shared, shop-scoped admission.
  assert.equal(require('../services/openai').getOpenAI({}), null);
  assert.match(source, /const budget = createEstimateBudget\(req\.user\.shop_id\)/);
  const budgetSource = source.slice(source.indexOf('function createEstimateBudget('), source.indexOf('function buildManualFallback('));
  assert.match(budgetSource, /result = await admitEstimateAi\(shopId\)/);
  assert.match(budgetSource, /if \(result\?\.status !== 'admitted'\) \{\s*throw fallbackError/);
  assert.match(budgetSource, /client = getOpenAI\(\);\s*if \(!client\) throw fallbackError\('ai_estimate_unavailable'\)/);
  // The catch path retains deterministic rows/totals and marks manual review.
  assert.match(source, /return res\.json\(buildManualFallback\(deterministicParsed, detectedFormat,\s*err\.fallbackReason \|\| 'ai_estimate_unavailable', intakeMode\)\)/);
  const fallbackSource = source.slice(source.indexOf('function buildManualFallback('), source.indexOf('function buildDeterministicParseResponse('));
  assert.match(fallbackSource, /buildDeterministicSummaryFallback\(parsed, format\) \|\| parsed/);
  assert.match(fallbackSource, /return buildDeterministicParseResponse\(\{\s*\.\.\.retained,\s*ai_fallback_reason: safeReason,\s*needs_review: true/);
});

test('insurance OCR retries zero-line-item results and can build rows from totals', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/insuranceOcr.js'), 'utf8');

  assert.match(source, /RELAXED_LINE_ITEM_PROMPT/);
  assert.match(source, /retryWithRelaxedPrompt/);
  assert.match(source, /if \(!items\.length && retryWithRelaxedPrompt\) \{\s*const retryRaw = await retryWithRelaxedPrompt\(\)/);
  assert.match(source, /if \(!raw && retryWithRelaxedPrompt\) \{\s*raw = await retryWithRelaxedPrompt\(\);\s*retryWithRelaxedPrompt = null/);
  assert.match(source, /retryWithRelaxedPrompt = \(\) => parseEstimateImageUrlsWithOpenAI\(budget, imageDataUrls, RELAXED_LINE_ITEM_PROMPT \+ textContext\)/);
  assert.match(source, /return parseEstimateTextWithOpenAI\(budget, extractedTextForTotals, recoveryPrompt\)/);
  assert.match(source, /return parseEstimateImageUrlsWithOpenAI\(budget, imageDataUrls, recoveryPrompt\)/);
  assert.match(source, /if \(budget\.calls >= 2\) throw fallbackError\('ai_estimate_call_limit'\)/);
  assert.match(source, /if \(calls >= 2\) throw fallbackError\('ai_estimate_call_limit'\)/);
  assert.match(source, /textChars \+ nextText > PDF_TEXT_CHAR_LIMIT \|\| pages \+ nextPages > PDF_IMAGE_PAGE_LIMIT/);
  assert.match(source, /calls\+\+;\s*textChars \+= nextText;\s*pages \+= nextPages;\s*return client\.chat\.completions\.create\(payload, \{ maxRetries: 0 \}\)/);
  assert.match(source, /normalizeLineItems\(parsed\.line_items\)/);
  assert.match(source, /buildLineItemsFromTotals\(estimateTotals\)/);
  assert.match(source, /Estimate totals - parts/);
  assert.match(source, /Estimate totals - body labor/);
  assert.match(source, /Estimate totals - paint labor/);
  assert.match(source, /Built estimate line items from totals because detailed rows were unreadable/);
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
  assert.match(source, /MAX_ESTIMATE_UPLOAD_FILES = 12/);
  assert.match(source, /function collectEstimateUploadFiles\(req\)/);
  assert.match(source, /estimate_images/);
  assert.match(source, /router\.post\('\/parse', auth, insuranceOcrLimiter, uploadEstimateFiles/);
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
