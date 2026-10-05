// Match the server's complete-provenance rule; legacy TRUE alone is unconfirmed.
export function consentForm(customer) {
  const at = customer?.sms_consent_at
  const day = typeof at === 'string' ? new Date(`${at.slice(0, 10)}T00:00:00Z`) : null
  const validAt = typeof at === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(at)
    && Number.isFinite(day?.getTime()) && day.toISOString().slice(0, 10) === at.slice(0, 10)
    && Number.isFinite(new Date(at).getTime())
  const confirmed = customer?.sms_consent === true && validAt
    && ['verbal', 'written'].includes(customer.sms_consent_method)
    && typeof customer.sms_consent_by === 'string' && customer.sms_consent_by.trim().length > 0
  const method = confirmed ? customer.sms_consent_method : ''
  return { sms_consent: Boolean(confirmed), sms_consent_method: method,
    initial_sms_consent: Boolean(confirmed), initial_sms_method: method, sms_touched: false }
}

export function consentPayload(form) {
  if (!form.sms_touched || (form.sms_consent === form.initial_sms_consent
    && (!form.sms_consent || form.sms_consent_method === form.initial_sms_method))) return {}
  return form.sms_consent
    ? { sms_consent: true, sms_consent_method: form.sms_consent_method }
    : { sms_consent: false }
}

export function consentError(form) {
  return form.sms_consent && !['verbal', 'written'].includes(form.sms_consent_method)
    ? 'Choose verbal or written SMS consent.' : ''
}

export default function SmsConsentFields({ form, onChange }) {
  return <div className="space-y-2 text-xs text-ink">
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={form.sms_consent} onChange={e => onChange('sms_consent', e.target.checked)} className="h-4 w-4 accent-brand" />
      Customer agreed to texts
    </label>
    {form.sms_consent ? <label className="block">SMS consent method
      <select required value={form.sms_consent_method} onChange={e => onChange('sms_consent_method', e.target.value)} className="ml-2 rounded border border-line-2 bg-void p-2">
        <option value="">Choose method</option><option value="verbal">Verbal</option><option value="written">Written</option>
      </select>
    </label> : <p className="text-muted">SMS consent unconfirmed. Confirm with the customer before checking.</p>}
  </div>
}
