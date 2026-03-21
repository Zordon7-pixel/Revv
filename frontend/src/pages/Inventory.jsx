import { useEffect, useState } from 'react'
import { Filter, PackagePlus, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { isAssistant } from '../lib/auth'

const INPUT_CLASS = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500'

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

export default function Inventory() {
  const readOnly = isAssistant()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newItem, setNewItem] = useState({
    part_number: '',
    name: '',
    qty_on_hand: 0,
    reorder_point: 0,
    cost_cents: 0,
    supplier: '',
    location: '',
  })

  async function loadInventory(nextLowOnly = lowOnly) {
    setLoading(true)
    setError('')
    try {
      const endpoint = nextLowOnly ? '/inventory/low-stock' : '/inventory'
      const { data } = await api.get(endpoint)
      setItems(data.items || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load inventory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInventory(false)
  }, [])

  function setField(id, field, value) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }

  async function saveField(id, field, value) {
    if (readOnly) return

    const payload = {}
    if (['qty_on_hand', 'reorder_point', 'cost_cents'].includes(field)) {
      payload[field] = Math.max(0, toInt(value, 0))
    } else {
      payload[field] = String(value || '').trim()
    }

    setSavingId(id)
    try {
      const { data } = await api.put(`/inventory/${id}`, payload)
      setItems((prev) => prev.map((item) => (item.id === id ? data.item : item)))
      if (lowOnly) {
        await loadInventory(true)
      }
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not update inventory item')
      await loadInventory(lowOnly)
    } finally {
      setSavingId(null)
    }
  }

  async function addItem(e) {
    e.preventDefault()
    if (readOnly) return

    setAdding(true)
    try {
      await api.post('/inventory', {
        part_number: newItem.part_number,
        name: newItem.name,
        qty_on_hand: Math.max(0, toInt(newItem.qty_on_hand, 0)),
        reorder_point: Math.max(0, toInt(newItem.reorder_point, 0)),
        cost_cents: Math.max(0, toInt(newItem.cost_cents, 0)),
        supplier: newItem.supplier,
        location: newItem.location,
      })
      setNewItem({
        part_number: '',
        name: '',
        qty_on_hand: 0,
        reorder_point: 0,
        cost_cents: 0,
        supplier: '',
        location: '',
      })
      await loadInventory(lowOnly)
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not add inventory item')
    } finally {
      setAdding(false)
    }
  }

  async function deleteItem(id) {
    if (readOnly) return
    if (!confirm('Delete this inventory item?')) return

    setDeletingId(id)
    try {
      await api.delete(`/inventory/${id}`)
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      alert(err?.response?.data?.error || 'Could not delete inventory item')
    } finally {
      setDeletingId(null)
    }
  }

  async function toggleLowStock() {
    const next = !lowOnly
    setLowOnly(next)
    await loadInventory(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Parts Inventory</h1>
          <p className="text-sm text-slate-500">Track on-hand quantity and reorder points.</p>
        </div>
        <button
          type="button"
          onClick={toggleLowStock}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
            lowOnly
              ? 'bg-red-900/30 text-red-300 border-red-700/40'
              : 'bg-[#1a1d2e] text-slate-300 border-[#2a2d3e] hover:border-indigo-500'
          }`}
        >
          <Filter size={13} />
          {lowOnly ? 'Showing Low Stock' : 'Low-Stock Filter'}
        </button>
      </div>

      {!readOnly && (
        <form onSubmit={addItem} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <PackagePlus size={14} className="text-[#EAB308]" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Add Part</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            <input
              required
              className={INPUT_CLASS}
              value={newItem.part_number}
              onChange={(e) => setNewItem((prev) => ({ ...prev, part_number: e.target.value }))}
              placeholder="Part #"
            />
            <input
              required
              className={INPUT_CLASS}
              value={newItem.name}
              onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Name"
            />
            <input
              type="number"
              min="0"
              className={INPUT_CLASS}
              value={newItem.qty_on_hand}
              onChange={(e) => setNewItem((prev) => ({ ...prev, qty_on_hand: e.target.value }))}
              placeholder="Qty"
            />
            <input
              type="number"
              min="0"
              className={INPUT_CLASS}
              value={newItem.reorder_point}
              onChange={(e) => setNewItem((prev) => ({ ...prev, reorder_point: e.target.value }))}
              placeholder="Reorder Point"
            />
            <input
              type="number"
              min="0"
              className={INPUT_CLASS}
              value={newItem.cost_cents}
              onChange={(e) => setNewItem((prev) => ({ ...prev, cost_cents: e.target.value }))}
              placeholder="Cost (cents)"
            />
            <input
              className={INPUT_CLASS}
              value={newItem.supplier}
              onChange={(e) => setNewItem((prev) => ({ ...prev, supplier: e.target.value }))}
              placeholder="Supplier"
            />
            <input
              className={INPUT_CLASS}
              value={newItem.location}
              onChange={(e) => setNewItem((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="Location"
            />
            <button
              type="submit"
              disabled={adding}
              className="text-xs font-semibold bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] rounded-lg px-3 py-2 disabled:opacity-50"
            >
              {adding ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading inventory...</p>
      ) : (
        <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl overflow-x-auto">
          <table className="w-full text-xs min-w-[980px]">
            <thead className="bg-[#0f1117] text-slate-400 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Part #</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Qty On Hand</th>
                <th className="px-3 py-2 text-right">Reorder Point</th>
                <th className="px-3 py-2 text-right">Cost (cents)</th>
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isLowStock = Number(item.qty_on_hand || 0) <= Number(item.reorder_point || 0)
                return (
                  <tr
                    key={item.id}
                    className={`border-t border-[#2a2d3e] ${isLowStock ? 'bg-red-950/20' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        className={INPUT_CLASS}
                        value={item.part_number || ''}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'part_number', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'part_number', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={INPUT_CLASS}
                        value={item.name || ''}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'name', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'name', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`${INPUT_CLASS} text-right ${isLowStock ? 'border-red-700/50 text-red-200' : ''}`}
                        value={item.qty_on_hand ?? 0}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'qty_on_hand', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'qty_on_hand', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`${INPUT_CLASS} text-right ${isLowStock ? 'border-red-700/50 text-red-200' : ''}`}
                        value={item.reorder_point ?? 0}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'reorder_point', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'reorder_point', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`${INPUT_CLASS} text-right`}
                        value={item.cost_cents ?? 0}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'cost_cents', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'cost_cents', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={INPUT_CLASS}
                        value={item.supplier || ''}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'supplier', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'supplier', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={INPUT_CLASS}
                        value={item.location || ''}
                        disabled={readOnly || savingId === item.id}
                        onChange={(e) => setField(item.id, 'location', e.target.value)}
                        onBlur={(e) => saveField(item.id, 'location', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => deleteItem(item.id)}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                          title="Delete part"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              {lowOnly ? 'No low-stock items right now.' : 'No inventory items yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
