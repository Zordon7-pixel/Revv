import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'

export default function ApprovalPortal() {
  const { t } = useLanguage()
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/approval/${token}`)
      .then((r) => setData(r.data))
      .catch(() => setError('This approval link is invalid or expired.'))
      .finally(() => setLoading(false))
  }, [token])

  const totals = useMemo(() => {
    const ro = data?.ro || {}
    const labor = Number(ro.labor_cost || 0)
    const parts = Number(ro.parts_cost || 0)
    const sublet = Number(ro.sublet_cost || 0)
    const tax = Number(ro.tax || 0)
    const total = Number(ro.total || labor + parts + sublet + tax)
    return { labor, parts, sublet, tax, total }
  }, [data])

  async function submit(nextDecision) {
    if (nextDecision === 'decline' && !reason.trim()) {
      setError('Please explain what changes are needed.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/approval/${token}/respond`, {
        decision: nextDecision,
        reason: nextDecision === 'decline' ? reason : undefined,
      })
      setDecision(nextDecision)
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not submit response.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-[#0f1117] text-slate-300 flex items-center justify-center">{t('common.loading')}</div>

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 p-4">
        <div className="max-w-xl mx-auto mt-16 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5">
          <h1 className="text-xl font-bold text-white">{t('portal.approveEstimate')}</h1>
          <p className="text-red-300 text-sm mt-3">{error || 'Approval link unavailable.'}</p>
        </div>
      </div>
    )
  }

  if (decision === 'approve') {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 p-4">
        <div className="max-w-xl mx-auto mt-16 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 text-center">
          <CheckCircle2 size={28} className="text-emerald-400 mx-auto" />
          <h1 className="text-xl font-bold text-white mt-3">{t('portal.approveBtn')} {t('ro.estimate')}</h1>
          <p className="text-slate-400 text-sm mt-2">Thank you. The shop has been notified and your repair order has moved to approval.</p>
        </div>
      </div>
    )
  }

  if (decision === 'decline') {
    return (
      <div className="min-h-screen bg-[#0f1117] text-slate-200 p-4">
        <div className="max-w-xl mx-auto mt-16 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-6 text-center">
          <XCircle size={28} className="text-red-400 mx-auto" />
          <h1 className="text-xl font-bold text-white mt-3">{t('portal.declineBtn')}</h1>
          <p className="text-slate-400 text-sm mt-2">Your note was sent to the shop. They will contact you to review changes.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5">
          <h1 className="text-xl font-bold text-white">{data.shop?.name || 'REVV'} {t('portal.approveEstimate')}</h1>
          <p className="text-slate-400 text-sm mt-1">Review and respond to your repair estimate.</p>
        </header>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5">
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-500">{t('common.name')}</span><p className="text-white">{data.customer?.name || '—'}</p></div>
            <div><span className="text-slate-500">{t('ro.title')}</span><p className="text-white">{data.ro?.ro_number || '—'}</p></div>
            <div><span className="text-slate-500">{t('common.vehicle')}</span><p className="text-white">{[data.vehicle?.year, data.vehicle?.make, data.vehicle?.model].filter(Boolean).join(' ') || '—'}</p></div>
            <div><span className="text-slate-500">{t('common.status')}</span><p className="text-white capitalize">{data.ro?.status || '—'}</p></div>
          </div>
        </section>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">{t('ro.estimate')} Breakdown</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">{t('ro.labor')}</span><p className="text-white text-base mt-1">${totals.labor.toFixed(2)}</p></div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">{t('ro.parts')}</span><p className="text-white text-base mt-1">${totals.parts.toFixed(2)}</p></div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">Sublet</span><p className="text-white text-base mt-1">${totals.sublet.toFixed(2)}</p></div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3"><span className="text-slate-500">Tax</span><p className="text-white text-base mt-1">${totals.tax.toFixed(2)}</p></div>
          </div>
          <div className="border-t border-[#2a2d3e] pt-3 flex items-center justify-between">
            <span className="text-slate-400 text-sm">{t('ro.total')} {t('ro.estimate')}</span>
            <span className="text-[#EAB308] text-lg font-bold">${totals.total.toFixed(2)}</span>
          </div>
        </section>

        <section className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">{t('common.submit')}</h2>
          {error && <p className="text-red-300 text-sm">{error}</p>}
          <textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            placeholder="If requesting changes, explain what needs to be adjusted..."
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => submit('approve')}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {t('portal.approveBtn')} {t('ro.estimate')}
            </button>
            <button
              onClick={() => submit('decline')}
              disabled={submitting}
              className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {t('portal.declineBtn')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
