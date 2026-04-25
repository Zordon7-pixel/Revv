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

function resolveSampleRate() {
  const raw = parseFloat(process.env.SENTRY_SAMPLE_RATE);
  if (Number.isNaN(raw)) return 1.0;
  return Math.min(1, Math.max(0, raw));
}

function init() {
  const dsn = process.env.SENTRY_DSN_BACKEND;
  if (!dsn) {
    console.log('[sentry] DSN not set — Sentry disabled');
    return false;
  }
  const sampleRate = resolveSampleRate();
  // PINNED to @sentry/node v7. v8 removes Sentry.Handlers.requestHandler/errorHandler
  // in favor of Sentry.expressIntegration() + Sentry.setupExpressErrorHandler(app).
  // Bumping past 7.x requires migrating both call sites in app.js.
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
    sampleRate,
    tracesSampleRate: 0,
    initialScope: { tags: { platform: 'backend' } },
    beforeSend,
  });
  console.log('[sentry] initialized — env=%s release=%s sampleRate=%s', process.env.SENTRY_ENVIRONMENT || 'production', process.env.RAILWAY_GIT_COMMIT_SHA || 'local', sampleRate);
  return true;
}

module.exports = {
  init,
  requestHandler: () => Sentry.Handlers.requestHandler(),
  errorHandler: () => Sentry.Handlers.errorHandler({ shouldHandleError: () => true }),
  captureException: (err, ctx) => Sentry.captureException(err, ctx),
};
