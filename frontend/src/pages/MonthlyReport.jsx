import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, CalendarDays, Download, FileSpreadsheet } from 'lucide-react'
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

function currentYearMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MonthlyReport() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [notes, setNotes] = useState('')

  const noteKey = `revv-monthly-notes-${yearMonth}`
  const maxMonth = currentYearMonth()

  useEffect(() => {
    setNotes(localStorage.getItem(noteKey) || '')
  }, [noteKey])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await api.get(`/reports/monthly/${yearMonth}`)
        if (mounted) setData(response.data)
      } catch (err) {
        console.error('Failed to load monthly report:', err)
        if (mounted) {
          setData({ summary: null, ros: [] })
          setError(err?.response?.data?.error || 'Failed to load the monthly report.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [yearMonth])

  useEffect(() => {
    localStorage.setItem(noteKey, notes)
  }, [noteKey, notes])

  const sortedRos = useMemo(() => {
    const list = [...(data?.ros || [])]
    list.sort((a, b) => {
      const aValue = a?.[sort.key]
      const bValue = b?.[sort.key]
      const aNormalized = aValue === null || aValue === undefined ? '' : aValue
      const bNormalized = bValue === null || bValue === undefined ? '' : bValue

      if (sort.key === 'total_cost') {
        return sort.dir === 'asc'
          ? Number(aNormalized) - Number(bNormalized)
          : Number(bNormalized) - Number(aNormalized)
      }

      const comparison = String(aNormalized).localeCompare(String(bNormalized))
      return sort.dir === 'asc' ? comparison : -comparison
    })
    return list
  }, [data, sort])

  function toggleSort(key) {
    setSort((previous) => ({
      key,
      dir: previous.key === key && previous.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  async function downloadCsv() {
    setDownloadError('')
    try {
      const token = localStorage.getItem('sc_token')
      const response = await fetch(`/api/reports/monthly/${yearMonth}/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `revv-report-${yearMonth}.csv`
      anchor.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(err.message || 'Failed to download CSV')
    }
  }

  const summary = data?.summary
  const monthLabel = new Date(`${yearMonth}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const headerActions = (
    <>
      <label className="relative">
        <span className="sr-only">Report month</span>
        <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="month"
          value={yearMonth}
          max={maxMonth}
          onChange={(event) => setYearMonth(event.target.value)}
          className="rounded-lg border border-line-2 bg-panel py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-brand"
          aria-label="Report month"
        />
      </label>
      <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">
        <Download size={15} /> Download CSV
      </button>
    </>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader eyebrow="Financial" title="Monthly report" description={monthLabel} actions={headerActions} />

      {downloadError && <div className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">{downloadError}</div>}
      {error && <div className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit" role="alert">{error}</div>}

      {loading ? (
        <Panel><div className="grid min-h-52 place-items-center text-sm text-muted" role="status">Loading report...</div></Panel>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatInstrument label="Total revenue" value={<Money cents={dollarsToCents(summary.total_revenue)} className="text-gold" />} detail={monthLabel} tone="gold" />
            <StatInstrument label="Total ROs" value={<span className="font-mono tabular-nums">{summary.total_ros || 0}</span>} detail="In report" />
            <StatInstrument label="Completed" value={<span className="font-mono tabular-nums text-good">{summary.completed_ros || 0}</span>} detail="Delivered or closed" tone="good" />
            <StatInstrument label="In progress" value={<span className="font-mono tabular-nums text-brand">{summary.in_progress_ros || 0}</span>} detail="Active workflow" />
            <StatInstrument label="Average value" value={<Money cents={dollarsToCents(summary.avg_ro_value)} className="text-gold" />} detail="Per repair order" tone="gold" />
          </div>

          <Panel title="Repair orders" description={`${sortedRos.length} in ${monthLabel}`}>
            {sortedRos.length ? (
              <>
                <div className="grid gap-3 p-3 md:hidden">
                  {sortedRos.map((ro) => (
                    <article key={ro.id} className="rounded-instrument border border-line bg-panel-2 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="font-mono text-sm font-semibold text-brand">{ro.ro_number || '-'}</p><p className="mt-1 truncate text-sm text-ink">{ro.customer_name || 'Customer not linked'}</p><p className="mt-1 truncate text-xs text-muted">{ro.vehicle || 'Vehicle not linked'}</p></div>
                        <StatusBadge status={ro.status} />
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                        <div><dt className="text-faint">Total</dt><dd className="mt-1"><Money cents={dollarsToCents(ro.total_cost)} className="text-gold" /></dd></div>
                        <div><dt className="text-faint">Technician</dt><dd className="mt-1 text-ink">{ro.technician || 'Unassigned'}</dd></div>
                        <div><dt className="text-faint">Created</dt><dd className="mt-1 text-muted">{formatDate(ro.created_at)}</dd></div>
                        <div><dt className="text-faint">Completed</dt><dd className="mt-1 text-muted">{formatDate(ro.completed_at)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[980px] text-xs">
                    <thead className="bg-panel-2 text-faint">
                      <tr>
                        {[
                          ['ro_number', 'RO#'], ['customer_name', 'Customer'], ['vehicle', 'Vehicle'], ['status', 'Status'],
                          ['total_cost', 'Total'], ['revenue_period', 'Revenue period'], ['carried_over', 'Carried over'],
                          ['technician', 'Technician'], ['created_at', 'Created'], ['completed_at', 'Completed'],
                        ].map(([key, label]) => (
                          <th key={key} className="px-3 py-3 text-left font-semibold">
                            <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 transition-colors hover:text-ink" aria-label={`Sort by ${label}`}>
                              {label}<ArrowUpDown size={11} />
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRos.map((ro) => (
                        <tr key={ro.id} className="border-t border-line text-ink">
                          <td className="px-3 py-3 font-mono font-semibold text-brand">{ro.ro_number || '-'}</td>
                          <td className="px-3 py-3">{ro.customer_name || '-'}</td>
                          <td className="px-3 py-3 text-muted">{ro.vehicle || '-'}</td>
                          <td className="px-3 py-3"><StatusBadge status={ro.status} /></td>
                          <td className="px-3 py-3"><Money cents={dollarsToCents(ro.total_cost)} className="text-gold" /></td>
                          <td className="px-3 py-3 capitalize text-muted">{ro.revenue_period || 'current'}</td>
                          <td className="px-3 py-3 text-muted">{ro.carried_over ? 'Yes' : 'No'}</td>
                          <td className="px-3 py-3 text-muted">{ro.technician || '-'}</td>
                          <td className="px-3 py-3 text-muted">{formatDate(ro.created_at)}</td>
                          <td className="px-3 py-3 text-muted">{formatDate(ro.completed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState icon={FileSpreadsheet} title="No repair orders this month" description="Choose another month or create a repair order to populate this report." />
            )}
          </Panel>

          <Panel title="Owner notes" description="Saved locally for accounting and tax review">
            <div className="p-4">
              <label htmlFor="monthly-owner-notes" className="sr-only">Owner notes for tax purposes</label>
              <textarea
                id="monthly-owner-notes"
                rows={5}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
                placeholder="Add monthly notes for accounting and tax review."
              />
            </div>
          </Panel>
        </>
      ) : !error ? (
        <Panel><EmptyState icon={FileSpreadsheet} title="No report available" description="No monthly summary was returned for this period." /></Panel>
      ) : null}
    </div>
  )
}
