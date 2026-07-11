import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck2, CheckCircle2, Loader2 } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { Logo, Panel } from '../components/ui'

const SERVICES = [
  'Oil Change',
  'Brake Service',
  'Tire Rotation',
  'Engine Repair',
  'Body Work',
  'Inspection',
  'Other',
]

const inputClass = 'mt-1 w-full rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

export default function BookAppointment() {
  const { t } = useLanguage()
  const [params] = useSearchParams()
  const shopName = params.get('name') || t('booking.title')
  const shopId = params.get('shop') || ''

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    vehicle_year: '',
    vehicle_make: '',
    vehicle_model: '',
    service: SERVICES[0],
    preferred_date: '',
    preferred_time: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const query = shopId ? `?shop=${encodeURIComponent(shopId)}` : ''
      const response = await fetch(`/api/appointments/request${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const responseData = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(responseData?.error || 'Could not submit request')
      setDone(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-void px-4 py-10 text-ink sm:py-14">
        <div className="mx-auto max-w-lg space-y-5">
          <header className="flex items-center gap-3 border-b border-line pb-5">
            <Logo variant="mark" className="h-10 w-10" />
            <p className="font-display text-lg font-semibold text-ink">{shopName}</p>
          </header>
          <Panel className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-good" aria-hidden="true" />
            <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Request received</h1>
            <p role="status" className="mt-2 text-sm text-muted">{t('booking.confirmed')}</p>
          </Panel>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          <Logo variant="mark" className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <h1 className="break-words font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">{shopName}</h1>
            <p className="text-sm text-muted">Request a service appointment</p>
          </div>
        </header>

        <Panel as="form" onSubmit={submit} title="Appointment details" description="The shop will contact you to confirm availability.">
          <div className="space-y-5 p-4 sm:p-6">
            {error && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Customer name *
                <input aria-label="Customer name" required value={form.name} onChange={(event) => setField('name', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Phone *
                <input aria-label="Phone" required value={form.phone} onChange={(event) => setField('phone', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                {t('common.email')}
                <input aria-label="Email" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                {t('common.vehicle')} {t('common.year')}
                <input aria-label="Vehicle year" inputMode="numeric" value={form.vehicle_year} onChange={(event) => setField('vehicle_year', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                {t('common.vehicle')} {t('common.make')}
                <input aria-label="Vehicle make" value={form.vehicle_make} onChange={(event) => setField('vehicle_make', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                {t('common.vehicle')} {t('common.model')}
                <input aria-label="Vehicle model" value={form.vehicle_model} onChange={(event) => setField('vehicle_model', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Service needed *
                <select aria-label="Service needed" value={form.service} onChange={(event) => setField('service', event.target.value)} className={inputClass}>
                  {SERVICES.map((service) => <option key={service} value={service}>{service}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted">
                {t('booking.selectDate')}
                <input aria-label="Preferred date" type="date" value={form.preferred_date} onChange={(event) => setField('preferred_date', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                {t('booking.selectTime')}
                <input aria-label="Preferred time" type="time" value={form.preferred_time} onChange={(event) => setField('preferred_time', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                {t('common.notes')}
                <textarea aria-label="Appointment notes" rows={4} value={form.notes} onChange={(event) => setField('notes', event.target.value)} className={`${inputClass} resize-y`} />
              </label>
            </div>

            <button type="submit" disabled={submitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <CalendarCheck2 size={17} aria-hidden="true" />}
              {submitting ? 'Submitting...' : t('booking.submitBooking')}
            </button>
          </div>
        </Panel>
      </div>
    </main>
  )
}
