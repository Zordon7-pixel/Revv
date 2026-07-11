import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import api from '../lib/api'
import AppOverlay from './AppOverlay'

function availabilityClass(availability) {
  const v = String(availability || '').toLowerCase()
  if (v.includes('in stock')) return 'border-good/50 bg-good/10 text-good'
  if (v.includes('limited')) return 'text-amber-300 bg-amber-900/30 border-amber-700/50'
  if (v.includes('backorder')) return 'border-crit/50 bg-crit/10 text-crit'
  return 'border-line-2 bg-raised text-muted'
}

function fitmentClass(fitmentType) {
  const v = String(fitmentType || '').toLowerCase()
  if (v === 'oem') return 'border-brand/50 bg-brand/10 text-brand'
  if (v === 'oem equivalent') return 'border-line-2 bg-raised text-ink'
  return 'border-line-2 bg-raised text-muted'
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
        part_number: part.oemPartNumber || part.oemEquivalentPartNumber || part.partNumber,
        vendor: part.supplier || part.brand,
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
    <AppOverlay label="Supplier catalog search" onClose={onClose} className="bg-black/70 p-3 sm:p-6">
      <div className="w-full max-w-5xl max-h-[calc(var(--app-viewport-height)-1.5rem)] overflow-y-auto overscroll-contain rounded-instrument border border-line-2 bg-panel p-4 shadow-2xl sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink">Supplier Catalog Search</h3>
            <p className="text-xs text-muted">Search by vehicle + keyword across common supplier references (Advance Auto Parts, AutoZone, dealership/OEM) and add parts to this RO.</p>
          </div>
          <button onClick={onClose} className="text-muted transition-colors hover:text-ink" aria-label="Close supplier catalog search">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={runSearch} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4">
          <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none">
            <option value="">Year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>

          <select
            value={make}
            onChange={(e) => setMake(e.target.value)}
            disabled={loadingMakes}
            className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
          >
            <option value="">{loadingMakes ? 'Loading makes...' : 'Make'}</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!make}
            className="rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
          >
            <option value="">{make ? 'Model' : 'Select make first'}</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="bumper, hood, mirror..."
              className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            />
            <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50">
              <Search size={14} /> {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted">Searching supplier catalog...</div>
        ) : !hasSearched ? (
          <div className="py-8 text-center text-sm text-muted">Pick vehicle details, enter a keyword, then search.</div>
        ) : results.length === 0 && hasSearched ? (
          <div className="py-8 text-center text-sm text-muted">No parts found — try a different search</div>
        ) : (
          <div className="overflow-x-auto rounded-instrument border border-line-2">
            <table className="w-full text-xs">
              <thead className="bg-void text-muted uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Part #</th>
                  <th className="text-left px-3 py-2 font-semibold">OEM Ref</th>
                  <th className="text-left px-3 py-2 font-semibold">Description</th>
                  <th className="text-left px-3 py-2 font-semibold">Supplier</th>
                  <th className="text-left px-3 py-2 font-semibold">Fitment</th>
                  <th className="text-right px-3 py-2 font-semibold">Price</th>
                  <th className="text-left px-3 py-2 font-semibold">Availability</th>
                  <th className="text-right px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((part) => (
                  <tr key={`${part.partNumber}-${part.description}`} className="border-t border-line-2">
                    <td className="px-3 py-2 font-mono text-ink">{part.partNumber}</td>
                    <td className="px-3 py-2 font-mono text-ink">{part.oemPartNumber || part.oemEquivalentPartNumber || '—'}</td>
                    <td className="px-3 py-2 text-ink">{part.description}</td>
                    <td className="px-3 py-2 text-muted">{part.supplier || part.brand}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex border rounded-full px-2 py-0.5 ${fitmentClass(part.fitmentType)}`}>
                        {part.fitmentType || 'Aftermarket'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">${Number(part.price || 0).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex border rounded-full px-2 py-0.5 ${availabilityClass(part.availability)}`}>
                        {part.availability}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => addToRO(part)}
                        disabled={addingPartNumber === part.partNumber}
                        className="rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
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
    </AppOverlay>
  )
}
