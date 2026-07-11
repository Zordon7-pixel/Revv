import { useMemo, useState } from 'react'
import { CreditCard, CheckCircle, Loader2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import api from '../lib/api'

function CheckoutForm({ totalAmount, onSuccess }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError('')

    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (result.error) {
      setError(result.error.message || 'Payment failed')
      setSubmitting(false)
      return
    }

    if (result.paymentIntent?.status === 'succeeded') {
      if (onSuccess) onSuccess()
      setSubmitting(false)
      return
    }

    setError('Payment did not complete. Please try again.')
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-instrument border border-line-2 bg-void p-3">
        <PaymentElement />
      </div>

      {error && <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-instrument bg-gold py-2.5 font-mono text-sm font-semibold tabular-nums text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50"
      >
        {submitting ? 'Processing...' : `Pay $${Number(totalAmount || 0).toFixed(2)}`}
      </button>
    </form>
  )
}

export default function PaymentPanel({ roId, totalAmount, onSuccess, onMarkManual }) {
  const [initializing, setInitializing] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [clientSecret, setClientSecret] = useState('')
  const [paid, setPaid] = useState(false)
  const [error, setError] = useState('')

  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey])

  async function startCardPayment() {
    if (!roId) return

    const amountCents = Math.round(Number(totalAmount || 0) * 100)
    if (!amountCents || amountCents <= 0) {
      setError('A valid amount is required.')
      return
    }

    if (!stripePromise) {
      setError('Stripe publishable key is not configured.')
      return
    }

    setInitializing(true)
    setError('')

    try {
      const { data } = await api.post('/payments/intent', {
        ro_id: roId,
        amount: amountCents,
      })

      setClientSecret(data.clientSecret)
      setShowCheckout(true)
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to initialize payment.')
    } finally {
      setInitializing(false)
    }
  }

  return (
    <section className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4" aria-label="Payment">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Payment</h3>
          <p className="text-xs text-muted">Total due: <span className="font-mono font-semibold tabular-nums text-gold">${Number(totalAmount || 0).toFixed(2)}</span></p>
        </div>
      </div>

      {paid ? (
        <div role="status" className="flex items-center gap-2 rounded-instrument border border-good/35 bg-good/10 px-3 py-2 text-sm text-good">
          <CheckCircle size={14} aria-hidden="true" /> Payment received
        </div>
      ) : (
        <>
          {!showCheckout && (
            <button
              type="button"
              onClick={startCardPayment}
              disabled={initializing}
              className="inline-flex w-full items-center justify-center gap-1 rounded-instrument bg-gold px-3 py-2 text-xs font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50 sm:w-auto"
            >
              {initializing ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
              {initializing ? 'Starting...' : 'Pay by Card'}
            </button>
          )}

          {showCheckout && stripePromise && clientSecret && (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm
                totalAmount={totalAmount}
                onSuccess={() => {
                  setPaid(true)
                  setShowCheckout(false)
                  if (onSuccess) onSuccess()
                }}
              />
            </Elements>
          )}

          {error && <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

          {typeof onMarkManual === 'function' && (
            <button
              type="button"
              onClick={onMarkManual}
              className="inline-flex w-full items-center justify-center gap-1 rounded-instrument bg-good px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 sm:w-auto"
            >
              Mark as Cash/Check
            </button>
          )}
        </>
      )}
    </section>
  )
}
