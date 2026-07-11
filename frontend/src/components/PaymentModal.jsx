import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, CreditCard, Loader2, X } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js'
import api from '../lib/api'
import AppOverlay from './AppOverlay'

const CARD_OPTIONS = {
  style: {
    base: {
      color: 'var(--ink)',
      fontSize: '16px',
      '::placeholder': { color: 'var(--muted)' },
    },
    invalid: { color: 'var(--crit)' },
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

  async function handleSubmit(event) {
    event.preventDefault()
    if (!stripe || !elements || !clientSecret) return

    setSubmitting(true)
    setError('')
    const card = elements.getElement(CardElement)
    const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })

    if (result.error) {
      setError(result.error.message || 'Payment failed')
      setSubmitting(false)
      return
    }
    if (result.paymentIntent?.status === 'succeeded') {
      setSuccess(true)
      setSubmitting(false)
      onSuccess?.()
      return
    }
    setError('Payment did not complete. Please try again.')
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-instrument border border-line-2 bg-void p-3">
        <label className="mb-2 block text-[11px] text-muted">Card details</label>
        <CardElement options={CARD_OPTIONS} />
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-xs text-crit">
          <AlertCircle size={14} aria-hidden="true" /> {error}
        </div>
      )}
      {success && (
        <div role="status" className="flex items-center gap-2 rounded-instrument border border-good/35 bg-good/10 px-3 py-2 text-xs text-good">
          <CheckCircle size={14} aria-hidden="true" /> Payment successful.
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting || success}
        className="w-full rounded-instrument bg-gold py-2.5 text-sm font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:cursor-not-allowed disabled:opacity-50"
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
      } catch (requestError) {
        if (mounted) {
          setError(requestError?.response?.data?.error || 'Unable to initialize payment.')
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
      colorPrimary: 'var(--gold)',
      colorBackground: 'var(--void)',
      colorText: 'var(--ink)',
      colorDanger: 'var(--crit)',
      borderRadius: '10px',
    },
  }

  return (
    <AppOverlay label="Collect payment" onClose={onClose} className="bg-void/75 p-4 backdrop-blur-[1px]">
      <section className="w-full max-w-md rounded-instrument border border-line-2 bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-line-2 px-5 py-4">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-gold" aria-hidden="true" />
            <h2 className="text-base font-bold text-ink">Collect payment</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment dialog"
            className="rounded-instrument p-1 text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          {!publishableKey || !stripePromise ? (
            <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-sm text-crit">
              VITE_STRIPE_PUBLISHABLE_KEY is not configured.
            </div>
          ) : loadingIntent ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Creating secure payment session...
            </div>
          ) : error ? (
            <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-sm text-crit">
              {error}
            </div>
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
              <CheckoutForm amount={amount} clientSecret={clientSecret} onSuccess={onSuccess} />
            </Elements>
          )}
        </div>
      </section>
    </AppOverlay>
  )
}
