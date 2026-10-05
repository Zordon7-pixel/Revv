import { isSigningPage, scrubSigningSecrets } from './signingPrivacy';
/**
 * errorReporter.js
 *
 * Automatically captures unhandled JS errors, promise rejections, AND every
 * window.alert() in REVV, then posts them to /api/feedback so shop owners
 * never need to manually report bugs — they show up automatically.
 *
 * Also emits Sentry breadcrumbs for the same events so the Sentry session
 * replay shows the popup text + the click that triggered it.
 */

import * as Sentry from '@sentry/react';
import api from './api';
import { safeExternalErrorMessage } from './safeErrors';

// Approval tokens are bearer secrets on both the customer page and owner link
// controls. Keep protection here because this module owns general auto-reporting
// and is initialized immediately after Sentry, before the React app mounts.
export function isPanelApprovalPage() {
  return typeof window !== 'undefined' && /^\/approve\/pe_/i.test(window.location.pathname.replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}
export function scrubPanelApprovalSecrets(value, seen = new WeakMap()) {
  if (typeof value === 'string') {
    // Handle percent-encoded tokens even when the rest of a URL is malformed.
    const decoded = value.replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (!/pe_/i.test(decoded)) return value;
    return decoded.replace(/pe_[a-f0-9]{64}/gi, '[redacted-approval-token]')
      .replace(/(\/(?:api\/(?:ros\/|repair-orders\/)?approval|approve)\/)pe_[^\s/?#"'<>]*/gi, '$1[redacted-approval-token]');
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  const safe = Array.isArray(value) ? [] : {};
  seen.set(value, safe);
  for (const [key, item] of Object.entries(value)) safe[scrubPanelApprovalSecrets(key)] = scrubPanelApprovalSecrets(item, seen);
  return safe;
}
export function panelApprovalTelemetry(event) {
  return isPanelApprovalPage() ? null : scrubPanelApprovalSecrets(event);
}
let privacyInstalled = false;
export function installPanelApprovalPrivacy() {
  if (privacyInstalled) return;
  privacyInstalled = true;
  Sentry.addGlobalEventProcessor(panelApprovalTelemetry);
  // Sentry's automatic fetch/navigation/UI breadcrumbs also contain URLs. Apply
  // this before collection so secrets cannot survive into a later page's event.
  const options = Sentry.getClient()?.getOptions();
  if (options) {
    const previous = options.beforeBreadcrumb;
    options.beforeBreadcrumb = (breadcrumb, hint) => {
      const safe = panelApprovalTelemetry(breadcrumb);
      return safe === null ? null : previous ? previous(safe, hint) : safe;
    };
  }
}
const privatePage = () => isSigningPage() || isPanelApprovalPage();

const COOLDOWN_MS = 10_000; // dedupe same error within 10s
const seen = new Map();
const recentClicks = []; // last 5 click descriptors, newest last
const RECENT_CLICKS_MAX = 5;

export function shouldAutoReportAlert(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;

  // Intentional form-validation alerts are expected UX, not production bugs.
  // Reporting them created false high-priority feedback such as "[AUTO] Name is required."
  if (/^.+\s(?:is|are) required\.?$/i.test(text)) return false;

  return true;
}

export function sanitizeAutoReportMessage(message) {
  const raw = scrubPanelApprovalSecrets(String(message ?? '').trim());
  if (!raw) return '';
  return safeExternalErrorMessage({ message: raw }, raw).slice(0, 1000);
}

function buildPayload(message, source, context = {}) {
  const safeMessage = sanitizeAutoReportMessage(message);
  return scrubPanelApprovalSecrets({
    app: 'revv',
    tester_name: 'Auto-Reporter',
    category: 'bug',
    priority: 'high',
    message: `[AUTO] ${safeMessage}`,
    expected: 'No error',
    actual: safeMessage,
    context: JSON.stringify(scrubPanelApprovalSecrets({
      url: scrubSigningSecrets(window.location.href),
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      source,
      ...context,
    })),
  });
}

async function report(payload) {
  if (privatePage()) return;
  payload = scrubPanelApprovalSecrets(payload);
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

function describeClickTarget(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName?.toLowerCase() || '';
  const role = el.getAttribute('role') || '';
  const aria = el.getAttribute('aria-label') || '';
  const title = el.getAttribute('title') || '';
  const text = scrubPanelApprovalSecrets(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return scrubPanelApprovalSecrets({ tag, role, aria, title, text });
}

export function initErrorReporter() {
  installPanelApprovalPrivacy();
  // Track recent clicks so we can attribute alerts to the button that fired them
  document.addEventListener('click', (event) => {
    if (privatePage()) return;
    const target = event.target instanceof Element
      ? event.target.closest('button, a, [role="button"], input[type="submit"]') || event.target
      : null;
    const desc = describeClickTarget(target);
    if (!desc) return;
    recentClicks.push({ ...desc, at: Date.now() });
    if (recentClicks.length > RECENT_CLICKS_MAX) recentClicks.shift();
    Sentry.addBreadcrumb({
      category: 'ui.click',
      level: 'info',
      message: desc.aria || desc.title || desc.text || `${desc.tag}`,
      data: desc,
    });
  }, true);

  // Capture every alert(): replaces the popup with a friendly browser confirm
  // while still surfacing the message — and ships the text + last click +
  // current URL to /api/feedback so we can root-cause the next user complaint.
  if (typeof window.alert === 'function' && !window.alert.__revvPatched) {
    const originalAlert = window.alert.bind(window);
    const patched = (message) => {
      if (privatePage()) return originalAlert(message);
      const text = sanitizeAutoReportMessage(message);
      const lastClick = recentClicks[recentClicks.length - 1] || null;
      Sentry.addBreadcrumb({
        category: 'ui.alert',
        level: 'warning',
        message: text,
        data: { last_click: lastClick, url: scrubPanelApprovalSecrets(window.location.href) },
      });
      if (shouldAutoReportAlert(text)) {
        report(
          buildPayload(text, 'window.alert', {
            last_click: lastClick,
            recent_clicks: recentClicks.slice(),
          })
        );
      }
      // Preserve original popup behavior so the user still sees it.
      return originalAlert(text);
    };
    patched.__revvPatched = true;
    window.alert = patched;
  }

  // Unhandled JS errors
  window.addEventListener('error', (event) => {
    if (privatePage()) return;
    const msg = event?.error?.message || event?.message || String(event);
    const stack = event?.error?.stack || '';
    report(buildPayload(msg, 'window.onerror', { stack: scrubPanelApprovalSecrets(stack).slice(0, 500) }));
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (privatePage()) return;
    const reason = event?.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason ?? 'Unknown rejection');
    const stack = reason instanceof Error ? scrubPanelApprovalSecrets(reason.stack || '').slice(0, 500) : '';
    report(buildPayload(msg, 'unhandledrejection', { stack }));
  });
}
