import * as Sentry from '@sentry/react';

const PII_URL_PARTS = [
  '/customers/', '/ros/', '/repair-orders/', '/estimate-items/', '/invoice/', '/photos/', '/payments/',
];

function beforeSend(event /*, hint */) {
  if (event.request) {
    const url = event.request.url || '';
    if (PII_URL_PARTS.some(p => url.includes(p))) {
      event.request.data = '[scrubbed: PII path]';
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

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] VITE_SENTRY_DSN not set — Sentry disabled');
    return false;
  }
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_GIT_COMMIT_SHA || 'local',
    sampleRate: 1.0,
    tracesSampleRate: 0,
    initialScope: { tags: { platform: 'web' } },
    beforeSend,
  });
  return true;
}

export const captureException = (err, ctx) => Sentry.captureException(err, ctx);
