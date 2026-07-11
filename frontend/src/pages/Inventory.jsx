import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import { isAssistant } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'
import { EmptyState, Money, PageHeader, Panel } from '../components/ui'

const EMPTY_FORM = {
  part_number: '',
  name: '',
  qty_on_hand: '0',
  reorder_point: '0',
  cost: '0.00',
  supplier: '',
  location: '',
}

function toForm(item = {}) {
  return {
    part_number: item.part_number || '',
    name: item.name || '',
    qty_on_hand: String(item.qty_on_hand ?? 0),
    reorder_point: String(item.reorder_point ?? 0),
    cost: (Number(item.cost_cents || 0) / 100).toFixed(2),
    supplier: item.supplier || '',
    location: item.location || '',
  }
}

function isLowStock(item) {
  return Number(item.qty_on_hand || 0) <= Number(item.reorder_point || 0)
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const assistant = isAssistant()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/inventory')
      setItems(data.items || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load inventory.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => [item.part_number, item.name, item.supplier, item.location]
      .some((value) => String(value || '').toLowerCase().includes(needle)))
  }, [items, query])

  function openCreate() {
    setEditing({ id: null })
    setForm({ ...EMPTY_FORM })
    setError('')
  }

  function openEdit(item) {
    setEditing(item)
    setForm(toForm(item))
    setError('')
  }

  async function saveItem(event) {
    event.preventDefault()
    const partNumber = form.part_number.trim()
    const name = form.name.trim()
    if (!partNumber || !name) {
      setError('Part number and name are required.')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      part_number: partNumber,
      name,
      qty_on_hand: Math.max(0, Number.parseInt(form.qty_on_hand, 10) || 0),
      reorder_point: Math.max(0, Number.parseInt(form.reorder_point, 10) || 0),
      cost_cents: Math.max(0, Math.round((Number(form.cost) || 0) * 100)),
      supplier: form.supplier.trim(),
      location: form.location.trim(),
    }
    try {
      if (editing?.id) await api.put(`/inventory/${editing.id}`, payload)
      else await api.post('/inventory', payload)
      setEditing(null)
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save inventory item.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete ${item.name} from inventory?`)) return
    setError('')
    try {
      await api.delete(`/inventory/${item.id}`)
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not delete inventory item.')
    }
  }

  const units = items.reduce((sum, item) => sum + Number(item.qty_on_hand || 0), 0)
  const lowStock = items.filter(isLowStock).length

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Stock room"
        title="Inventory"
        description={`${items.length} SKUs · ${units} units on hand · ${lowStock} at or below reorder point`}
        actions={!assistant && (
          <button type="button" onClick={openCreate} className="revv-btn revv-btn-primary min-h-10 px-4">
            <Plus size={15} /> Add item
          </button>
        )}
      />

      {error && <div role="alert" className="rounded-instrument border border-crit bg-panel px-4 py-3 text-sm text-crit">{error}</div>}

      <Panel className="p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search inventory"
            placeholder="Search part number, name, supplier, or location"
            className="w-full rounded-lg border border-line-2 bg-void py-2.5 pl-9 pr-4 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-brand"
          />
        </div>
      </Panel>

      {loading ? (
        <Panel><EmptyState icon={Package} title="Loading inventory" description="Checking stock levels and reorder points." /></Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Package}
            title={items.length ? 'No matching inventory' : 'Stock room is ready'}
            description={items.length ? 'Change the search and try again.' : 'Add consumables and commonly stocked parts to track on-hand quantities.'}
            action={!items.length && !assistant && <button type="button" onClick={openCreate} className="revv-btn revv-btn-primary">Add first item</button>}
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {filtered.map((item) => (
              <article key={item.id} className="rounded-instrument border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-display text-sm font-semibold text-ink">{item.name}</p><p className="mt-1 font-mono text-xs text-brand">{item.part_number}</p></div>
                  {isLowStock(item) && <span className="inline-flex items-center gap-1 text-xs font-semibold text-crit"><AlertTriangle size={13} /> Low</span>}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                  <div><dt className="text-faint">On hand</dt><dd className="mt-1 font-mono text-ink">{item.qty_on_hand}</dd></div>
                  <div><dt className="text-faint">Reorder</dt><dd className="mt-1 font-mono text-ink">{item.reorder_point}</dd></div>
                  <div><dt className="text-faint">Unit cost</dt><dd className="mt-1"><Money cents={item.cost_cents || 0} className="text-gold" /></dd></div>
                </dl>
                <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>{item.location || 'No location'}</span>{!assistant && <button type="button" onClick={() => openEdit(item)} className="text-brand hover:text-brand-lit">Edit</button>}</div>
              </article>
            ))}
          </div>

          <Panel className="hidden overflow-hidden md:block">
            <div className="table-scroll">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-panel-2 text-xs uppercase tracking-[0.08em] text-muted">
                  <tr>{['Part #', 'Item', 'On hand', 'Reorder', 'Unit cost', 'Supplier', 'Location', ''].map((label, index) => <th key={`${label}-${index}`} className="px-3 py-3 text-left font-semibold">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className="border-t border-line hover:bg-panel-2">
                      <td className="px-3 py-3 font-mono font-semibold text-brand">{item.part_number}</td>
                      <td className="px-3 py-3 font-medium text-ink">{item.name}</td>
                      <td className={`px-3 py-3 font-mono ${isLowStock(item) ? 'text-crit' : 'text-ink'}`}>{item.qty_on_hand}</td>
                      <td className="px-3 py-3 font-mono text-muted">{item.reorder_point}</td>
                      <td className="px-3 py-3"><Money cents={item.cost_cents || 0} className="text-gold" /></td>
                      <td className="px-3 py-3 text-muted">{item.supplier || '—'}</td>
                      <td className="px-3 py-3 text-muted">{item.location || '—'}</td>
                      <td className="px-3 py-3">
                        {!assistant && <div className="flex justify-end gap-1"><button type="button" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`} className="p-2 text-muted hover:text-brand"><Pencil size={14} /></button><button type="button" onClick={() => deleteItem(item)} aria-label={`Delete ${item.name}`} className="p-2 text-muted hover:text-crit"><Trash2 size={14} /></button></div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {editing && !assistant && (
        <AppOverlay label={editing.id ? 'Edit inventory item' : 'Add inventory item'} onClose={() => !saving && setEditing(null)} className="bg-black/70 p-4 md:pl-60">
          <form onSubmit={saveItem} className="sheet-modal-card rounded-instrument border border-line-2 bg-panel">
            <div className="sheet-modal-header flex items-center justify-between border-b border-line px-5 py-4"><h2 className="font-display text-lg font-semibold text-ink">{editing.id ? 'Edit inventory item' : 'Add inventory item'}</h2><button type="button" onClick={() => setEditing(null)} aria-label="Close inventory editor" className="text-muted hover:text-ink"><X size={18} /></button></div>
            <div className="sheet-modal-body grid gap-3 px-5 py-4 sm:grid-cols-2">
              {error && <div role="alert" className="rounded-instrument border border-crit px-3 py-2 text-sm text-crit sm:col-span-2">{error}</div>}
              {[
                ['part_number', 'Part number', 'text'], ['name', 'Item name', 'text'], ['qty_on_hand', 'Quantity on hand', 'number'], ['reorder_point', 'Reorder point', 'number'], ['cost', 'Unit cost ($)', 'number'], ['supplier', 'Supplier', 'text'], ['location', 'Location', 'text'],
              ].map(([field, label, type]) => (
                <label key={field} className={field === 'name' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-medium text-muted">{label}</span><input type={type} min={type === 'number' ? '0' : undefined} step={field === 'cost' ? '0.01' : undefined} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} required={field === 'part_number' || field === 'name'} className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand" /></label>
              ))}
            </div>
            <div className="sheet-modal-footer flex justify-end gap-2 border-t border-line px-5 py-4"><button type="button" onClick={() => setEditing(null)} className="revv-btn revv-btn-secondary">Cancel</button><button type="submit" disabled={saving} className="revv-btn revv-btn-primary">{saving ? 'Saving…' : 'Save item'}</button></div>
          </form>
        </AppOverlay>
      )}
    </div>
  )
}
