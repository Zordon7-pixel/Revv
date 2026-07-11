import { useEffect, useState } from 'react'
import { BarChart3, FileBarChart, ShieldCheck } from 'lucide-react'
import api from '../lib/api'
import { STATUS_LABELS } from './RepairOrders'
import {
  dollarsToCents,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  StatInstrument,
  StatusBadge,
} from '../components/ui'

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'ros', label: 'ROs' },
  { id: 'insurance', label: 'Insurance jobs' },
]

function Numeric({ children, className = '' }) {
  return <span className={`font-mono tabular-nums ${className}`}>{children}</span>
}

function DataTable({ children, minWidth = 'min-w-[640px]' }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} text-sm`}>{children}</table>
    </div>
  )
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState('summary')
  const [summaryData, setSummaryData] = useState(null)
  const [tabData, setTabData] = useState(null)
  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError('')
      try {
        const [summaryRes, tabRes, shopRes] = await Promise.all([
          api.get('/reports/summary'),
          activeTab !== 'summary' ? api.get(`/reports/${activeTab}`) : Promise.resolve({ data: null }),
          api.get('/market/shop'),
        ])
        if (!mounted) return
        setSummaryData(summaryRes.data)
        setTabData(tabRes.data)
        setShop(shopRes.data)
      } catch (err) {
        if (mounted) setError(err?.response?.data?.error || 'Failed to load reports.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [activeTab])

  const targetDollars = Number(shop?.monthly_revenue_target || 85000)
  const revenueDollars = Number(summaryData?.revenue || 0)
  const profitDollars = Number(summaryData?.profit || 0)
  const revenuePercent = targetDollars > 0 ? Math.min(Math.round((revenueDollars / targetDollars) * 100), 100) : 0
  const margin = revenueDollars > 0 ? Math.round((profitDollars / revenueDollars) * 100) : 0

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Revenue, throughput, profitability, and insurance performance in one view."
      />

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-max gap-1 rounded-instrument border border-line bg-panel p-1" role="tablist" aria-label="Report views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand text-white'
                  : 'text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Panel><div className="grid min-h-52 place-items-center text-sm text-muted" role="status">Loading reports...</div></Panel>
      ) : error ? (
        <div className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">{error}</div>
      ) : !summaryData || !shop ? (
        <Panel><EmptyState icon={FileBarChart} title="Reports unavailable" description="The report data could not be loaded." /></Panel>
      ) : (
        <>
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <Panel title="Monthly revenue vs target" description="Current billing month">
                <div className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Money cents={dollarsToCents(revenueDollars)} className="font-display text-3xl font-semibold text-gold" />
                      <p className="mt-1 text-xs text-muted">Target: <Money cents={dollarsToCents(targetDollars)} /> per month</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <Numeric className={revenuePercent >= 100 ? 'text-good text-2xl font-semibold' : 'text-brand text-2xl font-semibold'}>{revenuePercent}%</Numeric>
                      <p className="text-xs text-faint">of goal</p>
                    </div>
                  </div>
                  <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={revenuePercent}>
                    <div className={`h-full rounded-full ${revenuePercent >= 100 ? 'bg-good' : 'bg-brand'}`} style={{ width: `${revenuePercent}%` }} />
                  </div>
                </div>
              </Panel>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatInstrument label="Total jobs" value={<Numeric>{summaryData.total || 0}</Numeric>} detail="This billing month" />
                <StatInstrument label="Completed" value={<Numeric className="text-good">{summaryData.completed || 0}</Numeric>} detail="Closed and total loss" tone="good" />
                <StatInstrument label="True profit" value={<Money cents={dollarsToCents(profitDollars)} className={profitDollars >= 0 ? 'text-good' : 'text-crit'} />} detail="Recorded shop profit" tone={profitDollars >= 0 ? 'good' : 'crit'} />
                <StatInstrument label="Profit margin" value={<Numeric className={margin >= 0 ? 'text-good' : 'text-crit'}>{margin}%</Numeric>} detail="Profit as share of revenue" tone={margin >= 0 ? 'good' : 'crit'} />
              </div>

              <Panel title="Revenue by job type" description="Share of recorded monthly revenue">
                {(summaryData.byType || []).length ? (
                  <div className="space-y-4 p-4">
                    {summaryData.byType.map((item) => {
                      const percent = revenueDollars > 0 ? Math.round((Number(item.revenue || 0) / revenueDollars) * 100) : 0
                      return (
                        <div key={item.job_type || 'unclassified'}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="capitalize text-ink">{item.job_type || 'Unclassified'} <span className="text-faint">({item.count} jobs)</span></span>
                            <span className="text-right"><Money cents={dollarsToCents(item.revenue)} className="text-gold" /> <Numeric className="text-faint">({percent}%)</Numeric></span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(percent, 100)}%` }} /></div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState icon={BarChart3} title="No revenue mix yet" description="Job-type revenue will appear after repair orders are billed." />
                )}
              </Panel>

              <Panel title="Pipeline by stage" description="Repair orders currently recorded in each stage">
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-8">
                  {['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery'].map((status) => {
                    const found = summaryData.byStatus?.find((item) => item.status === status)
                    return (
                      <div key={status} className="rounded-instrument border border-line bg-panel-2 p-3 text-center">
                        <Numeric className="text-xl font-semibold text-ink">{found?.count || 0}</Numeric>
                        <div className="mt-2 flex justify-center"><StatusBadge status={status} label={STATUS_LABELS[status]} /></div>
                      </div>
                    )
                  })}
                </div>
              </Panel>

              {summaryData.insuranceSummary && (
                <Panel title="Insurance jobs" description="Current-month claim activity">
                  <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatInstrument label="Claims" value={<Numeric>{summaryData.insuranceSummary.insuranceJobsThisMonth || 0}</Numeric>} detail="Created this month" />
                    <StatInstrument label="Approved" value={<Money cents={summaryData.insuranceSummary.approvedAmountCents || 0} className="text-gold" />} detail="Insurer approved" tone="gold" />
                    <StatInstrument label="Billed" value={<Money cents={summaryData.insuranceSummary.billedAmountCents || 0} className="text-gold" />} detail="Recorded RO total" tone="gold" />
                    <StatInstrument label="Open supplements" value={<Numeric className="text-gold">{summaryData.insuranceSummary.openSupplementsCount || 0}</Numeric>} detail="Requested or pending" tone="gold" />
                  </div>
                </Panel>
              )}
            </div>
          )}

          {activeTab === 'revenue' && tabData && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatInstrument label="Total revenue" value={<Money cents={dollarsToCents(tabData.total)} className="text-gold" />} detail="All reported months" tone="gold" />
                <StatInstrument label="Average RO" value={<Money cents={dollarsToCents(tabData.avg)} className="text-gold" />} detail="Average recorded total" tone="gold" />
                <StatInstrument label="Top month" value={<span className="text-brand">{tabData.topMonths?.[0]?.month || '-'}</span>} detail="Highest revenue month" />
                <StatInstrument label="Top-month revenue" value={<Money cents={dollarsToCents(tabData.topMonths?.[0]?.revenue)} className="text-gold" />} detail="Highest monthly total" tone="gold" />
              </div>
              <Panel title="Monthly revenue">
                {(tabData.monthly || []).length ? (
                  <DataTable>
                    <thead className="bg-panel-2 text-xs text-faint"><tr><th className="px-4 py-3 text-left">Month</th><th className="px-4 py-3 text-right">ROs</th><th className="px-4 py-3 text-right">Revenue</th><th className="px-4 py-3 text-right">Average RO</th></tr></thead>
                    <tbody>{tabData.monthly.map((month) => <tr key={month.month} className="border-t border-line text-ink"><td className="px-4 py-3">{month.label}</td><td className="px-4 py-3 text-right"><Numeric>{month.count}</Numeric></td><td className="px-4 py-3 text-right"><Money cents={dollarsToCents(month.revenue)} className="text-gold" /></td><td className="px-4 py-3 text-right"><Money cents={dollarsToCents(month.avg_ro)} /></td></tr>)}</tbody>
                  </DataTable>
                ) : <EmptyState icon={BarChart3} title="No monthly revenue" description="Monthly totals will appear after repair orders are billed." />}
              </Panel>
            </div>
          )}

          {activeTab === 'ros' && tabData && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatInstrument label="This month" value={<Numeric>{tabData.thisMonth || 0}</Numeric>} detail="Repair orders created" />
                <StatInstrument label="Last month" value={<Numeric>{tabData.lastMonth || 0}</Numeric>} detail="Previous month" />
                <StatInstrument label="Average close" value={<Numeric>{tabData.avgDays || 0}d</Numeric>} detail="Days to close" />
                <StatInstrument label="Statuses" value={<Numeric>{tabData.byStatus?.length || 0}</Numeric>} detail="Distinct workflow states" />
              </div>
              <Panel title="Repair orders by status">
                {(tabData.byStatus || []).length ? (
                  <div className="divide-y divide-line">
                    {tabData.byStatus.map((item) => <div key={item.status} className="flex items-center justify-between gap-3 px-4 py-3"><StatusBadge status={item.status} label={STATUS_LABELS[item.status]} /><Numeric className="font-semibold text-ink">{item.count}</Numeric></div>)}
                  </div>
                ) : <EmptyState icon={FileBarChart} title="No status data" description="Status totals will appear after repair orders are created." />}
              </Panel>
            </div>
          )}

          {activeTab === 'insurance' && tabData && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatInstrument label="Insurance ROs" value={<Numeric>{tabData.totalInsuranceJobs || 0}</Numeric>} detail="Current month" />
                <StatInstrument label="Approved amount" value={<Money cents={tabData.approvedAmountCents || 0} className="text-gold" />} detail="Insurer approved" tone="gold" />
                <StatInstrument label="Billed amount" value={<Money cents={tabData.billedAmountCents || 0} className="text-gold" />} detail="Recorded RO totals" tone="gold" />
                <StatInstrument label="Open supplements" value={<Numeric className="text-gold">{tabData.openSupplementsCount || 0}</Numeric>} detail="Requested or pending" tone="gold" />
              </div>
              <Panel title="Insurance summary" description="Claim mix and open opportunity">
                <dl className="divide-y divide-line px-4">
                  <div className="flex items-center justify-between gap-3 py-3"><dt className="text-sm text-muted">Open supplement amount</dt><dd><Money cents={tabData.openSupplementsAmountCents || 0} className="font-semibold text-gold" /></dd></div>
                  <div className="flex items-center justify-between gap-3 py-3"><dt className="text-sm text-muted">DRP jobs</dt><dd><Numeric className="font-semibold text-ink">{tabData.drpCount || 0}</Numeric></dd></div>
                  <div className="flex items-center justify-between gap-3 py-3"><dt className="text-sm text-muted">Non-DRP jobs</dt><dd><Numeric className="font-semibold text-ink">{tabData.nonDrpCount || 0}</Numeric></dd></div>
                </dl>
              </Panel>
            </div>
          )}
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-faint"><ShieldCheck size={14} /> Reports are scoped to the signed-in shop.</p>
    </div>
  )
}
