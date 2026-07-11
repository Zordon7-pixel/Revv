import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClipboardCheck, ExternalLink, Loader2 } from 'lucide-react'
import api from '../lib/api'
import { Logo, Panel } from '../components/ui'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'

const CONDITION_META = {
  good: { label: 'Good', className: 'border-good/30 bg-good/10 text-good' },
  fair: { label: 'Fair', className: 'border-brand/30 bg-brand/10 text-brand' },
  needs_attention: { label: 'Needs attention', className: 'border-crit/30 bg-crit/10 text-crit' },
  critical: { label: 'Critical', className: 'border-crit/40 bg-crit/15 text-crit' },
}

function ReportState({ loading, error }) {
  return (
    <main className="grid min-h-screen place-items-center bg-void px-4 text-ink">
      <Panel className="w-full max-w-md p-6 text-center">
        {loading ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand" aria-hidden="true" /> : <ClipboardCheck className="mx-auto h-8 w-8 text-crit" aria-hidden="true" />}
        <p role={error ? 'alert' : 'status'} className={`mt-4 text-sm ${error ? 'text-crit' : 'text-muted'}`}>{error || 'Loading inspection report...'}</p>
      </Panel>
    </main>
  )
}

export default function InspectionPublic() {
  const { inspectionId } = useParams()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get(`/inspections/${inspectionId}/public`)
        setPayload(data)
      } catch (requestError) {
        setError(requestError?.response?.data?.error || 'Unable to load inspection report.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [inspectionId])

  const groupedItems = useMemo(() => {
    const items = payload?.items || []
    return items.reduce((accumulator, item) => {
      const category = item.category || 'Other'
      if (!accumulator[category]) accumulator[category] = []
      accumulator[category].push(item)
      return accumulator
    }, {})
  }, [payload])

  if (loading) return <ReportState loading />
  if (error) return <ReportState error={error} />
  if (!payload) return <ReportState error="No inspection data found." />

  const { shop, vehicle, ro, inspection } = payload
  const vehicleLabel = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Not provided'

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          <Logo variant="mark" className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Vehicle inspection report</h1>
            <p className="truncate text-sm text-muted">{shop?.name || 'REVV repair shop'}</p>
          </div>
        </header>

        <Panel title="Inspection summary">
          <dl className="grid gap-x-8 gap-y-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
            <div className="border-b border-line pb-3 sm:border-b-0 sm:pb-0">
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">Vehicle</dt>
              <dd className="mt-1 text-ink">{vehicleLabel}</dd>
              {vehicle?.color && <dd className="mt-1 text-xs text-muted">Color: {vehicle.color}</dd>}
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.08em] text-faint">Repair order</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink">{ro?.ro_number || 'Not provided'}</dd>
              <dd className="mt-1 text-xs text-muted">Inspection status: <span className="text-ink">{inspection?.status || 'Not provided'}</span></dd>
            </div>
          </dl>
        </Panel>

        {Object.keys(groupedItems).length === 0 ? (
          <Panel className="p-8 text-center">
            <ClipboardCheck className="mx-auto h-7 w-7 text-brand" aria-hidden="true" />
            <p role="status" className="mt-3 text-sm text-muted">No inspection items were recorded.</p>
          </Panel>
        ) : Object.entries(groupedItems).map(([category, items]) => (
          <Panel key={category} title={category}>
            <div className="divide-y divide-line px-4 sm:px-5">
              {items.map((item) => {
                const meta = CONDITION_META[item.condition] || { label: 'Not rated', className: 'border-line-2 bg-panel-2 text-muted' }
                return (
                  <article key={item.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-ink">{item.item_name}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                    </div>
                    {item.note && <p className="whitespace-pre-wrap text-sm text-muted">{item.note}</p>}
                    {item.photo_url && (
                      <a href={resolveUploadedMediaUrl(item.photo_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-lit">
                        View photo <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    )}
                  </article>
                )
              })}
            </div>
          </Panel>
        ))}
      </div>
    </main>
  )
}
