const METHODS = new Set(['verbal', 'written']);

function validTimestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10)
    && Number.isFinite(new Date(value).getTime());
}

function hasConfirmedSmsConsent(customer) {
  const at = customer?.sms_consent_at;
  return customer?.sms_consent === true && METHODS.has(customer.sms_consent_method)
    && typeof customer.sms_consent_by === 'string' && customer.sms_consent_by.trim().length > 0
    && validTimestamp(at);
}

// Omitted/null/non-boolean input never creates evidence. An explicit true is a
// new staff attestation, not a request to copy client-supplied historical evidence.
function consentMutation(body, staffId) {
  if (body.sms_consent === true) {
    if (!METHODS.has(body.sms_consent_method)) {
      const error = new Error('Choose verbal or written SMS consent.');
      error.status = 400;
      throw error;
    }
    if (typeof staffId !== 'string' || !staffId.trim()) {
      const error = new Error('Authenticated staff is required.');
      error.status = 401;
      throw error;
    }
    return { sms_consent: true, sms_consent_at: new Date(), sms_consent_method: body.sms_consent_method, sms_consent_by: staffId };
  }
  if (body.sms_consent === false) {
    return { sms_consent: false, sms_consent_at: null, sms_consent_method: null, sms_consent_by: null };
  }
  return null;
}

function normalizePreferredContactMethod(value, smsEligible, emailConsent) {
  const method = String(value || '').trim().toLowerCase();
  const known = ['none', 'sms', 'email', 'both'].includes(method);
  const sms = smsEligible === true && (!known || method === 'sms' || method === 'both');
  const email = emailConsent === true && (!known || method === 'email' || method === 'both');
  return sms ? (email ? 'both' : 'sms') : (email ? 'email' : 'none');
}

module.exports = { hasConfirmedSmsConsent, consentMutation, normalizePreferredContactMethod };
