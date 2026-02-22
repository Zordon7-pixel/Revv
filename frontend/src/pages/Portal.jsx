import { useEffect, useState } from 'react'
import { Phone, Car, Calendar, LogOut, Wrench } from 'lucide-react'
import api from '../lib/api'

const STATUS_PROGRESS = {
  intake:   1, estimate: 2, approval: 3, parts: 4,
  repair:   5, paint:    6, qc:       7, delivery: 8, closed: 8,
}
const TOTAL_STEPS = 8

export default function Portal() {
  const [ros,  setRos]  = useState([])
  const [shop, setShop] = useState(null)

  useEffect(() => {
    api.get('/portal/my-ros').then(r => setRos(r.data.ros || []))
    api.get('/portal/shop').then(r => setShop(r.data))
  }, [])

  function logout() {
    localStorage.removeItem('sc_token')
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* Header */}
      <header className="bg-[#1a1d2e] border-b border-[#2a2d3e] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Wrench size={15} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-sm text-white">{shop?.name || 'Auto Body Shop'}</div>
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors">
          <LogOut size={14} /> Sign Out
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Shop Contact */}
        {shop?.phone && (
          <a href={`tel:${shop.phone}`}
            className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-xl px-4 py-3">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Phone size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-indigo-200">Tap to call the shop</div>
              <div className="font-bold text-white">{shop.phone}</div>
            </div>
            <div className="text-white/60 text-xs">{shop.address}{shop.city ? `, ${shop.city}` : ''}</div>
          </a>
        )}

        {/* Repair Orders */}
        {ros.length === 0 ? (
          <div className="bg-[#1a1d2e] rounded-2xl p-8 text-center border border-[#2a2d3e]">
            <Car size={36} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No repair orders found for your account.</p>
            <p className="text-slate-600 text-xs mt-1">Contact the shop if you believe this is an error.</p>
          </div>
        ) : ros.map(ro => {
          const step = STATUS_PROGRESS[ro.status] || 1
          const pct  = Math.round((step / TOTAL_STEPS) * 100)
          const info = ro.status_info || {}
          const isDone = ro.status === 'delivery' || ro.status === 'closed'

          return (
            <div key={ro.ro_number} className="bg-[#1a1d2e] rounded-2xl border border-[#2a2d3e] overflow-hidden">
              {/* Vehicle header */}
              <div className="px-5 pt-5 pb-4 border-b border-[#2a2d3e]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="text-3xl">{info.emoji || '🔧'}</div>
                    <div>
                      <div className="font-bold text-white">{ro.year} {ro.make} {ro.model}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{ro.color} · Plate: {ro.plate} · {ro.ro_number}</div>
                    </div>
                  </div>
                  <div className={`text-xs font-semibold px-3 py-1.5 rounded-full ${isDone ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40' : 'bg-indigo-900/40 text-indigo-400 border border-indigo-700/40'}`}>
                    {info.label || ro.status}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-2">
                  <span>Progress</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 bg-[#0f1117] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${isDone ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{width:`${pct}%`}} />
                </div>
              </div>

              {/* Status message */}
              <div className="px-5 pb-4">
                <p className="text-sm text-slate-300 leading-relaxed">{info.msg}</p>
              </div>

              {/* Pending parts — plain English delay explanation */}
              {ro.pending_parts?.length > 0 && (
                <div className="px-5 pb-4">
                  <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl p-3">
                    <div className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
                      ⏳ Still waiting on parts
                    </div>
                    <div className="space-y-1.5">
                      {ro.pending_parts.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-300">{p.part_name}</span>
                          <span className={p.status === 'backordered' ? 'text-red-400 font-medium' : 'text-amber-400'}>
                            {p.status === 'backordered' ? 'Backordered' : p.expected_date ? `Expected ${p.expected_date}` : 'On order'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">We'll move as fast as possible — call us if you have questions.</p>
                  </div>
                </div>
              )}

              {/* Dates */}
              <div className="px-5 pb-5 flex gap-4 flex-wrap">
                {ro.intake_date && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Calendar size={11} className="text-slate-600" />
                    Dropped off: <span className="text-slate-400">{ro.intake_date}</span>
                  </div>
                )}
                {ro.estimated_delivery && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Calendar size={11} className="text-indigo-500" />
                    Est. ready: <span className="text-indigo-400 font-medium">{ro.estimated_delivery}</span>
                  </div>
                )}
                {ro.actual_delivery && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                    <Calendar size={11} />
                    Picked up: <span className="font-medium">{ro.actual_delivery}</span>
                  </div>
                )}
              </div>

              {/* Call to action for ready vehicles */}
              {ro.status === 'delivery' && shop?.phone && (
                <div className="px-5 pb-5">
                  <a href={`tel:${shop.phone}`}
                    className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm transition-colors">
                    <Phone size={16} /> Call to Schedule Pickup
                  </a>
                </div>
              )}
            </div>
          )
        })}

        <p className="text-center text-xs text-slate-600 pb-4">
          Questions? Call us at {shop?.phone || 'the shop'} — we're here to help.
        </p>
      </div>
    </div>
  )
}
