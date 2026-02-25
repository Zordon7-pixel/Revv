import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, ArrowUpDown } from 'lucide-react'
import api from '../lib/api'

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatCurrency(v) {
  return `$${Number(v || 0).toLocaleString()}`
}

function formatDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MonthlyReport() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [notes, setNotes] = useState('')

  const noteKey = `revv-monthly-notes-${yearMonth}`
  const maxMonth = currentYearMonth()

  useEffect(() => {
    setNotes(localStorage.getItem(noteKey) || '')
  }, [noteKey])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await api.get(`/reports/monthly/${yearMonth}`)
        setData(res.data)
      } catch (err) {
        console.error('Failed to load monthly report:', err)
        setData({ summary: null, ros: [] })
      }
      setLoading(false)
    }
    load()
  }, [yearMonth])

  useEffect(() => {
    localStorage.setItem(noteKey, notes)
  }, [noteKey, notes])

  const sortedRos = useMemo(() => {
    const list = [...(data?.ros || [])]
    list.sort((a, b) => {
      const aVal = a?.[sort.key]
      const bVal = b?.[sort.key]
      const aNorm = aVal === null || aVal === undefined ? '' : aVal
      const bNorm = bVal === null || bVal === undefined ? '' : bVal

      if (sort.key === 'total_cost') {
        return sort.dir === 'asc' ? Number(aNorm) - Number(bNorm) : Number(bNorm) - Number(aNorm)
      }

      const cmp = String(aNorm).localeCompare(String(bNorm))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [data, sort])

  function toggleSort(key) {
    setSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  async function downloadCsv() {
    try {
      const token = localStorage.getItem('sc_token')
      const res = await fetch(`/api/reports/monthly/${yearMonth}/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `revv-report-${yearMonth}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert(err.message || 'Failed to download CSV')
    }
  }

  const summary = data?.summary
  const monthLabel = new Date(`${yearMonth}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Monthly Report</h1>
          <p className="text-slate-500 text-sm">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <CalendarDays size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="month"
              value={yearMonth}
              max={maxMonth}
              onChange={e => setYearMonth(e.target.value)}
              className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg text-sm text-white pl-8 pr-2 py-2"
            />
          </div>
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <Download size={14} />
            Download CSV
          </button>
        </div>
      </div>

      {loading && <div className="text-slate-500 text-sm">Loading report...</div>}

      {!loading && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Total Revenue', formatCurrency(summary.total_revenue), 'text-emerald-300'],
              ['Total ROs', summary.total_ros, 'text-indigo-300'],
              ['Completed', summary.completed_ros, 'text-emerald-400'],
              ['In Progress', summary.in_progress_ros, 'text-amber-300'],
              ['Avg Value', formatCurrency(summary.avg_ro_value), 'text-cyan-300'],
            ].map(([label, value, color]) => (
              <div key={label} className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
                <div className={`text-xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Repair Orders</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-[#2a2d3e]">
                    {[
                      ['ro_number', 'RO#'],
                      ['customer_name', 'Customer'],
                      ['vehicle', 'Vehicle'],
                      ['status', 'Status'],
                      ['total_cost', 'Total Cost'],
                      ['revenue_period', 'Revenue Period'],
                      ['carried_over', 'Carried Over'],
                      ['technician', 'Technician'],
                      ['created_at', 'Created'],
                      ['completed_at', 'Completed'],
                    ].map(([key, label]) => (
                      <th key={key} className="text-left py-2 px-2 whitespace-nowrap">
                        <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-slate-300">
                          {label}
                          <ArrowUpDown size={11} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRos.map(ro => (
                    <tr key={ro.id} className="border-b border-[#2a2d3e]/60 text-slate-300">
                      <td className="py-2 px-2">{ro.ro_number || '-'}</td>
                      <td className="py-2 px-2">{ro.customer_name || '-'}</td>
                      <td className="py-2 px-2">{ro.vehicle || '-'}</td>
                      <td className="py-2 px-2 capitalize">{ro.status || '-'}</td>
                      <td className="py-2 px-2 text-emerald-300">{formatCurrency(ro.total_cost)}</td>
                      <td className="py-2 px-2 capitalize">{ro.revenue_period || 'current'}</td>
                      <td className="py-2 px-2">{ro.carried_over ? 'Yes' : 'No'}</td>
                      <td className="py-2 px-2">{ro.technician || '-'}</td>
                      <td className="py-2 px-2">{formatDate(ro.created_at)}</td>
                      <td className="py-2 px-2">{formatDate(ro.completed_at)}</td>
                    </tr>
                  ))}
                  {!sortedRos.length && (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-500">No repair orders found for this month.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl p-4">
            <label className="block text-sm font-semibold text-white mb-2">Owner Notes (for tax purposes)</label>
            <textarea
              rows={5}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              placeholder="Add monthly notes for accounting and tax review."
            />
          </div>
        </>
      )}
    </div>
  )
}
