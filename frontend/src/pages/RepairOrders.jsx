import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ChevronRight, Search } from 'lucide-react'
import api from '../lib/api'
import AddROModal from '../components/AddROModal'
import StatusBadge from '../components/StatusBadge'
import PaymentStatusBadge, { normalizePaymentStatus } from '../components/PaymentStatusBadge'

export const STATUS_COLORS = {
  intake: '#64748b', estimate: '#3b82f6', approval: '#eab308',
  parts: '#f97316', repair: '#22c55e', paint: '#a855f7',
  qc: '#06b6d4', delivery: '#10b981', closed: '#374151'
}
export const STATUS_LABELS = {
  intake: 'Intake', estimate: 'Estimate', approval: 'Approval',
  parts: 'Parts', repair: 'Repair', paint: 'Paint',
  qc: 'QC Check', delivery: 'Delivery', closed: 'Closed'
}
const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery']

export default function RepairOrders() {
  const [ros, setRos] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [techs, setTechs] = useState([])
  const [filters, setFilters] = useState({ search: '', status: 'all', tech: 'all' })
  const navigate = useNavigate()

  const load = () => api.get('/ros').then((r) => setRos(r.data.ros || []))

  useEffect(() => {
    load()
    api.get('/users')
      .then((r) => setTechs((r.data.users || []).filter((u) => ['owner', 'admin', 'employee', 'staff'].includes(u.role))))
      .catch(() => setTechs([]))
  }, [])

  async function advanceStatus(ro, e) {
    e.stopPropagation()
    const idx = STAGES.indexOf(ro.status)
    if (idx < STAGES.length - 1) {
      await api.put(`/ros/${ro.id}/status`, { status: STAGES[idx + 1] })
      load()
    }
  }

  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t.name])), [techs])

  const filteredRos = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return ros.filter((ro) => {
      if (filters.status !== 'all' && ro.status !== filters.status) return false
      if (filters.tech !== 'all' && ro.assigned_to !== filters.tech) return false
      if (!q) return true
      const customer = String(ro.customer_name || '').toLowerCase()
      const roNum = String(ro.ro_number || '').toLowerCase()
      const vehicle = `${ro.year || ''} ${ro.make || ''} ${ro.model || ''}`.toLowerCase()
      return customer.includes(q) || roNum.includes(q) || vehicle.includes(q)
    })
  }, [ros, filters])

  const hasActiveFilters = Boolean(filters.search.trim()) || filters.status !== 'all' || filters.tech !== 'all'

  const byStatus = (stage) => filteredRos.filter((r) => r.status === stage)

  function clearFilters() {
    setFilters({ search: '', status: 'all', tech: 'all' })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Repair Orders</h1>
          <p className="text-slate-500 text-sm">{ros.length} total · {ros.filter((r) => r.status !== 'delivery' && r.status !== 'closed').length} active</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          <Plus size={16} /> New RO
        </button>
      </div>

      <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-3">
        <div className="grid md:grid-cols-4 gap-2">
          <div className="md:col-span-2 relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search customer, vehicle, or RO#"
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
          >
            <option value="all">All Statuses</option>
            <option value="intake">Intake</option>
            <option value="estimate">Estimate</option>
            <option value="approval">Approval</option>
            <option value="parts">Parts</option>
            <option value="repair">Repair</option>
            <option value="paint">Paint</option>
            <option value="qc">QC</option>
            <option value="delivery">Delivery</option>
          </select>
          <div className="flex gap-2">
            <select
              value={filters.tech}
              onChange={(e) => setFilters((f) => ({ ...f, tech: e.target.value }))}
              className="flex-1 bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#EAB308]"
            >
              <option value="all">All Techs</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              onClick={clearFilters}
              className="bg-[#0f1117] border border-[#2a2d3e] hover:border-[#EAB308]/60 text-slate-300 text-sm px-3 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {filteredRos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl">
          <img src="/empty-ros.png" alt="No repair orders" className="w-40 h-40 opacity-80 object-contain" />
          <p className="text-slate-400 text-sm font-medium">No repair orders match your filters.</p>
          <p className="text-slate-600 text-xs">Try clearing filters or creating a new RO.</p>
        </div>
      ) : hasActiveFilters ? (
        <div className="space-y-2">
          {filteredRos.map((ro) => {
            const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
            return (
              <div
                key={ro.id}
                onClick={() => navigate(`/ros/${ro.id}`)}
                className="bg-[#1a1d2e] border border-[#2a2d3e] hover:border-[#EAB308]/50 rounded-xl p-3 cursor-pointer transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[#EAB308] text-xs font-bold">{ro.ro_number}</p>
                    <p className="text-white font-semibold text-sm">{[ro.year, ro.make, ro.model].filter(Boolean).join(' ')}</p>
                    <p className="text-slate-400 text-xs">{ro.customer_name || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={ro.status} />
                    <PaymentStatusBadge status={normalizePaymentStatus(ro.payment_status, ro.payment_received)} paymentReceived={ro.payment_received} />
                    <span className="text-xs text-slate-500">{daysIn}d in shop</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500 flex flex-wrap gap-3">
                  <span>Tech: {techById[ro.assigned_to] || 'Unassigned'}</span>
                  <span className="capitalize">Type: {ro.job_type || '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="kanban-scroll">
          <div className="flex gap-3 min-w-max pb-2">
            {STAGES.map((stage) => (
              <div key={stage} className="w-64 flex-shrink-0">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[stage] }} />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">{STATUS_LABELS[stage]}</span>
                  <span className="ml-auto text-xs bg-[#2a2d3e] text-slate-400 px-2 py-0.5 rounded-full">{byStatus(stage).length}</span>
                </div>
                <div className="space-y-2">
                  {byStatus(stage).map((ro) => {
                    const daysIn = ro.intake_date ? Math.floor((Date.now() - new Date(ro.intake_date)) / 86400000) : 0
                    const daysColor = daysIn > 14 ? 'text-red-400 bg-red-900/20' : daysIn > 7 ? 'text-yellow-400 bg-yellow-900/20' : 'text-emerald-400 bg-emerald-900/20'
                    return (
                      <div key={ro.id} onClick={() => navigate(`/ros/${ro.id}`)}
                        className="bg-[#1a1d2e] border border-[#2a2d3e] hover:border-[#EAB308]/50 rounded-xl p-3 transition-all duration-150 hover:bg-[#1e2235] hover:scale-[1.01] cursor-pointer group"
                        style={{ borderLeft: `3px solid ${STATUS_COLORS[stage]}` }}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-xs font-bold text-[#EAB308]">{ro.ro_number}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${ro.payment_type === 'cash' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-blue-900/40 text-blue-400'}`}>
                            {ro.payment_type}
                          </span>
                        </div>
                        <div className="mb-2">
                          <StatusBadge status={ro.status} />
                        </div>
                        <div className="mb-2">
                          <PaymentStatusBadge status={normalizePaymentStatus(ro.payment_status, ro.payment_received)} paymentReceived={ro.payment_received} />
                        </div>
                        <div className="text-sm font-bold text-white leading-tight">{ro.year} {ro.make} {ro.model}</div>
                        <div className="text-xs text-slate-300 mt-0.5 truncate">{ro.customer_name}</div>
                        <div className="text-[10px] text-slate-500 mt-1 capitalize">{ro.color} · {ro.job_type}</div>
                        <div className="flex items-center justify-between mt-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${daysColor}`}>
                            {daysIn}d in shop
                          </span>
                          {ro.total > 0 && <span className="text-[10px] text-slate-400 font-medium">${ro.total?.toLocaleString()}</span>}
                        </div>
                        {ro.estimated_delivery && (
                          <div className="text-[9px] text-slate-600 mt-1">Est: {ro.estimated_delivery}</div>
                        )}
                        {stage !== 'delivery' && (
                          <button onClick={(e) => advanceStatus(ro, e)}
                            className="mt-2 w-full flex items-center justify-center gap-1 text-[10px] text-slate-500 hover:text-[#EAB308] hover:bg-yellow-900/20 rounded-lg py-1.5 transition-all opacity-0 group-hover:opacity-100 border border-transparent hover:border-yellow-800/40">
                            Move to {STATUS_LABELS[STAGES[STAGES.indexOf(stage) + 1]]} <ChevronRight size={10} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {byStatus(stage).length === 0 && (
                    <div className="text-center text-slate-600 text-xs py-8 border border-dashed border-[#2a2d3e] rounded-xl leading-relaxed">
                      No repair orders in this stage yet.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && <AddROModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}
