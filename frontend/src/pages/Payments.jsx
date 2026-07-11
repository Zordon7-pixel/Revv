import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CreditCard, ReceiptText, WalletCards } from 'lucide-react'
import api from '../lib/api'
import { getTokenPayload } from '../lib/auth'
import PaymentStatusBadge from '../components/PaymentStatusBadge'
import { EmptyState, Money, PageHeader, Panel, StatInstrument } from '../components/ui'

function paymentDate(payment) {
  const value = payment.paid_at || payment.created_at
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString()
}

export default function Payments() {
  const tokenPayload = getTokenPayload()
  const shopId = tokenPayload?.shop_id

  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadPayments() {
      if (!shopId) {
        setError('Could not determine shop for payment history.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(`/payments/history/${shopId}`)
        if (mounted) setPayments(data.payments || [])
      } catch (err) {
        if (mounted) setError(err?.response?.data?.error || 'Could not load payment history.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadPayments()
    return () => {
      mounted = false
    }
  }, [shopId])

  const paidPayments = useMemo(
    () => payments.filter((payment) => ['paid', 'succeeded'].includes(String(payment.status || '').toLowerCase())),
    [payments],
  )
  const collectedCents = useMemo(
    () => paidPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0),
    [paidPayments],
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Financial"
        title="Payments"
        description="Review collected, pending, and failed transactions across repair orders."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatInstrument
          label="Collected"
          value={<Money cents={collectedCents} className="text-good" />}
          detail={`${paidPayments.length} paid transaction${paidPayments.length === 1 ? '' : 's'}`}
          tone="good"
        />
        <StatInstrument
          label="Transactions"
          value={<span className="font-mono tabular-nums">{payments.length}</span>}
          detail="All recorded payment attempts"
        />
        <StatInstrument
          label="Needs review"
          value={<span className="font-mono tabular-nums">{Math.max(payments.length - paidPayments.length, 0)}</span>}
          detail="Pending, failed, or incomplete"
          tone="crit"
        />
      </div>

      {loading ? (
        <Panel>
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted" role="status">
            <CreditCard size={16} className="text-brand" /> Loading payment history...
          </div>
        </Panel>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : payments.length === 0 ? (
        <Panel>
          <EmptyState
            icon={WalletCards}
            title="No payments recorded"
            description="Transactions will appear here after the first customer payment is created."
          />
        </Panel>
      ) : (
        <Panel title="Payment history" description={`${payments.length} recorded transaction${payments.length === 1 ? '' : 's'}`}>
          <div className="grid gap-3 p-3 md:hidden">
            {payments.map((payment) => (
              <article key={payment.id} className="rounded-instrument border border-line bg-panel-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-brand">{payment.ro_number || 'No RO number'}</p>
                    <p className="mt-1 truncate text-sm text-ink">{payment.customer_name || 'Customer not linked'}</p>
                  </div>
                  <PaymentStatusBadge status={payment.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-faint">Amount</dt><dd className="mt-1"><Money cents={payment.amount_cents || 0} className="text-gold" /></dd></div>
                  <div><dt className="text-faint">Method</dt><dd className="mt-1 capitalize text-ink">{payment.payment_method || 'card'}</dd></div>
                  <div className="col-span-2"><dt className="text-faint">Recorded</dt><dd className="mt-1 text-muted">{paymentDate(payment)}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-panel-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                <tr>
                  <th className="px-4 py-3">RO</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-line text-ink">
                    <td className="px-4 py-3 font-mono font-semibold text-brand">{payment.ro_number || '-'}</td>
                    <td className="px-4 py-3">{payment.customer_name || '-'}</td>
                    <td className="px-4 py-3 text-right"><Money cents={payment.amount_cents || 0} className="text-gold" /></td>
                    <td className="px-4 py-3"><PaymentStatusBadge status={payment.status} /></td>
                    <td className="px-4 py-3 capitalize text-muted">{payment.payment_method || 'card'}</td>
                    <td className="px-4 py-3 text-muted">{paymentDate(payment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="flex items-center gap-2 text-xs text-faint">
        <ReceiptText size={14} /> Amounts are shown from recorded payment transactions.
      </p>
    </div>
  )
}
