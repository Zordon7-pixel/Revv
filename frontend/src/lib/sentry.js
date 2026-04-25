import * as Sentry from '@sentry/react';

const PII_URL_PARTS = [
  '/api/customers',
  '/api/ros',
  '/api/repair-orders',
  '/api/estimate-items',
  '/api/invoice',
  '/api/photos',
  '/api/payments',
];

function beforeSend(event /*, hint */) {
  if (event.request) {
    const url = event.request.url || '';
    if (PII_URL_PARTS.some(p => url.includes(p))) {
      event.request.data = '[scrubbed: PII path]';
    } else if (event.request.data && typeof event.request.data === 'string' && event.request.data.length > 2000) {
      event.request.data = '[truncated]';
    }
    if (event.request.headers) {
      delete event.request.headers.Authorization;
      delete event.request.headers.authorization;
      delete event.request.headers.Cookie;
      delete event.request.headers.cookie;
    }
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
  const raw = parseFloat(import.meta.env.VITE_SENTRY_SAMPLE_RATE);
  if (Number.isNaN(raw)) return 1.0;
  return Math.min(1, Math.max(0, raw));
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] VITE_SENTRY_DSN not set — Sentry disabled');
    return false;
  }
  const sampleRate = resolveSampleRate();
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_GIT_COMMIT_SHA || 'local',
    sampleRate,
    tracesSampleRate: 0,
    initialScope: { tags: { platform: 'web' } },
    beforeSend,
  });
  console.log('[sentry] initialized — env=%s sampleRate=%s', import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production', sampleRate);
  return true;
}

export const captureException = (err, ctx) => Sentry.captureException(err, ctx);
