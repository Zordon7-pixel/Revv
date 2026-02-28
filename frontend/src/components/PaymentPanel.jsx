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
      <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
        <PaymentElement />
      </div>

      {error && <div className="text-xs text-red-300">{error}</div>}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold text-sm rounded-lg py-2.5 disabled:opacity-50"
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

  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.STRIPE_PUBLISHABLE_KEY
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
    <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Payment</h3>
          <p className="text-xs text-slate-400">Total due: ${Number(totalAmount || 0).toFixed(2)}</p>
        </div>
      </div>

      {paid ? (
        <div className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle size={14} /> Payment received
        </div>
      ) : (
        <>
          {!showCheckout && (
            <button
              onClick={startCardPayment}
              disabled={initializing}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
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

          {error && <div className="text-xs text-red-300">{error}</div>}

          <button
            onClick={onMarkManual}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            Mark as Cash/Check
          </button>
        </>
      )}
    </div>
  )
}
