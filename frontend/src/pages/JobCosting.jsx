import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calculator, TrendingUp } from 'lucide-react'
import api from '../lib/api'
import {
  dollarsToCents,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  StatInstrument,
  StatusBadge,
} from '../components/ui'

function percent(value) {
  const numeric = Number(value || 0)
  return `${Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0'}%`
}

function rowMoney(row) {
  const revenue = Number(row.total || 0)
  const cost = Number(row.parts_cost || 0) + Number(row.labor_cost || 0) + Number(row.sublet_cost || 0)
  const profit = Number(row.true_profit || 0)
  return {
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
  }
}

export default function JobCosting() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split('T')[0]
  const firstOfMonth = `${today.slice(0, 8)}01`

  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/ros/job-cost/summary?from=${from}&to=${to}`)
      setData(response.data)
    } catch (err) {
      console.error('Failed to load job costing data:', err)
      setError(err?.response?.data?.error || 'Failed to load job costing data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const profitable = data?.profitableCount || 0
  const total = data?.totalJobs || 0
  const headerActions = (
    <>
      <label className="text-xs text-muted">From<input aria-label="Job costing from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="ml-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand" /></label>
      <label className="text-xs text-muted">To<input aria-label="Job costing to date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="ml-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-brand" /></label>
      <button type="button" onClick={load} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">Apply</button>
    </>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader eyebrow="Financial" title="Job costing" description="Track revenue, cost, profit, and margin per repair order." actions={headerActions} />

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatInstrument label="Total revenue" value={<Money cents={dollarsToCents(data.totalRevenue)} className="text-gold" />} detail="Selected date range" tone="gold" onClick={() => navigate('/ros')} />
            <StatInstrument label="Total cost" value={<Money cents={dollarsToCents(data.totalCost)} className="text-gold" />} detail="Parts, labor, and sublet" tone="gold" onClick={() => navigate('/ros')} />
            <StatInstrument label="Gross profit" value={<Money cents={dollarsToCents(data.grossProfit)} className={Number(data.grossProfit || 0) >= 0 ? 'text-good' : 'text-crit'} />} detail="Revenue minus recorded cost" tone={Number(data.grossProfit || 0) >= 0 ? 'good' : 'crit'} onClick={() => navigate('/ros')} />
            <StatInstrument label="Average margin" value={<span className={`font-mono tabular-nums ${Number(data.avgMargin || 0) >= 0 ? 'text-good' : 'text-crit'}`}>{percent(data.avgMargin)}</span>} detail="Across selected jobs" tone={Number(data.avgMargin || 0) >= 0 ? 'good' : 'crit'} onClick={() => navigate('/ros')} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatInstrument label="Total jobs" value={<span className="font-mono tabular-nums">{total}</span>} detail={`${from} to ${to}`} onClick={() => navigate('/ros')} />
            <StatInstrument label="Jobs profitable" value={<span className="font-mono tabular-nums text-good">{total > 0 ? Math.round((profitable / total) * 100) : 0}%</span>} detail={`${profitable} of ${total} jobs`} tone="good" onClick={() => navigate('/ros')} />
          </div>
        </>
      )}

      {loading && <Panel><div className="grid min-h-52 place-items-center text-sm text-muted" role="status">Loading job costing...</div></Panel>}
      {error && <div className="rounded-instrument border border-crit/30 bg-crit/10 p-4 text-sm text-crit" role="alert">{error}</div>}

      {!loading && data?.rows?.length > 0 && (
        <Panel title="Repair orders" description={`${from} to ${to}`}>
          <div className="grid gap-3 p-3 md:hidden">
            {data.rows.map((row) => {
              const money = rowMoney(row)
              return (
                <button key={row.id} type="button" onClick={() => navigate(`/ros/${row.id}`)} className="rounded-instrument border border-line bg-panel-2 p-4 text-left transition-colors hover:border-brand">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-sm font-semibold text-brand">{row.ro_number}</p><p className="mt-1 truncate text-sm text-ink">{row.customer_name || 'Customer not linked'}</p><p className="mt-1 truncate text-xs text-muted">{[row.year, row.make, row.model].filter(Boolean).join(' ') || 'Vehicle not linked'}</p></div><StatusBadge status={row.status} /></div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-faint">Revenue</dt><dd className="mt-1"><Money cents={dollarsToCents(money.revenue)} className="text-gold" /></dd></div>
                    <div><dt className="text-faint">Cost</dt><dd className="mt-1"><Money cents={dollarsToCents(money.cost)} /></dd></div>
                    <div><dt className="text-faint">Profit</dt><dd className="mt-1"><Money cents={dollarsToCents(money.profit)} className={money.profit >= 0 ? 'text-good' : 'text-crit'} /></dd></div>
                    <div><dt className="text-faint">Margin</dt><dd className={`mt-1 font-mono tabular-nums ${money.profit >= 0 ? 'text-good' : 'text-crit'}`}>{percent(money.margin)}</dd></div>
                  </dl>
                </button>
              )
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-panel-2 text-xs text-faint"><tr><th className="px-4 py-3 text-left">RO</th><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-left">Vehicle</th><th className="px-4 py-3 text-right">Revenue</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Profit</th><th className="px-4 py-3 text-right">Margin</th><th className="px-4 py-3 text-left">Status</th></tr></thead>
              <tbody>
                {data.rows.map((row) => {
                  const money = rowMoney(row)
                  return (
                    <tr key={row.id} onClick={() => navigate(`/ros/${row.id}`)} className="cursor-pointer border-t border-line text-ink transition-colors hover:bg-panel-2">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{row.ro_number}</td>
                      <td className="px-4 py-3">{row.customer_name || '-'}</td>
                      <td className="px-4 py-3 text-xs text-muted">{[row.year, row.make, row.model].filter(Boolean).join(' ') || '-'}</td>
                      <td className="px-4 py-3 text-right"><Money cents={dollarsToCents(money.revenue)} className="text-gold" /></td>
                      <td className="px-4 py-3 text-right"><Money cents={dollarsToCents(money.cost)} /></td>
                      <td className="px-4 py-3 text-right"><Money cents={dollarsToCents(money.profit)} className={money.profit >= 0 ? 'font-semibold text-good' : 'font-semibold text-crit'} /></td>
                      <td className={`px-4 py-3 text-right font-mono text-xs tabular-nums ${money.profit >= 0 ? 'text-good' : 'text-crit'}`}>{percent(money.margin)}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {!loading && data?.rows?.length === 0 && (
        <Panel><EmptyState icon={Calculator} title="No repair orders in this range" description="Adjust the dates to review job profitability." /></Panel>
      )}

      <p className="flex items-center gap-2 text-xs text-faint"><TrendingUp size={14} /> Figures reflect the existing shop job-costing report.</p>
    </div>
  )
}
