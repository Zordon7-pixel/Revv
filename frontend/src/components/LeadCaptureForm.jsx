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
      <div className="flex items-center gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-5">
        <CheckCircle size={22} className="shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">Thanks, {form.name.split(' ')[0]}!</p>
          <p className="text-xs text-slate-400 mt-0.5">We'll be in touch shortly.</p>
        </div>
      </div>
    )
  }

  const inputClass =
    'w-full rounded-lg border border-[#2a2d3e] bg-[#1a1d2e] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          type="text"
          required
          placeholder="Your Name *"
          value={form.name}
          onChange={update('name')}
          className={inputClass}
        />
        <input
          type="email"
          required
          placeholder="Email Address *"
          value={form.email}
          onChange={update('email')}
          className={inputClass}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          type="tel"
          placeholder="Phone (optional)"
          value={form.phone}
          onChange={update('phone')}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Business Name (optional)"
          value={form.businessName}
          onChange={update('businessName')}
          className={inputClass}
        />
      </div>
      <textarea
        placeholder="How can we help? (optional)"
        value={form.message}
        onChange={update('message')}
        rows={3}
        className={inputClass + ' resize-none'}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
      >
        <Send size={15} />
        {submitting ? 'Sending...' : 'Get in Touch'}
      </button>
    </form>
  )
}
