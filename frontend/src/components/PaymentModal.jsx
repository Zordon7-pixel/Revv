import { useEffect, useMemo, useState } from 'react'
import { X, CreditCard, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import api from '../lib/api'

const CARD_OPTIONS = {
  style: {
    base: {
      color: '#f8fafc',
      fontSize: '16px',
      '::placeholder': {
        color: '#64748b',
      },
    },
    invalid: {
      color: '#f87171',
    },
  },
}

function CheckoutForm({ amount, clientSecret, onSuccess }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const amountLabel = Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements || !clientSecret) return

    setSubmitting(true)
    setError('')

    const card = elements.getElement(CardElement)
    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card,
      },
    })

    if (result.error) {
      setError(result.error.message || 'Payment failed')
      setSubmitting(false)
      return
    }

    if (result.paymentIntent?.status === 'succeeded') {
      setSuccess(true)
      setSubmitting(false)
      if (onSuccess) onSuccess()
      return
    }

    setError('Payment did not complete. Please try again.')
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-3">
        <label className="text-[11px] text-slate-500 block mb-2">Card Details</label>
        <CardElement options={CARD_OPTIONS} />
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {success && (
        <div className="text-xs text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle size={14} /> Payment successful.
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting || success}
        className="w-full bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold text-sm rounded-lg py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Processing...' : `Pay $${amountLabel}`}
      </button>
    </form>
  )
}

export default function PaymentModal({ roId, amount, onClose, onSuccess }) {
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  )

  const [loadingIntent, setLoadingIntent] = useState(true)
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function createIntent() {
      if (!roId || !amount || Number(amount) <= 0) {
        if (mounted) {
          setError('A valid RO and amount are required to process payment.')
          setLoadingIntent(false)
        }
        return
      }

      setLoadingIntent(true)
      setError('')

      try {
        const { data } = await api.post('/payments/create-intent', { roId, amount })
        if (mounted) {
          setClientSecret(data.clientSecret)
          setLoadingIntent(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err?.response?.data?.error || 'Unable to initialize payment.')
          setLoadingIntent(false)
        }
      }
    }

    createIntent()

    return () => {
      mounted = false
    }
  }, [roId, amount])

  const appearance = {
    theme: 'night',
    variables: {
      colorPrimary: '#EAB308',
      colorBackground: '#0f1117',
      colorText: '#f8fafc',
      colorDanger: '#ef4444',
      borderRadius: '10px',
    },
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d3e]">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-[#EAB308]" />
            <h2 className="text-base font-bold text-white">Collect Payment</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!publishableKey || !stripePromise ? (
            <div className="text-sm text-red-300 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
              VITE_STRIPE_PUBLISHABLE_KEY is not configured.
            </div>
          ) : loadingIntent ? (
            <div className="text-sm text-slate-300 flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Creating secure payment session...
            </div>
          ) : error ? (
            <div className="text-sm text-red-300 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
              <CheckoutForm
                amount={amount}
                clientSecret={clientSecret}
                onSuccess={() => {
                  if (onSuccess) onSuccess()
                }}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  )
}
