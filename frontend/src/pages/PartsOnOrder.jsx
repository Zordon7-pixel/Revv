import { useEffect, useState } from 'react'
import { ExternalLink, Package, Truck } from 'lucide-react'
import api from '../lib/api'
import { EmptyState, PageHeader, Panel } from '../components/ui'

const STATUS_TONES = {
  ordered: 'var(--brand)',
  backordered: 'var(--crit)',
  received: 'var(--good)',
}

function PartStatus({ status }) {
  const color = STATUS_TONES[status] || 'var(--muted)'
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 36%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {status || 'unknown'}
    </span>
  )
}

function vehicleLabel(part) {
  return [part.year, part.make, part.model].filter(Boolean).join(' ') || 'Vehicle not listed'
}

export default function PartsOnOrder() {
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/parts/all-pending')
      .then((response) => setParts(response.data.parts || []))
      .catch((err) => setError(err?.response?.data?.error || 'Could not load parts on order'))
      .finally(() => setLoading(false))
  }, [])

  async function openTracking(part) {
    if (!part.tracking_number) return
    if (part.tracking_url) {
      window.open(part.tracking_url, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      const { data } = await api.get(`/tracking/url?carrier=${part.carrier || ''}&num=${encodeURIComponent(part.tracking_number)}`)
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
      else setError('A tracking link is not available for this part yet.')
    } catch (err) {
      console.error('[PartsOnOrder] tracking link failed:', err)
      setError('Could not open the tracking link. Try again later.')
    }
  }

  const backordered = parts.filter((part) => part.status === 'backordered').length
  const expectedSoon = parts.filter((part) => part.expected_date).length

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Parts pipeline"
        title="Parts on order"
        description={`${parts.length} pending across open repair orders · ${backordered} backordered · ${expectedSoon} with expected dates`}
      />

      {error && <div role="alert" className="rounded-instrument border border-crit bg-panel px-4 py-3 text-sm text-crit">{error}</div>}

      {loading ? (
        <Panel><EmptyState icon={Package} title="Loading parts pipeline" description="Checking pending orders and tracking details." /></Panel>
      ) : parts.length === 0 ? (
        <Panel><EmptyState icon={Package} title="No pending parts" description="Ordered and backordered parts for active repair orders will appear here." /></Panel>
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {parts.map((part) => (
              <article key={part.id} className="rounded-instrument border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-ink">{part.part_name || 'Unnamed part'}</p>
                    <p className="mt-1 font-mono text-xs text-brand">{part.ro_number || 'RO not listed'}</p>
                  </div>
                  <PartStatus status={part.status} />
                </div>
                <p className="mt-3 text-xs text-muted">{part.customer_name || 'Customer not listed'} · {vehicleLabel(part)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
                  <div><dt className="text-faint">Part #</dt><dd className="mt-0.5 font-mono text-ink">{part.part_number || '—'}</dd></div>
                  <div><dt className="text-faint">Expected</dt><dd className="mt-0.5 text-ink">{part.expected_date || 'Not set'}</dd></div>
                  <div><dt className="text-faint">Vendor</dt><dd className="mt-0.5 text-ink">{part.vendor || '—'}</dd></div>
                  <div>
                    <dt className="text-faint">Tracking</dt>
                    <dd className="mt-0.5">
                      {part.tracking_number ? (
                        <button type="button" onClick={() => openTracking(part)} className="inline-flex items-center gap-1 font-mono text-brand hover:text-brand-lit">
                          {part.tracking_number}<ExternalLink size={11} />
                        </button>
                      ) : <span className="text-faint">Not available</span>}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <Panel className="hidden overflow-hidden md:block">
            <div className="table-scroll">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-panel-2 text-xs uppercase tracking-[0.08em] text-muted">
                  <tr>
                    {['RO #', 'Customer', 'Vehicle', 'Part', 'Part #', 'Vendor', 'Status', 'Expected', 'Tracking'].map((label) => (
                      <th key={label} className="px-3 py-3 text-left font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parts.map((part) => (
                    <tr key={part.id} className="border-t border-line hover:bg-panel-2">
                      <td className="px-3 py-3 font-mono font-semibold text-brand">{part.ro_number || '—'}</td>
                      <td className="px-3 py-3 text-ink">{part.customer_name || '—'}</td>
                      <td className="px-3 py-3 text-muted">{vehicleLabel(part)}</td>
                      <td className="px-3 py-3 font-medium text-ink">{part.part_name || '—'}</td>
                      <td className="px-3 py-3 font-mono text-muted">{part.part_number || '—'}</td>
                      <td className="px-3 py-3 text-muted">{part.vendor || '—'}</td>
                      <td className="px-3 py-3"><PartStatus status={part.status} /></td>
                      <td className="px-3 py-3 text-muted">{part.expected_date || '—'}</td>
                      <td className="px-3 py-3">
                        {part.tracking_number ? (
                          <button type="button" onClick={() => openTracking(part)} className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:text-brand-lit">
                            {part.tracking_number}<ExternalLink size={12} />
                          </button>
                        ) : <span className="text-xs text-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {!loading && parts.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-faint"><Truck size={13} /> Tracking opens with the carrier in a new tab.</div>
      )}
    </div>
  )
}
