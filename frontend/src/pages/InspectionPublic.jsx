import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'

const CONDITION_META = {
  good: { label: 'Good', cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50' },
  fair: { label: 'Fair', cls: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/50' },
  needs_attention: { label: 'Needs Attention', cls: 'bg-orange-900/30 text-orange-300 border-orange-700/50' },
  critical: { label: 'Critical', cls: 'bg-red-900/30 text-red-300 border-red-700/50' },
}

export default function InspectionPublic() {
  const { inspectionId } = useParams()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(`/inspections/${inspectionId}/public`)
        setPayload(data)
      } catch (err) {
        setError(err?.response?.data?.error || 'Unable to load inspection report')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [inspectionId])

  const groupedItems = useMemo(() => {
    const items = payload?.items || []
    return items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = []
      acc[item.category].push(item)
      return acc
    }, {})
  }, [payload])

  if (loading) return <div className="max-w-4xl mx-auto p-4 text-slate-300">Loading report...</div>
  if (error) return <div className="max-w-4xl mx-auto p-4 text-red-300">{error}</div>

  const { shop, vehicle, ro, inspection } = payload

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <header className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 sm:p-6">
          <h1 className="text-xl sm:text-2xl font-bold">Your Vehicle Inspection Report</h1>
          <p className="text-sm text-slate-400 mt-1">{shop?.name}</p>

          <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <p className="text-xs text-slate-500">Vehicle</p>
              <p className="text-white font-medium">{vehicle?.year} {vehicle?.make} {vehicle?.model}</p>
              {vehicle?.color && <p className="text-slate-400 text-xs">Color: {vehicle.color}</p>}
            </div>
            <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3">
              <p className="text-xs text-slate-500">Repair Order</p>
              <p className="text-white font-medium">{ro?.ro_number || 'N/A'}</p>
              <p className="text-slate-400 text-xs">Inspection status: {inspection?.status}</p>
            </div>
          </div>
        </header>

        {Object.entries(groupedItems).map(([category, items]) => (
          <section key={category} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-2">
            <h2 className="text-sm sm:text-base font-semibold">{category}</h2>

            <div className="space-y-2">
              {items.map((item) => {
                const meta = CONDITION_META[item.condition] || { label: 'Not Rated', cls: 'bg-slate-900/30 text-slate-300 border-slate-700/50' }
                return (
                  <article key={item.id} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm text-white font-medium">{item.item_name}</p>
                      <span className={`text-xs px-2.5 py-1 rounded-full border ${meta.cls}`}>{meta.label}</span>
                    </div>
                    {item.note && <p className="text-sm text-slate-300 whitespace-pre-wrap">{item.note}</p>}
                    {item.photo_url && (
                      <a href={item.photo_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 underline break-all">
                        View photo
                      </a>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
