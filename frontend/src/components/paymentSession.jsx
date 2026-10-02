import { useEffect, useRef, useState } from 'react'

export const money = cents => `$${(cents / 100).toFixed(2)}`

export function validatePaymentSession(data) {
  if (!Number.isSafeInteger(data?.amountCents) || data.amountCents <= 0
      || !Number.isSafeInteger(data?.amountOwedCents) || data.amountOwedCents < data.amountCents
      || typeof data.paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(data.paymentIntentId)
      || typeof data.clientSecret !== 'string' || !data.clientSecret.startsWith(`${data.paymentIntentId}_secret_`)
      || data.clientSecret.length <= data.paymentIntentId.length + 8) {
    throw new Error('Invalid payment session. Refresh the balance before collecting payment.')
  }
  return data
}

export function PaymentAmounts({ session, estimate, succeeded = false }) {
  const remainder = session.amountOwedCents - session.amountCents
  const mismatch = Math.round(Number(estimate) * 100) !== session.amountCents
  return <div className="space-y-1 text-xs text-muted">
    <p>{succeeded ? 'Confirmed charge' : 'Charge'}: <span className="font-mono tabular-nums text-gold">{money(session.amountCents)}</span></p>
    {mismatch && <p>The server balance differs from the displayed estimate. This payment uses the current available balance.</p>}
    {remainder > 0 && <p>Partial payment. Estimated remaining balance after this charge: {money(remainder)}. Other payments may still be pending.</p>}
    {succeeded && <p>Refresh the repair order to verify its current balance.</p>}
  </div>
}

// A provider timeout/throw or non-success is not evidence that a charge failed.
// Keep this attempt locked until staff refresh/reconcile; never create a retry here.
export function usePaymentConfirmation({ session, onSuccess }) {
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function submit(confirm) {
    if (locked.current || !active.current) return
    locked.current = true
    setAttempted(true)
    setSubmitting(true)
    setError('')
    try {
      const result = await confirm()
      if (!active.current) return
      if (result?.error) {
        setError('Payment could not be confirmed. Refresh and verify its status before trying again.')
        return
      }
      const intent = result?.paymentIntent
      if (intent?.id !== session.paymentIntentId || intent?.amount !== session.amountCents || intent?.currency !== 'usd') {
        setError('Payment status could not be verified. Refresh and reconcile before collecting another payment.')
        return
      }
      if (intent.status !== 'succeeded') {
        setError('Payment is pending or incomplete. Verify its status before collecting another payment.')
        return
      }
      setSuccess(true)
      try {
        await onSuccess?.()
      } catch {
        if (active.current) setError('Payment received, but the balance could not be refreshed. Refresh the repair order before collecting another payment.')
      }
    } catch {
      if (active.current) setError('Payment outcome is unknown. Refresh and reconcile before collecting another payment.')
    } finally {
      if (active.current) setSubmitting(false)
    }
  }
  return { submitting, attempted, success, error, submit }
}
