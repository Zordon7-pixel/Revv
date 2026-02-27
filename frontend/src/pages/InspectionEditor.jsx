import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Send } from 'lucide-react'
import api from '../lib/api'

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good', emoji: '🟢', cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50' },
  { value: 'fair', label: 'Fair', emoji: '🟡', cls: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/50' },
  { value: 'needs_attention', label: 'Needs Attention', emoji: '🟠', cls: 'bg-orange-900/30 text-orange-300 border-orange-700/50' },
  { value: 'critical', label: 'Critical', emoji: '🔴', cls: 'bg-red-900/30 text-red-300 border-red-700/50' },
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
    setSavingItems((prev) => ({ ...prev, [itemId]: true }))
    try {
      const { data } = await api.patch(`/inspections/${inspectionId}/items/${itemId}`, payload)
      setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...data.item } : item)))
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save item')
    } finally {
      setSavingItems((prev) => ({ ...prev, [itemId]: false }))
    }
  }

  function updateLocal(itemId, key, value) {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, [key]: value } : item)))
  }

  async function sendToCustomer() {
    setSending(true)
    try {
      const { data } = await api.post(`/inspections/${inspectionId}/send`)
      setInspection((prev) => ({ ...(prev || {}), ...data.inspection }))
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not send inspection')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="max-w-5xl mx-auto p-4 text-slate-400">Loading inspection...</div>
  if (error) return <div className="max-w-5xl mx-auto p-4 text-red-300">{error}</div>
  if (!inspection) return <div className="max-w-5xl mx-auto p-4 text-slate-400">Inspection not found.</div>

  const publicUrl = `${window.location.origin}/inspection/${inspection.id}`

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => navigate(`/ros/${roId}`)}
          className="inline-flex items-center gap-1 text-sm text-slate-300 hover:text-white"
        >
          <ArrowLeft size={16} /> Back to RO
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${inspection.status === 'sent' ? 'bg-blue-900/30 border-blue-700/40 text-blue-300' : inspection.status === 'viewed' ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-slate-900/30 border-slate-700/40 text-slate-300'}`}>
            {inspection.status === 'viewed' ? 'Viewed by Customer' : inspection.status === 'sent' ? 'Sent to Customer' : 'Draft'}
          </span>
          <button
            onClick={sendToCustomer}
            disabled={sending}
            className="inline-flex items-center gap-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            <Send size={14} /> {sending ? 'Sending...' : 'Send to Customer'}
          </button>
          <Link
            to={`/inspection/${inspection.id}`}
            target="_blank"
            className="inline-flex items-center gap-1 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-slate-200 text-sm font-medium px-3 py-2 rounded-lg"
          >
            <ExternalLink size={14} /> Preview Report
          </Link>
        </div>
      </div>

      {inspection.status !== 'draft' && (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3 text-xs text-slate-300">
          Customer link: <a href={publicUrl} target="_blank" rel="noreferrer" className="text-indigo-300 underline break-all">{publicUrl}</a>
        </div>
      )}

      {Object.entries(groupedItems).map(([category, categoryItems]) => (
        <section key={category} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">{category}</h2>

          <div className="space-y-3">
            {categoryItems.map((item) => (
              <div key={item.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm text-white font-medium">{item.item_name}</p>
                  {savingItems[item.id] && <span className="text-[11px] text-slate-500">Saving...</span>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CONDITION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        updateLocal(item.id, 'condition', option.value)
                        updateItem(item.id, { condition: option.value })
                      }}
                      className={`text-xs border rounded-lg px-2 py-1.5 transition-colors ${item.condition === option.value ? option.cls : 'bg-[#1a1d2e] border-[#2a2d3e] text-slate-300 hover:border-slate-500'}`}
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
                  className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#EAB308]"
                />

                <input
                  value={item.photo_url || ''}
                  onChange={(e) => updateLocal(item.id, 'photo_url', e.target.value)}
                  onBlur={() => updateItem(item.id, { photo_url: item.photo_url || '' })}
                  placeholder="Photo URL (optional)"
                  className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#EAB308]"
                />

                {item.condition && (
                  <div className="text-xs text-slate-400">
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
