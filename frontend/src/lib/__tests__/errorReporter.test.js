import { describe, expect, it } from 'vitest';
import { shouldAutoReportAlert, sanitizeAutoReportMessage } from '../errorReporter';

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
