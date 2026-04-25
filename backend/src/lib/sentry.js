const Sentry = require('@sentry/node');

const PII_PATH_PREFIXES = [
  '/api/customers',
  '/api/ros',
  '/api/repair-orders',
  '/api/estimate-items',
  '/api/invoice',
  '/api/photos',
  '/api/payments',
];

const SENSITIVE_HEADER_KEYS = ['authorization', 'cookie', 'x-api-key'];

function scrubHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_KEYS.includes(k.toLowerCase()) ? '[scrubbed]' : v;
  }
  return out;
}

function beforeSend(event /*, hint */) {
  if (event.request) {
    const url = event.request.url || '';
    if (PII_PATH_PREFIXES.some(p => url.includes(p))) {
      event.request.data = '[scrubbed: PII path]';
    } else if (event.request.data && typeof event.request.data === 'string' && event.request.data.length > 2000) {
      event.request.data = '[truncated]';
    }
    event.request.headers = scrubHeaders(event.request.headers);
    event.request.cookies = undefined;
  }
  if (event.user) {
    const safeUser = {};
    if (event.user.shop_id) safeUser.shop_id = event.user.shop_id;
    if (event.user.id) safeUser.id = event.user.id;
    event.user = safeUser;
  }
  return event;
}

function init() {
  const dsn = process.env.SENTRY_DSN_BACKEND;
  if (!dsn) {
    console.log('[sentry] DSN not set — Sentry disabled');
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
    sampleRate: 1.0,
    tracesSampleRate: 0,
    initialScope: { tags: { platform: 'backend' } },
    beforeSend,
  });
  console.log('[sentry] initialized — env=%s release=%s', process.env.SENTRY_ENVIRONMENT || 'production', process.env.RAILWAY_GIT_COMMIT_SHA || 'local');
  return true;
}

module.exports = {
  init,
  requestHandler: () => Sentry.Handlers.requestHandler(),
  errorHandler: () => Sentry.Handlers.errorHandler({ shouldHandleError: () => true }),
  captureException: (err, ctx) => Sentry.captureException(err, ctx),
};
