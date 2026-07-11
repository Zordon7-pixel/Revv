import { useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { CheckCircle, Send } from 'lucide-react'

export default function LeadCaptureForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', businessName: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) return
    setSubmitting(true)
    setError('')

    try {
      // Write to Firestore
      await addDoc(collection(db, 'leads'), {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        businessName: form.businessName.trim() || null,
        message: form.message.trim() || null,
        source: 'website',
        createdAt: serverTimestamp(),
      })

      // Notify backend (Discord webhook)
      fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          businessName: form.businessName.trim(),
          message: form.message.trim(),
        }),
      }).catch(() => {}) // fire-and-forget

      setSubmitted(true)
    } catch (err) {
      console.error('[LeadCapture] Error:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-3 rounded-instrument border border-good/30 bg-good/10 p-5" role="status">
        <CheckCircle size={22} className="shrink-0 text-good" />
        <div>
          <p className="text-sm font-semibold text-good">Thanks, {form.name.split(' ')[0]}!</p>
          <p className="mt-0.5 text-xs text-muted">We'll be in touch shortly.</p>
        </div>
      </div>
    )
  }

  const inputClass =
    'w-full rounded-instrument border border-line-2 bg-panel px-4 py-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          type="text"
          required
          placeholder="Your Name *"
          aria-label="Your name"
          value={form.name}
          onChange={update('name')}
          className={inputClass}
        />
        <input
          type="email"
          required
          placeholder="Email Address *"
          aria-label="Email address"
          value={form.email}
          onChange={update('email')}
          className={inputClass}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          type="tel"
          placeholder="Phone (optional)"
          aria-label="Phone"
          value={form.phone}
          onChange={update('phone')}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Business Name (optional)"
          aria-label="Business name"
          value={form.businessName}
          onChange={update('businessName')}
          className={inputClass}
        />
      </div>
      <textarea
        placeholder="How can we help? (optional)"
        aria-label="How can we help?"
        value={form.message}
        onChange={update('message')}
        rows={3}
        className={inputClass + ' resize-none'}
      />
      {error && <p className="text-sm text-crit" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60"
      >
        <Send size={15} />
        {submitting ? 'Sending...' : 'Get in Touch'}
      </button>
    </form>
  )
}
