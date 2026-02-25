import { useEffect, useState } from 'react'
import { CreditCard, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import { getTokenPayload } from '../lib/auth'
import PaymentStatusBadge from '../components/PaymentStatusBadge'

function formatCurrencyFromCents(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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
        if (mounted) {
          setPayments(data.payments || [])
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err?.response?.data?.error || 'Could not load payment history.')
          setLoading(false)
        }
      }
    }

    loadPayments()
    return () => {
      mounted = false
    }
  }, [shopId])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard size={18} className="text-[#EAB308]" />
        <h1 className="text-xl font-bold text-white">Payments</h1>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading payment history...</div>
      ) : error ? (
        <div className="text-sm text-red-300 bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl px-4 py-8 text-sm text-slate-500 text-center">
          No payments recorded yet.
        </div>
      ) : (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-[#0f1117]">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">RO</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-[#2a2d3e] text-sm text-slate-300">
                    <td className="px-4 py-3 text-[#EAB308] font-semibold">{payment.ro_number || '—'}</td>
                    <td className="px-4 py-3">{payment.customer_name || '—'}</td>
                    <td className="px-4 py-3">{formatCurrencyFromCents(payment.amount_cents)}</td>
                    <td className="px-4 py-3">
                      <PaymentStatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-3 capitalize">{payment.payment_method || 'card'}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {payment.paid_at
                        ? new Date(payment.paid_at).toLocaleString()
                        : new Date(payment.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
