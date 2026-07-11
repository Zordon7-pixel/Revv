import { useEffect, useState } from 'react'
import { Search, Phone, Shield, X, Mail, MapPin, Car, FileText, ChevronRight, User, Pencil, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { isAdmin, isAssistant } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../components/ui'

const LETTERS = ['All', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))]

function getLastName(name) {
  const parts = (name || '').trim().split(/\s+/)
  return parts[parts.length - 1] || ''
}

const EMPTY_CUSTOMER_FORM = {
  name: '',
  phone: '',
  email: '',
  address: '',
  insurance_company: '',
  policy_number: '',
}

function createCustomerForm(customer = {}) {
  return {
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    address: customer?.address || '',
    insurance_company: customer?.insurance_company || '',
    policy_number: customer?.policy_number || '',
  }
}

function normalizeCustomerForm(form) {
  return {
    name: String(form.name || '').trim(),
    phone: String(form.phone || '').trim(),
    email: String(form.email || '').trim(),
    address: String(form.address || '').trim(),
    insurance_company: String(form.insurance_company || '').trim(),
    policy_number: String(form.policy_number || '').trim(),
  }
}

function CustomerFormFields({ form, onChange }) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Full Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="John Doe"
          autoComplete="name"
          enterKeyHint="next"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Phone</label>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          placeholder="(212) 555-0100"
          autoComplete="tel"
          inputMode="tel"
          enterKeyHint="next"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Email</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
          placeholder="john@example.com"
          autoComplete="email"
          inputMode="email"
          enterKeyHint="next"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Address</label>
        <input
          type="text"
          value={form.address}
          onChange={(e) => onChange('address', e.target.value)}
          placeholder="123 Main St"
          autoComplete="street-address"
          enterKeyHint="next"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Insurance Company</label>
        <input
          type="text"
          value={form.insurance_company}
          onChange={(e) => onChange('insurance_company', e.target.value)}
          placeholder="State Farm, GEICO..."
          enterKeyHint="next"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted mb-1">Policy Number</label>
        <input
          type="text"
          value={form.policy_number}
          onChange={(e) => onChange('policy_number', e.target.value)}
          placeholder="POL123456"
          enterKeyHint="done"
          className="w-full bg-void border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-600 focus:outline-none focus:border-brand"
        />
      </div>
    </>
  )
}

function CustomerFormModal({ title, form, error, loading, onChange, onClose, onSubmit, submitLabel }) {
  function handleClose() {
    if (!loading) onClose()
  }

  return (
    <AppOverlay
      label={title}
      onClose={handleClose}
      className="sheet-modal-overlay items-end bg-black/70 p-0 sm:items-center sm:p-4"
    >
      <form
        className="sheet-modal-card bg-panel rounded-instrument border border-line-2"
        onSubmit={onSubmit}
      >
        <div className="sheet-modal-header border-b border-line-2 px-5 sm:px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="text-muted hover:text-ink transition-colors"
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>
        <div className="sheet-modal-body px-5 sm:px-6 py-4 space-y-3">
          <CustomerFormFields form={form} onChange={onChange} />
          {error && <p role="alert" className="text-sm text-crit">{error}</p>}
        </div>
        <div className="sheet-modal-footer border-t border-line-2 px-5 sm:px-6 py-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-brand hover:bg-brand-lit disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Saving...' : submitLabel}
          </button>
        </div>
      </form>
    </AppOverlay>
  )
}

function CustomerDrawer({ customerId, onClose, adminUser, onEdit, onDelete }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('info')

  useEffect(() => {
    setActiveTab('info')
    setLoading(true)
    api.get(`/customers/${customerId}/full`).then(r => {
      setData(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [customerId])

  return (
    <AppOverlay label="Customer 360" onClose={onClose} className="bg-black/60 p-0">
      <div className="absolute inset-y-0 right-0 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-line-2 bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-2 flex-shrink-0">
          <h2 className="font-bold text-ink text-sm">Customer 360</h2>
          <div className="flex items-center gap-1">
            {adminUser && data?.customer && (
              <>
                <button
                  onClick={() => onEdit(data.customer)}
                  className="p-1.5 rounded-lg text-muted hover:text-brand-lit hover:bg-void transition-colors"
                  title="Edit customer"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => onDelete(data.customer)}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-crit/10 hover:text-crit"
                  title="Delete customer"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button onClick={onClose} className="text-muted hover:text-ink transition-colors"><X size={18}/></button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-faint text-sm">Loading...</div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center text-faint text-sm">Failed to load</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="flex items-center gap-1 rounded-lg bg-void p-1 border border-line-2">
              <button
                onClick={() => setActiveTab('info')}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'info' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
              >
                Info
              </button>
              <button
                onClick={() => setActiveTab('vehicles')}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'vehicles' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
              >
                Vehicles ({data.vehicles.length})
              </button>
              <button
                onClick={() => setActiveTab('ros')}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'ros' ? 'bg-brand text-white' : 'text-muted hover:text-ink'}`}
              >
                Repair Orders ({data.ros.length})
              </button>
            </div>

            {activeTab === 'info' && (
              <div className="bg-void rounded-instrument p-4 space-y-2.5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full border border-brand bg-panel-2 flex items-center justify-center flex-shrink-0">
                    <User size={18} className="text-brand" />
                  </div>
                  <div>
                    <div className="font-bold text-ink">{data.customer.name}</div>
                    <div className="text-xs text-faint">Customer ID #{data.customer.id?.slice(-6)}</div>
                  </div>
                </div>
                {data.customer.phone && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Phone size={12} className="text-faint flex-shrink-0"/>
                    <a href={`tel:${data.customer.phone}`} className="hover:text-brand">{data.customer.phone}</a>
                  </div>
                )}
                {data.customer.email && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Mail size={12} className="text-faint flex-shrink-0"/>
                    <a href={`mailto:${data.customer.email}`} className="hover:text-brand truncate">{data.customer.email}</a>
                  </div>
                )}
                {data.customer.address && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <MapPin size={12} className="text-faint flex-shrink-0"/>
                    {data.customer.address}
                  </div>
                )}
                {data.customer.insurance_company && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Shield size={12} className="text-faint flex-shrink-0"/>
                    {data.customer.insurance_company} {data.customer.policy_number ? `· ${data.customer.policy_number}` : ''}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'vehicles' && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Car size={14} className="text-brand"/>
                  <span className="text-xs font-bold text-ink uppercase tracking-wide">Vehicles ({data.vehicles.length})</span>
                </div>
                {data.vehicles.length === 0 ? (
                  <div className="text-xs text-faint bg-void rounded-instrument p-3">No vehicles on file</div>
                ) : (
                  <div className="space-y-2">
                    {data.vehicles.map(v => (
                      <div key={v.id} className="bg-void rounded-instrument p-3">
                        <div className="text-sm font-semibold text-ink">{v.year} {v.make} {v.model}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {v.color && <span className="text-[10px] text-faint">{v.color}</span>}
                          {v.plate && <span className="text-[10px] text-muted font-mono">{v.plate}</span>}
                          {v.vin && <span className="text-[10px] text-faint font-mono truncate">{v.vin}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'ros' && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={14} className="text-brand"/>
                  <span className="text-xs font-bold text-ink uppercase tracking-wide">Repair Orders ({data.ros.length})</span>
                </div>
                {data.ros.length === 0 ? (
                  <div className="text-xs text-faint bg-void rounded-instrument p-3">No repair orders</div>
                ) : (
                  <div className="space-y-2">
                    {data.ros.map(ro => (
                      <div key={ro.id} className="bg-void rounded-instrument p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-ink">{ro.ro_number}</span>
                          <StatusBadge status={ro.status} className="min-h-5 px-2 py-0.5 text-[10px]" />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-faint capitalize">{ro.job_type} · {new Date(ro.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</span>
                          {ro.total > 0 && <span className="font-mono text-[10px] font-semibold tabular-nums text-gold">${Number(ro.total).toLocaleString()}</span>}
                        </div>
                        {ro.notes && <div className="text-[10px] text-faint mt-1 truncate">{ro.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppOverlay>
  )
}

function EditCustomerModal({ customer, onClose, onSave }) {
  const [form, setForm] = useState(() => createCustomerForm(customer))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm(createCustomerForm(customer))
    setError('')
  }, [customer])

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  async function saveCustomer(event) {
    event.preventDefault()
    const payload = normalizeCustomerForm(form)
    if (!payload.name) {
      setError('Name is required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/customers/${customer.id}`, payload)
      await onSave()
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Error updating customer.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <CustomerFormModal
      title="Edit Customer"
      form={form}
      error={error}
      loading={loading}
      onChange={updateField}
      onClose={onClose}
      onSubmit={saveCustomer}
      submitLabel="Save Customer"
    />
  )
}

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [q, setQ] = useState('')
  const [activeLetter, setActiveLetter] = useState('All')
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [form, setForm] = useState(() => ({ ...EMPTY_CUSTOMER_FORM }))
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const adminUser = isAdmin()
  const assistantUser = isAssistant()

  async function refreshCustomers() {
    try {
      const r = await api.get('/customers')
      setCustomers(r.data.customers || [])
    } catch {
      // keep existing list on transient errors
    }
  }

  useEffect(() => { refreshCustomers() }, [])

  // Count per letter for badges
  const letterCounts = LETTERS.reduce((acc, letter) => {
    if (letter === 'All') {
      acc['All'] = customers.length
    } else {
      acc[letter] = customers.filter(c => getLastName(c.name).toUpperCase().startsWith(letter)).length
    }
    return acc
  }, {})

  const byLetter = activeLetter === 'All'
    ? customers
    : customers.filter(c => getLastName(c.name).toUpperCase().startsWith(activeLetter))

  const filtered = byLetter.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.phone || '').includes(q) ||
    (c.insurance_company || '').toLowerCase().includes(q.toLowerCase())
  )

  function openAddCustomerModal() {
    setForm({ ...EMPTY_CUSTOMER_FORM })
    setFormError('')
    setShowAdd(true)
  }

  function closeAddCustomerModal() {
    if (loading) return
    setShowAdd(false)
    setFormError('')
  }

  function updateAddCustomerField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (formError) setFormError('')
  }

  async function addCustomer(event) {
    event.preventDefault()
    const payload = normalizeCustomerForm(form)
    if (!payload.name) {
      setFormError('Name is required.')
      return
    }
    setLoading(true)
    setFormError('')
    try {
      await api.post('/customers', payload)
      await refreshCustomers()
      setShowAdd(false)
      setForm({ ...EMPTY_CUSTOMER_FORM })
    } catch (e) {
      setFormError(e?.response?.data?.error || 'Error saving customer.')
    } finally {
      setLoading(false)
    }
  }

  async function deleteCustomer(customer) {
    if (!customer?.id) return
    const confirmed = window.confirm(`Delete customer "${customer.name}"? This action cannot be undone.`)
    if (!confirmed) return
    setDeleteError('')
    try {
      await api.delete(`/customers/${customer.id}`)
      if (selectedId === customer.id) setSelectedId(null)
      await refreshCustomers()
      return true
    } catch (e) {
      const message = e?.response?.data?.error || 'Error deleting customer'
      if (e?.response?.status === 409) {
        setDeleteError(message)
      } else {
        console.error('[Customers] delete failed:', e)
        setDeleteError(message)
      }
      return false
    }
  }

  function editFromDrawer(customer) {
    setSelectedId(null)
    setEditingCustomer(customer)
  }

  async function deleteFromDrawer(customer) {
    if (await deleteCustomer(customer)) setSelectedId(null)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Customer book"
        title="Customers"
        description={`${customers.length} customer${customers.length === 1 ? '' : 's'} on file · ${customers.reduce((sum, customer) => sum + Number(customer.active_ro_count || 0), 0)} active repair orders`}
        actions={!assistantUser && (
          <button onClick={openAddCustomerModal} className="bg-brand hover:bg-brand-lit text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
            + Add Customer
          </button>
        )}
      />

      {deleteError && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {deleteError}
        </div>
      )}

      <Panel className="p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, phone, insurer..."
            aria-label="Search customers"
            className="w-full rounded-lg border border-line-2 bg-void py-2.5 pl-9 pr-4 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-brand" />
        </div>
        {customers.length > 0 && (
          <div className="mt-3 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1">
            {LETTERS.map(letter => {
              const count = letterCounts[letter] || 0
              const active = activeLetter === letter
              const hasCustomers = count > 0
              return (
                <button
                  key={letter}
                  onClick={() => setActiveLetter(letter)}
                  disabled={!hasCustomers && letter !== 'All'}
                  className={`relative flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-brand text-white'
                      : hasCustomers
                        ? 'bg-panel border border-line-2 text-muted hover:border-brand hover:text-ink'
                        : 'bg-panel border border-line-2 text-faint cursor-default'
                  }`}
                >
                  {letter}
                  {hasCustomers && (
                    <span className={`ml-1 text-[9px] font-bold ${active ? 'text-brand-lit' : 'text-faint'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            </div>
          </div>
        )}
      </Panel>

      {customers.length === 0 ? (
        <Panel>
          <EmptyState
            media={<img src="/empty-customers.png" alt="" className="mx-auto h-32 w-32 object-contain" />}
            title="Your customer book is waiting."
            description="Add the first customer to connect their vehicles, repair orders, and communication history."
            action={!assistantUser && <button type="button" onClick={openAddCustomerModal} className="revv-btn revv-btn-primary">Add customer</button>}
          />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel><EmptyState icon={Search} title="No customers found" description="Change the search or letter filter and try again." /></Panel>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <article key={c.id}
              onClick={() => setSelectedId(c.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(c.id)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Open ${c.name}`}
              className="group relative cursor-pointer rounded-instrument border border-line bg-panel p-4 transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand">
              {adminUser && (
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingCustomer(c)
                    }}
                    className="p-1.5 rounded-lg text-muted hover:text-brand-lit hover:bg-void transition-colors"
                    title="Edit customer"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCustomer(c)
                    }}
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-crit/10 hover:text-crit"
                    title="Delete customer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="font-semibold text-ink text-sm mb-2 group-hover:text-brand-lit transition-colors">{c.name}</div>
                {!adminUser && <ChevronRight size={14} className="text-faint group-hover:text-brand mt-0.5 flex-shrink-0 transition-colors" />}
              </div>
              {c.phone && <div className="flex items-center gap-2 text-xs text-muted mb-1"><Phone size={11} /> {c.phone}</div>}
              {c.insurance_company && <div className="flex items-center gap-2 text-xs text-muted"><Shield size={11} /> {c.insurance_company} {c.policy_number ? `· ${c.policy_number}` : ''}</div>}
              {c.address && <div className="mt-1.5 truncate text-xs text-faint">{c.address}</div>}
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div><strong className="block font-mono text-sm text-ink">{Number(c.vehicle_count || 0)}</strong><span className="text-[10px] text-faint">Vehicles</span></div>
                <div><strong className="block font-mono text-sm text-ink">{Number(c.ro_count || 0)}</strong><span className="text-[10px] text-faint">ROs</span></div>
                <div><strong className="block font-mono text-sm text-brand">{Number(c.active_ro_count || 0)}</strong><span className="text-[10px] text-faint">Active</span></div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAdd && !assistantUser && (
        <CustomerFormModal
          title="New Customer"
          form={form}
          error={formError}
          loading={loading}
          onChange={updateAddCustomerField}
          onClose={closeAddCustomerModal}
          onSubmit={addCustomer}
          submitLabel="Save Customer"
        />
      )}

      {/* Customer 360 Drawer */}
      {selectedId && (
        <CustomerDrawer
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
          adminUser={adminUser}
          onEdit={editFromDrawer}
          onDelete={deleteFromDrawer}
        />
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <EditCustomerModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSave={refreshCustomers}
        />
      )}
    </div>
  )
}
