import { describe, expect, it } from 'vitest';
import { shouldAutoReportAlert } from '../errorReporter';

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
});
