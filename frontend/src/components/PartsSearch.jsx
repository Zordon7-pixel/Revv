import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import api from '../lib/api'

function availabilityClass(availability) {
  const v = String(availability || '').toLowerCase()
  if (v.includes('in stock')) return 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50'
  if (v.includes('limited')) return 'text-amber-300 bg-amber-900/30 border-amber-700/50'
  if (v.includes('backorder')) return 'text-red-300 bg-red-900/30 border-red-700/50'
  return 'text-slate-300 bg-slate-800 border-slate-600'
}

export default function PartsSearch({ roId, initialVehicle = {}, onClose, onPartAdded }) {
  const [year, setYear] = useState(initialVehicle.year || '')
  const [make, setMake] = useState(initialVehicle.make || '')
  const [model, setModel] = useState(initialVehicle.model || '')
  const [query, setQuery] = useState('')

  const [makes, setMakes] = useState([])
  const [models, setModels] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMakes, setLoadingMakes] = useState(true)
  const [addingPartNumber, setAddingPartNumber] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const years = useMemo(() => {
    const current = new Date().getFullYear() + 1
    return Array.from({ length: 31 }, (_, i) => current - i)
  }, [])

  useEffect(() => {
    let mounted = true
    api.get('/catalog/vehicles/makes')
      .then((r) => {
        if (!mounted) return
        setMakes(r.data.makes || [])
      })
      .catch(() => {
        if (!mounted) return
        setMakes([])
      })
      .finally(() => {
        if (!mounted) return
        setLoadingMakes(false)
      })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!make) {
      setModels([])
      setModel('')
      return
    }
    let mounted = true
    api.get('/catalog/vehicles/models', { params: { make } })
      .then((r) => {
        if (!mounted) return
        const next = r.data.models || []
        setModels(next)
        if (model && !next.includes(model)) setModel('')
      })
      .catch(() => {
        if (!mounted) return
        setModels([])
      })
    return () => { mounted = false }
  }, [make, model])

  async function runSearch(e) {
    e?.preventDefault?.()
    setLoading(true)
    setHasSearched(true)
    try {
      const { data } = await api.get('/catalog/search', {
        params: { q: query, year, make, model },
      })
      setResults(data.results || [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  async function addToRO(part) {
    setAddingPartNumber(part.partNumber)
    try {
      const { data } = await api.post(`/parts/ro/${roId}`, {
        part_name: part.description,
        part_number: part.partNumber,
        vendor: part.brand,
        quantity: 1,
        unit_cost: part.price,
      })
      if (onPartAdded) onPartAdded(data)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not add part to RO')
    } finally {
      setAddingPartNumber('')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 p-3 sm:p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-base">Supplier Catalog Search</h3>
            <p className="text-xs text-slate-400">Search by vehicle + keyword, then add parts to this RO.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={runSearch} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4">
          <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]">
            <option value="">Year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          <select
            value={make}
            onChange={(e) => setMake(e.target.value)}
            disabled={loadingMakes}
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308] disabled:opacity-50"
          >
            <option value="">{loadingMakes ? 'Loading makes...' : 'Make'}</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!make}
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308] disabled:opacity-50"
          >
            <option value="">{make ? 'Model' : 'Select make first'}</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="bumper, hood, mirror..."
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#EAB308]"
            />
            <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-1.5 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 rounded-lg transition-colors disabled:opacity-50">
              <Search size={14} /> {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="text-sm text-slate-400 py-8 text-center">Searching supplier catalog...</div>
        ) : !hasSearched ? (
          <div className="text-sm text-slate-400 py-8 text-center">Pick vehicle details, enter a keyword, then search.</div>
        ) : results.length === 0 && hasSearched ? (
          <div className="text-sm text-slate-400 py-8 text-center">No parts found — try a different search</div>
        ) : (
          <div className="overflow-x-auto border border-[#2a2d3e] rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-[#0f1117] text-slate-400 uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Part #</th>
                  <th className="text-left px-3 py-2 font-semibold">Description</th>
                  <th className="text-left px-3 py-2 font-semibold">Brand</th>
                  <th className="text-right px-3 py-2 font-semibold">Price</th>
                  <th className="text-left px-3 py-2 font-semibold">Availability</th>
                  <th className="text-right px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((part) => (
                  <tr key={`${part.partNumber}-${part.description}`} className="border-t border-[#2a2d3e]">
                    <td className="px-3 py-2 text-slate-300 font-mono">{part.partNumber}</td>
                    <td className="px-3 py-2 text-white">{part.description}</td>
                    <td className="px-3 py-2 text-slate-300">{part.brand}</td>
                    <td className="px-3 py-2 text-right text-white">${Number(part.price || 0).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex border rounded-full px-2 py-0.5 ${availabilityClass(part.availability)}`}>
                        {part.availability}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => addToRO(part)}
                        disabled={addingPartNumber === part.partNumber}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {addingPartNumber === part.partNumber ? 'Adding...' : 'Add to RO'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
