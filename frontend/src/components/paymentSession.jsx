import { useEffect, useId, useRef, useState } from 'react'
import api from '../lib/api'
import { getTokenPayload } from '../lib/auth'

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

// Read the same authenticated identity used by RODetail; never infer privileges
// from a component prop or the shared rank helpers.
export function usePaymentCollection({ roId, estimate, endpoint, configured, onSuccess }) {
  const user = getTokenPayload()
  const canReconcile = ['owner', 'admin'].includes(user?.role)
  const [state, setState] = useState({ roId, estimate, session: null, locked: false, loading: false, message: '', balance: null })
  const active = useRef(true)
  const epoch = useRef(0)
  const starting = useRef(false)
  const reconciling = useRef(false)
  const [pending, setPending] = useState(false)
  // A prop change must invalidate Stripe without resetting an unresolved lock.
  // Even switching away and back requires an explicit server reconciliation.
  if (state.roId !== roId || !Object.is(state.estimate, estimate)) {
    epoch.current += 1
    starting.current = true
    setState({ roId, estimate, session: null, locked: true, loading: false, balance: null,
      message: 'Repair order changed. Reconcile payments and verify the balance before collecting.' })
  }
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const valid = ticket => active.current && epoch.current === ticket

  async function start() {
    if (!roId || starting.current || reconciling.current || !active.current || state.locked) return
    if (!configured) {
      setState(s => ({ ...s, message: 'A valid payment configuration is required.' }))
      return
    }
    starting.current = true
    const ticket = epoch.current
    setState(s => ({ ...s, locked: true, loading: true, message: '', balance: null }))
    try {
      const { data } = await api.post(endpoint, { ro_id: roId })
      const session = validatePaymentSession(data)
      if (valid(ticket)) setState(s => ({ ...s, session }))
    } catch {
      if (valid(ticket)) setState(s => ({ ...s, message: 'Unable to initialize a valid payment session. Refresh the balance before trying again.' }))
    } finally {
      if (valid(ticket)) setState(s => ({ ...s, loading: false }))
    }
  }

  async function reconcile() {
    if (!canReconcile || !roId || reconciling.current || !active.current) return
    reconciling.current = true // Synchronous duplicate-submit lock.
    starting.current = true
    const ticket = ++epoch.current // Discard late intent creation and remove its secret.
    setPending(true)
    setState(s => ({ ...s, session: null, locked: true, loading: false, balance: null, message: '' }))
    let refreshed = false
    try {
      const { data } = await api.post(`/payments/reconcile/${encodeURIComponent(roId)}`, {}, { timeout: 15000 })
      if (!valid(ticket)) return
      if (data?.reconciled !== true) throw new Error('Unverified reconciliation')
      // The parent callback returns void and may swallow failures. Independently
      // verify the existing status API before ever enabling another collection.
      const response = await api.get(`/payments/ro/${encodeURIComponent(roId)}`, { timeout: 15000 })
      if (!valid(ticket)) return
      const status = response.data
      const balance = status?.collectionBalance
      if (String(status?.roId) !== String(roId)
          || !['unpaid', 'partial', 'paid', 'succeeded'].includes(status?.paymentStatus)
          || !Number.isSafeInteger(balance?.remainingCents) || balance.remainingCents < 0
          || typeof balance?.canCollect !== 'boolean'
          || ((balance.remainingCents === 0) !== ['paid', 'succeeded'].includes(status.paymentStatus))
          || (balance.canCollect && (balance.remainingCents === 0 || !['unpaid', 'partial'].includes(status.paymentStatus)))) {
        throw new Error('Unverified balance')
      }
      if (balance.remainingCents > 0 && !balance.canCollect) throw new Error('Unresolved balance')
      refreshed = true
      await onSuccess?.()
      if (!valid(ticket)) return
      starting.current = !balance.canCollect
      setState(s => ({ ...s, locked: !balance.canCollect, balance: { ...balance, status: status.paymentStatus },
        message: '' }))
    } catch (error) {
      if (valid(ticket)) setState(s => ({ ...s, locked: true, balance: null, message:
        error?.response?.status === 409
          ? 'Payment attempts are still pending or unknown. Collection is blocked. Verify their status, then explicitly reconcile again.'
          : refreshed
            ? 'The repair order could not be refreshed. Collection remains blocked. Verify its status, then reconcile again.'
            : 'Reconciliation or balance refresh could not be verified. Collection remains blocked. Verify payment status, then explicitly reconcile again.' }))
    } finally {
      reconciling.current = false
      if (active.current) setPending(false)
    }
  }
  return { ...state, canReconcile, pending, start, reconcile }
}

export function PaymentReconciliation({ collection }) {
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef(null)
  const cancel = useRef(null)
  const confirm = useRef(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => { if (confirming) cancel.current?.focus() }, [confirming])
  useEffect(() => { setConfirming(false) }, [collection.roId, collection.estimate])
  function close() {
    setConfirming(false)
    trigger.current?.focus()
  }
  return <div className="space-y-3 text-sm">
    {collection.message && <p role="alert" className="text-crit">{collection.message}</p>}
    {collection.balance && <p role="status">
      Reconciliation verified. Payment status: {collection.balance.status}. Remaining balance: {money(collection.balance.remainingCents)}.
    </p>}
    {collection.canReconcile && <>
      <button ref={trigger} type="button" aria-disabled={collection.pending} onClick={() => {
        if (!collection.pending) setConfirming(true)
      }} className="w-full rounded-instrument border border-line-2 px-3 py-2 sm:w-auto">
        {collection.pending ? 'Reconciling payments...' : 'Reconcile payments'}
      </button>
      {confirming && <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        className="space-y-3 rounded-instrument border border-line-2 bg-panel p-3"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
          if (event.key === 'Tab') {
            event.preventDefault()
            if (document.activeElement === cancel.current) confirm.current?.focus()
            else cancel.current?.focus()
          }
        }}>
        <h3 id={titleId} className="font-semibold">Reconcile this repair order?</h3>
        <p id={descriptionId}>Reconciliation may expire or cancel pending payment attempts, including payment links. Verify the refreshed balance before collecting another payment.</p>
        <div className="flex flex-wrap gap-2">
          <button ref={cancel} type="button" onClick={close} className="rounded-instrument border border-line-2 px-3 py-2">Cancel</button>
          <button ref={confirm} type="button" onClick={() => { close(); collection.reconcile() }}
            className="rounded-instrument bg-gold px-3 py-2 text-on-gold">Confirm reconciliation</button>
        </div>
      </div>}
    </>}
  </div>
}
