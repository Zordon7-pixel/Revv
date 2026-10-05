import { afterEach, describe, expect, it, vi } from 'vitest';
const privacy = vi.hoisted(() => ({ options: { beforeBreadcrumb: value => value } }));
vi.mock('@sentry/react', () => ({ addGlobalEventProcessor: vi.fn(), getClient: () => ({ getOptions: () => privacy.options }), addBreadcrumb: vi.fn() }));
vi.mock('../api', () => ({ default: { post: vi.fn().mockResolvedValue({}) } }));
import * as Sentry from '@sentry/react';
import api from '../api';
import { shouldAutoReportAlert, sanitizeAutoReportMessage, scrubPanelApprovalSecrets, panelApprovalTelemetry, initErrorReporter } from '../errorReporter';

describe('shouldAutoReportAlert', () => {
  it('does not auto-report intentional required-field validation alerts', () => {
    expect(shouldAutoReportAlert('Name is required.')).toBe(false);
    expect(shouldAutoReportAlert('Customer name is required.')).toBe(false);
    expect(shouldAutoReportAlert('Contact name and summary are required.')).toBe(false);
  });

  it('continues auto-reporting unexpected alert errors', () => {
    expect(shouldAutoReportAlert('Error creating RO: server exploded')).toBe(true);
    expect(shouldAutoReportAlert('Could not update customer')).toBe(true);
  });

  it('sanitizes provider key failures before auto-reporting', () => {
    const key = ['sk', 'proj-secret'].join('-');
    const docsUrl = ['https://platform', 'openai', 'com/account/api-keys'].join('.');
    const raw = `401 Incorrect API key provided: ${key}. You can find your API key at ${docsUrl}.`;
    const safe = sanitizeAutoReportMessage(raw);

    expect(safe).toBe('AI estimate extraction is not configured correctly. Please contact support.');
    expect(safe).not.toMatch(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i);
  });
});


const approvalToken = `pe_${'a'.repeat(64)}`;
afterEach(() => { window.history.replaceState(null, '', '/'); vi.clearAllMocks(); });
it('scrubs raw/encoded approval bearer secrets recursively while preserving ordinary telemetry', () => {
  const encoded = [...approvalToken].map(c => `%${c.charCodeAt(0).toString(16)}`).join('');
  const event = { message: `Failed /approve/${approvalToken}`, request: { url: `/api/approval/${encoded}/pdf` }, breadcrumbs: [{ data: { url: `/api/ros/approval/${approvalToken}/respond` } }], stack: `Approval ${approvalToken}` };
  const output = JSON.stringify(scrubPanelApprovalSecrets(event));
  expect(output).not.toContain(approvalToken); expect(output).not.toContain(encoded); expect(output).toContain('redacted-approval-token');
  expect(sanitizeAutoReportMessage(`Request failed ${approvalToken}`)).not.toContain(approvalToken);
  const normal = { message: 'Regular failure', nested: { url: '/api/settings' } };
  expect(panelApprovalTelemetry(normal)).toEqual(normal);
  const cycle = {}; cycle.self = cycle; expect(() => scrubPanelApprovalSecrets(cycle)).not.toThrow();
});
it('suppresses events on the panel approval page and installs breadcrumb scrubbing before collection', () => {
  initErrorReporter();
  expect(Sentry.addGlobalEventProcessor).toHaveBeenCalledWith(panelApprovalTelemetry);
  const breadcrumb = privacy.options.beforeBreadcrumb({ category: 'fetch', data: { url: `/api/approval/${approvalToken}/pdf` } });
  expect(JSON.stringify(breadcrumb)).not.toContain(approvalToken);
  window.history.replaceState(null, '', `/approve/${approvalToken}`);
  expect(panelApprovalTelemetry({ message: 'Panel approval form data' })).toBeNull();
  expect(privacy.options.beforeBreadcrumb({ message: 'Customer name clicked' })).toBeNull();
  window.dispatchEvent(new ErrorEvent('error', { message: `Bearer ${approvalToken}` }));
  expect(api.post).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/');
  window.dispatchEvent(new ErrorEvent('error', { error: new Error(`Failed /api/approval/${approvalToken}`) }));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(api.post.mock.calls)).not.toContain(approvalToken);
  const payload = api.post.mock.calls[0][1]; expect(payload.app).toBe('revv'); expect(payload.category).toBe('bug'); expect(JSON.parse(payload.context).source).toBe('window.onerror');
});
