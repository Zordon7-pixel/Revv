/**
 * errorReporter.js
 *
 * Automatically captures unhandled JS errors and promise rejections in REVV
 * and posts them to the /api/feedback endpoint so shop owners never need to
 * manually report bugs — they show up automatically.
 */

import api from './api';

const COOLDOWN_MS = 10_000; // dedupe same error within 10s
const seen = new Map();

function buildPayload(message, source, context = {}) {
  return {
    app: 'revv',
    tester_name: 'Auto-Reporter',
    category: 'bug',
    priority: 'high',
    message: `[AUTO] ${message}`,
    expected: 'No error',
    actual: message,
    context: JSON.stringify({
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      source,
      ...context,
    }),
  };
}

async function report(payload) {
  const key = payload.message.slice(0, 120);
  const now = Date.now();
  if (seen.has(key) && now - seen.get(key) < COOLDOWN_MS) return;
  seen.set(key, now);

  try {
    await api.post('/feedback', payload);
  } catch (_) {
    // Never let the reporter itself throw
  }
}

export function initErrorReporter() {
  // Unhandled JS errors
  window.addEventListener('error', (event) => {
    const msg = event?.error?.message || event?.message || String(event);
    const stack = event?.error?.stack || '';
    report(buildPayload(msg, 'window.onerror', { stack: stack.slice(0, 500) }));
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason ?? 'Unknown rejection');
    const stack = reason instanceof Error ? (reason.stack || '').slice(0, 500) : '';
    report(buildPayload(msg, 'unhandledrejection', { stack }));
  });
}
