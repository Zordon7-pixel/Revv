import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Send } from 'lucide-react'
import api from '../lib/api'

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good', emoji: '✓', cls: 'border-good/50 bg-good/10 text-good' },
  { value: 'fair', label: 'Fair', emoji: '•', cls: 'border-brand/40 bg-brand/10 text-brand' },
  { value: 'needs_attention', label: 'Needs Attention', emoji: '!', cls: 'border-crit/35 bg-crit/10 text-crit' },
  { value: 'critical', label: 'Critical', emoji: '!', cls: 'border-crit/60 bg-crit/20 text-crit' },
]

const CONDITION_MAP = CONDITION_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item
  return acc
}, {})

export default function InspectionEditor() {
  const { id: roId, inspectionId } = useParams()
  const navigate = useNavigate()
  const [inspection, setInspection] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [savingItems, setSavingItems] = useState({})
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  async function loadInspection() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/inspections/ro/${roId}`)
      const current = (data.inspections || []).find((entry) => entry.id === inspectionId)
      if (!current) {
        setInspection(null)
        setItems([])
        setError('Inspection not found for this repair order.')
      } else {
        setInspection(current)
        setItems(current.items || [])
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load inspection')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInspection()
  }, [roId, inspectionId])

  const groupedItems = useMemo(() => {
    return items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = []
      acc[item.category].push(item)
      return acc
    }, {})
  }, [items])

  async function updateItem(itemId, payload) {
    setActionError('')
    setSavingItems((prev) => ({ ...prev, [itemId]: true }))
    try {
      const { data } = await api.patch(`/inspections/${inspectionId}/items/${itemId}`, payload)
      setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...data.item } : item)))
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Could not save item')
    } finally {
      setSavingItems((prev) => ({ ...prev, [itemId]: false }))
    }
  }

  function updateLocal(itemId, key, value) {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, [key]: value } : item)))
  }

  async function sendToCustomer() {
    setSending(true)
    setActionError('')
    try {
      const { data } = await api.post(`/inspections/${inspectionId}/send`)
      setInspection((prev) => ({ ...(prev || {}), ...data.inspection }))
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Could not send inspection')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl p-4 text-muted" role="status">Loading inspection...</div>
  if (error) return <div className="mx-auto max-w-5xl p-4 text-crit" role="alert">{error}</div>
  if (!inspection) return <div className="max-w-5xl mx-auto p-4 text-muted">Inspection not found.</div>

  const publicUrl = `${window.location.origin}/inspection/${inspection.id}`

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => navigate(`/ros/${roId}`)}
          className="inline-flex items-center gap-1 text-sm text-ink hover:text-ink"
        >
          <ArrowLeft size={16} /> Back to RO
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${inspection.status === 'sent' ? 'border-brand/40 bg-brand/10 text-brand' : inspection.status === 'viewed' ? 'border-good/40 bg-good/10 text-good' : 'border-line-2 bg-raised text-muted'}`}>
            {inspection.status === 'viewed' ? 'Viewed by Customer' : inspection.status === 'sent' ? 'Sent to Customer' : 'Draft'}
          </span>
          <button
            type="button"
            onClick={sendToCustomer}
            disabled={sending}
            className="inline-flex items-center gap-1 bg-brand hover:bg-brand-lit text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <Send size={14} /> {sending ? 'Sending...' : 'Send to Customer'}
          </button>
          <Link
            to={`/inspection/${inspection.id}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded-instrument border border-line-2 bg-raised px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand"
          >
            <ExternalLink size={14} /> Preview Report
          </Link>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {actionError}
        </div>
      )}

      {inspection.status !== 'draft' && (
        <div className="bg-panel border border-line-2 rounded-instrument p-3 text-xs text-ink">
          Customer link: <a href={publicUrl} target="_blank" rel="noreferrer" className="text-brand underline break-all">{publicUrl}</a>
        </div>
      )}

      {Object.entries(groupedItems).map(([category, categoryItems]) => (
        <section key={category} className="bg-panel border border-line-2 rounded-instrument p-4 space-y-3">
          <h2 className="font-display text-sm font-semibold text-ink">{category}</h2>

          <div className="space-y-3">
            {categoryItems.map((item) => (
              <div key={item.id} className="bg-void border border-line-2 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink">{item.item_name}</p>
                  {savingItems[item.id] && <span className="text-[11px] text-faint">Saving...</span>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CONDITION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        updateLocal(item.id, 'condition', option.value)
                        updateItem(item.id, { condition: option.value })
                      }}
                      className={`rounded-instrument border px-2 py-1.5 text-xs transition-colors ${item.condition === option.value ? option.cls : 'border-line-2 bg-panel text-ink hover:border-brand/50'}`}
                    >
                      {option.emoji} {option.label}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  value={item.note || ''}
                  onChange={(e) => updateLocal(item.id, 'note', e.target.value)}
                  onBlur={() => updateItem(item.id, { note: item.note || '' })}
                  placeholder="Technician notes..."
                  className="w-full rounded-instrument border border-line-2 bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                />

                <input
                  value={item.photo_url || ''}
                  onChange={(e) => updateLocal(item.id, 'photo_url', e.target.value)}
                  onBlur={() => updateItem(item.id, { photo_url: item.photo_url || '' })}
                  placeholder="Photo URL (optional)"
                  className="w-full rounded-instrument border border-line-2 bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
                />

                {item.condition && (
                  <div className="text-xs text-muted">
                    Current: {CONDITION_MAP[item.condition]?.emoji} {CONDITION_MAP[item.condition]?.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
