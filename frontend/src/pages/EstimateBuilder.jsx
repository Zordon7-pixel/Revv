import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import api from '../lib/api'

const ITEM_TYPES = ['labor', 'parts', 'sublet', 'other']

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function money(value) {
  return `$${asNumber(value, 0).toFixed(2)}`
}

export default function EstimateBuilder() {
  const { roId } = useParams()
  const navigate = useNavigate()
  const [ro, setRo] = useState(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      try {
        const [itemsRes, roRes] = await Promise.all([
          api.get(`/estimate-items/${roId}`),
          api.get(`/ros/${roId}`),
        ])
        if (!mounted) return
        setItems(itemsRes.data?.items || [])
        setSummary(itemsRes.data?.summary || null)
        setRo(roRes.data || null)
      } catch (err) {
        alert(err?.response?.data?.error || 'Could not load estimate builder')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [roId])

  const orderedItems = useMemo(
    () => [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [items]
  )

  function updateItemLocal(id, patch) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function saveItem(id, patch = null) {
    const current = items.find((item) => item.id === id)
    if (!current) return
    const next = patch ? { ...current, ...patch } : current
    setSavingId(id)
    try {
      const payload = {
        type: next.type,
        description: next.description || '',
        quantity: asNumber(next.quantity, 0),
        unit_price: asNumber(next.unit_price, 0),
        taxable: !!next.taxable,
        sort_order: Math.max(0, Math.trunc(asNumber(next.sort_order, 0))),
      }
      const { data } = await api.put(`/estimate-items/${roId}/${id}`, payload)
      updateItemLocal(id, data.item)
      setSummary(data.summary || null)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not save line item')
    } finally {
      setSavingId(null)
    }
  }

  async function addRow() {
    setAdding(true)
    try {
      const nextSort = items.length
      const { data } = await api.post(`/estimate-items/${roId}`, {
        type: 'labor',
        description: '',
        quantity: 1,
        unit_price: 0,
        taxable: false,
        sort_order: nextSort,
      })
      setItems((prev) => [...prev, data.item])
      setSummary(data.summary || null)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not add line item')
    } finally {
      setAdding(false)
    }
  }

  async function deleteRow(itemId) {
    setDeletingId(itemId)
    try {
      const { data } = await api.delete(`/estimate-items/${roId}/${itemId}`)
      setItems((prev) => prev.filter((item) => item.id !== itemId))
      setSummary(data.summary || null)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete line item')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return <div className="text-slate-400">Loading estimate builder...</div>
  }

  const totals = summary || {
    subtotal: 0,
    labor_total: 0,
    parts_total: 0,
    sublet_total: 0,
    other_total: 0,
    taxable_subtotal: 0,
    tax_rate: 0,
    tax_amount: 0,
    grand_total: 0,
    line_count: 0,
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate(`/ros/${roId}`)} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">Estimate Builder</h1>
          <p className="text-slate-500 text-sm truncate">{ro?.ro_number || roId} {ro?.customer?.name ? `· ${ro.customer.name}` : ''}</p>
        </div>
        <button
          onClick={addRow}
          disabled={adding}
          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Plus size={12} /> {adding ? 'Adding...' : 'Add Row'}
        </button>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#0f1117] text-slate-400">
            <tr>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Unit Price</th>
              <th className="text-center px-3 py-2">Taxable</th>
              <th className="text-right px-3 py-2">Sort</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">No line items yet.</td>
              </tr>
            ) : orderedItems.map((item) => (
              <tr key={item.id} className="border-t border-[#2a2d3e]">
                <td className="px-3 py-2">
                  <select
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white"
                    value={item.type}
                    onChange={(e) => {
                      const patch = { type: e.target.value }
                      updateItemLocal(item.id, patch)
                      saveItem(item.id, patch)
                    }}
                  >
                    {ITEM_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white"
                    value={item.description || ''}
                    onChange={(e) => updateItemLocal(item.id, { description: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                    placeholder="Line item description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.quantity}
                    onChange={(e) => updateItemLocal(item.id, { quantity: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.unit_price}
                    onChange={(e) => updateItemLocal(item.id, { unit_price: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!item.taxable}
                    className="accent-indigo-500"
                    onChange={(e) => {
                      const patch = { taxable: e.target.checked }
                      updateItemLocal(item.id, patch)
                      saveItem(item.id, patch)
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-white text-right"
                    value={item.sort_order}
                    onChange={(e) => updateItemLocal(item.id, { sort_order: e.target.value })}
                    onBlur={() => saveItem(item.id)}
                  />
                </td>
                <td className="px-3 py-2 text-right text-white font-medium">{money(item.total)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => deleteRow(item.id)}
                    disabled={deletingId === item.id}
                    className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 text-xs"
                  >
                    <Trash2 size={13} /> {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                  {savingId === item.id && <span className="ml-2 text-[11px] text-slate-500">Saving...</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#2a2d3e] bg-[#0f1117] text-slate-300 text-xs">
              <td className="px-3 py-2" colSpan={3}>Labor: {money(totals.labor_total)}</td>
              <td className="px-3 py-2">Parts: {money(totals.parts_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Sublet: {money(totals.sublet_total)}</td>
              <td className="px-3 py-2" colSpan={2}>Other: {money(totals.other_total)}</td>
            </tr>
            <tr className="border-t border-[#2a2d3e] bg-[#0f1117] text-slate-200 text-sm font-medium">
              <td className="px-3 py-2" colSpan={3}>Taxable Subtotal: {money(totals.taxable_subtotal)}</td>
              <td className="px-3 py-2" colSpan={2}>Tax ({(asNumber(totals.tax_rate, 0) * 100).toFixed(2)}%): {money(totals.tax_amount)}</td>
              <td className="px-3 py-2 text-right" colSpan={2}>Subtotal: {money(totals.subtotal)}</td>
              <td className="px-3 py-2 text-right">Grand Total: {money(totals.grand_total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
