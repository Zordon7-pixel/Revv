import { useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard, CheckCircle, Loader2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import api from '../lib/api'
import { money, PaymentAmounts, usePaymentConfirmation, validatePaymentSession } from './paymentSession'

function CheckoutForm({ session, totalAmount, onSuccess }) {
  const stripe = useStripe()
  const elements = useElements()
  const { submitting, attempted, success, error, submit } = usePaymentConfirmation({ session, onSuccess })

  function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    return submit(() => stripe.confirmPayment({ elements, redirect: 'if_required' }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentAmounts session={session} estimate={totalAmount} succeeded={success} />
      {success && <div role="status" className="text-sm text-good"><CheckCircle size={14} /> Payment received: {money(session.amountCents)}</div>}
      <div className="rounded-instrument border border-line-2 bg-void p-3">
        <PaymentElement />
      </div>

      {error && <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

      <button
        type="submit"
        disabled={!stripe || !elements || submitting || attempted}
        className="w-full rounded-instrument bg-gold py-2.5 font-mono text-sm font-semibold tabular-nums text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50"
      >
        {submitting ? 'Processing...' : `Pay ${money(session.amountCents)}`}
      </button>
    </form>
  )
}

export default function PaymentPanel(props) {
  return <PaymentPanelSession key={JSON.stringify([props.roId, props.totalAmount])} {...props} />
}

function PaymentPanelSession({ roId, totalAmount, onSuccess, onMarkManual }) {
  const [initializing, setInitializing] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [session, setSession] = useState(null)
  const active = useRef(true)
  const starting = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const [error, setError] = useState('')

  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey])

  async function startCardPayment() {
    if (!roId) return

    if (starting.current || !active.current) return
    if (!stripePromise) {
      setError('Stripe publishable key is not configured.')
      return
    }

    starting.current = true
    setInitializing(true)
    setError('')

    try {
      const { data } = await api.post('/payments/intent', {
        ro_id: roId,
      })

      const validated = validatePaymentSession(data)
      if (active.current) {
        setSession(validated)
        setShowCheckout(true)
      }
    } catch {
      if (active.current) setError('Unable to initialize a valid payment session. Refresh the balance before trying again.')
    } finally {
      if (active.current) setInitializing(false)
    }
  }

  return (
    <section className="space-y-3 rounded-instrument border border-line-2 bg-panel p-4" aria-label="Payment">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Payment</h3>
          <p className="text-xs text-muted">Displayed estimate: <span className="font-mono font-semibold tabular-nums text-gold">${Number(totalAmount || 0).toFixed(2)}</span></p>
        </div>
      </div>

      {!showCheckout && (
        <button
          type="button"
          onClick={startCardPayment}
          disabled={initializing || starting.current}
          className="inline-flex w-full items-center justify-center gap-1 rounded-instrument bg-gold px-3 py-2 text-xs font-semibold text-on-gold transition-colors hover:bg-gold-lit disabled:opacity-50 sm:w-auto"
        >
          {initializing ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
          {initializing ? 'Starting...' : 'Pay by Card'}
        </button>
      )}

      {showCheckout && stripePromise && session && (
        <Elements stripe={stripePromise} options={{ clientSecret: session.clientSecret }}>
          <CheckoutForm session={session} totalAmount={totalAmount} onSuccess={onSuccess} />
        </Elements>
      )}

      {error && <div role="alert" className="rounded-instrument border border-crit/35 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

      {!starting.current && typeof onMarkManual === 'function' && (
        <button
          type="button"
          onClick={onMarkManual}
          className="inline-flex w-full items-center justify-center gap-1 rounded-instrument bg-good px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 sm:w-auto"
        >
          Mark as Cash/Check
        </button>
      )}
    </section>
  )
}
