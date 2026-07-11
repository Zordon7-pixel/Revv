import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import { isAdmin } from '../lib/auth'
import AppOverlay from '../components/AppOverlay'

const EMPTY_DTC = { code: '', description: '', severity: 'info' }
const EMPTY_ADAS = { system: '', status: 'ok' }

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function severityClass(severity) {
  if (severity === 'critical') return 'border-crit/50 bg-crit/15 text-crit'
  if (severity === 'warning') return 'border-crit/30 bg-crit/10 text-crit'
  return 'border-brand/40 bg-brand/10 text-brand'
}

function statusClass(status) {
  if (status === 'fault') return 'border-crit/40 bg-crit/10 text-crit'
  if (status === 'needs_calibration') return 'border-brand/40 bg-brand/10 text-brand'
  return 'border-good/40 bg-good/10 text-good'
}

function toIsoOrNull(datetimeLocal) {
  if (!datetimeLocal) return null
  const parsed = new Date(datetimeLocal)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export default function VehicleDiagnostics() {
  const [scans, setScans] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scannedByDefault, setScannedByDefault] = useState('')
  const canDelete = isAdmin()

  const [form, setForm] = useState({
    ro_id: '',
    vehicle_id: '',
    vin: '',
    scan_date: '',
    scanned_by: '',
    scanner_tool: '',
    pre_repair: true,
    post_repair: false,
    notes: '',
    dtc_codes: [{ ...EMPTY_DTC }],
    adas_systems: [{ ...EMPTY_ADAS }],
  })

  const roCounts = useMemo(() => {
    const counts = {}
    for (const scan of scans) {
      if (!scan.ro_id) continue
      counts[scan.ro_id] = (counts[scan.ro_id] || 0) + 1
    }
    return counts
  }, [scans])

  function resetForm(name = scannedByDefault) {
    setForm({
      ro_id: '',
      vehicle_id: '',
      vin: '',
      scan_date: '',
      scanned_by: name || '',
      scanner_tool: '',
      pre_repair: true,
      post_repair: false,
      notes: '',
      dtc_codes: [{ ...EMPTY_DTC }],
      adas_systems: [{ ...EMPTY_ADAS }],
    })
  }

  async function loadScans() {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/vehicle-diagnostics')
      setScans(data.scans || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load diagnostic scans')
      setScans([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadScans()
  }, [])

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => {
        const name = res.data?.user?.name || ''
        setScannedByDefault(name)
        setForm((prev) => ({ ...prev, scanned_by: prev.scanned_by || name }))
      })
      .catch(() => {})
  }, [])

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateDtc(index, key, value) {
    setForm((prev) => ({
      ...prev,
      dtc_codes: prev.dtc_codes.map((row, idx) => (idx === index ? { ...row, [key]: value } : row)),
    }))
  }

  function addDtcRow() {
    setForm((prev) => ({ ...prev, dtc_codes: [...prev.dtc_codes, { ...EMPTY_DTC }] }))
  }

  function removeDtcRow(index) {
    setForm((prev) => {
      const next = prev.dtc_codes.filter((_, idx) => idx !== index)
      return { ...prev, dtc_codes: next.length ? next : [{ ...EMPTY_DTC }] }
    })
  }

  function updateAdas(index, key, value) {
    setForm((prev) => ({
      ...prev,
      adas_systems: prev.adas_systems.map((row, idx) => (idx === index ? { ...row, [key]: value } : row)),
    }))
  }

  function addAdasRow() {
    setForm((prev) => ({ ...prev, adas_systems: [...prev.adas_systems, { ...EMPTY_ADAS }] }))
  }

  function removeAdasRow(index) {
    setForm((prev) => {
      const next = prev.adas_systems.filter((_, idx) => idx !== index)
      return { ...prev, adas_systems: next.length ? next : [{ ...EMPTY_ADAS }] }
    })
  }

  function normalizeDtcRows(rows) {
    const normalized = []
    for (const row of rows) {
      const code = row.code.trim()
      const description = row.description.trim()
      if (!code && !description) continue
      if (!code || !description) return { ok: false, error: 'Each DTC row needs both code and description.' }
      normalized.push({ code, description, severity: row.severity })
    }
    return { ok: true, rows: normalized }
  }

  function normalizeAdasRows(rows) {
    const normalized = []
    for (const row of rows) {
      const system = row.system.trim()
      if (!system) continue
      normalized.push({ system, status: row.status })
    }
    return normalized
  }

  async function submitScan(e) {
    e.preventDefault()
    setError('')

    const vin = form.vin.trim()
    const scannedBy = form.scanned_by.trim()
    if (!vin) {
      setError('VIN is required.')
      return
    }
    if (!scannedBy) {
      setError('Scanned By is required.')
      return
    }

    const dtcResult = normalizeDtcRows(form.dtc_codes)
    if (!dtcResult.ok) {
      setError(dtcResult.error)
      return
    }

    setSaving(true)
    try {
      await api.post('/vehicle-diagnostics', {
        ro_id: form.ro_id.trim() || null,
        vehicle_id: form.vehicle_id.trim() || null,
        vin,
        scan_date: toIsoOrNull(form.scan_date),
        scanned_by: scannedBy,
        scanner_tool: form.scanner_tool.trim() || null,
        pre_repair: Boolean(form.pre_repair),
        post_repair: Boolean(form.post_repair),
        dtc_codes: dtcResult.rows,
        adas_systems: normalizeAdasRows(form.adas_systems),
        notes: form.notes.trim() || null,
      })
      setShowModal(false)
      resetForm(scannedByDefault)
      await loadScans()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save diagnostic scan')
    } finally {
      setSaving(false)
    }
  }

  async function deleteScan(scanId) {
    if (!canDelete) return
    if (!window.confirm('Delete this diagnostic scan? This cannot be undone.')) return
    try {
      await api.delete(`/vehicle-diagnostics/${scanId}`)
      setScans((prev) => prev.filter((scan) => scan.id !== scanId))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete scan')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Vehicle Diagnostics</h1>
          <p className="text-sm text-muted">Pre-repair and post-repair scan records, DTC results, and ADAS status logs.</p>
        </div>
        <button
          onClick={() => {
            resetForm(scannedByDefault)
            setError('')
            setShowModal(true)
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-lit"
        >
          <Plus size={16} />
          New Scan
        </button>
      </div>

      {error && <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</div>}

      <div className="overflow-x-auto rounded-instrument border border-line-2 bg-panel">
        {loading ? (
          <div className="p-6 text-sm text-muted">Loading scans...</div>
        ) : scans.length === 0 ? (
          <div className="p-6 text-sm text-faint">No vehicle diagnostic scans found for this shop.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-panel-2 text-muted">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Scan Date</th>
                <th className="px-4 py-3 text-left font-medium">RO</th>
                <th className="px-4 py-3 text-left font-medium">VIN</th>
                <th className="px-4 py-3 text-left font-medium">Scanned By</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">DTC Codes</th>
                <th className="px-4 py-3 text-left font-medium">ADAS</th>
                {canDelete && <th className="px-4 py-3 text-left font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-t border-line-2 align-top text-ink">
                  <td className="px-4 py-3">{formatDate(scan.scan_date || scan.created_at)}</td>
                  <td className="px-4 py-3">
                    {scan.ro_id ? (
                      <div className="space-y-1">
                        <div className="font-mono font-medium text-ink">{scan.ro_id}</div>
                        <span className="inline-flex rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 font-mono text-xs text-brand">
                          {roCounts[scan.ro_id] || 0} scan{(roCounts[scan.ro_id] || 0) === 1 ? '' : 's'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-faint">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{scan.vin || '-'}</td>
                  <td className="px-4 py-3">{scan.scanned_by || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {scan.pre_repair && <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs text-brand">Pre-Repair</span>}
                      {scan.post_repair && <span className="rounded-full border border-good/40 bg-good/10 px-2 py-0.5 text-xs text-good">Post-Repair</span>}
                      {!scan.pre_repair && !scan.post_repair && <span className="text-faint">-</span>}
                    </div>
                    {scan.scanner_tool && <div className="mt-1 text-xs text-muted">{scan.scanner_tool}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {Array.isArray(scan.dtc_codes) && scan.dtc_codes.length > 0 ? (
                      <div className="space-y-1">
                        {scan.dtc_codes.map((dtc, idx) => (
                          <div key={`${scan.id}-dtc-${idx}`} className="text-xs">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 ${severityClass(dtc.severity)}`}>{dtc.severity}</span>
                            <span className="ml-2 font-mono font-semibold text-ink">{dtc.code}</span>
                            <span className="ml-1 text-ink">{dtc.description}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-faint">No DTCs</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {Array.isArray(scan.adas_systems) && scan.adas_systems.length > 0 ? (
                      <div className="space-y-1">
                        {scan.adas_systems.map((adas, idx) => (
                          <div key={`${scan.id}-adas-${idx}`} className="text-xs">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 ${statusClass(adas.status)}`}>
                              {adas.status.replace('_', ' ')}
                            </span>
                            <span className="ml-2 text-ink">{adas.system}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-faint">No ADAS entries</span>
                    )}
                  </td>
                  {canDelete && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteScan(scan.id)}
                        className="inline-flex items-center gap-1 rounded-instrument border border-crit/40 bg-crit/10 px-2 py-1 text-xs text-crit transition-colors hover:bg-crit/15"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <AppOverlay label="New vehicle diagnostic scan" onClose={() => setShowModal(false)} className="bg-void/75 p-4">
          <div className="max-h-[95vh] w-full max-w-5xl overflow-auto rounded-instrument border border-line-2 bg-panel">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line-2 bg-panel px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-ink">New Vehicle Diagnostic Scan</h2>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitScan} className="space-y-5 p-4">
              {error && <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</div>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">RO ID (optional)</label>
                  <input
                    value={form.ro_id}
                    onChange={(e) => setField('ro_id', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Vehicle ID (optional)</label>
                  <input
                    value={form.vehicle_id}
                    onChange={(e) => setField('vehicle_id', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">VIN</label>
                  <input
                    required
                    value={form.vin}
                    onChange={(e) => setField('vin', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Scan Date</label>
                  <input
                    type="datetime-local"
                    value={form.scan_date}
                    onChange={(e) => setField('scan_date', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Scanned By</label>
                  <input
                    required
                    value={form.scanned_by}
                    onChange={(e) => setField('scanned_by', e.target.value)}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Scanner Tool</label>
                  <input
                    value={form.scanner_tool}
                    onChange={(e) => setField('scanner_tool', e.target.value)}
                    placeholder="Autel MaxiSys"
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 rounded-lg border border-line-2 bg-void px-3 py-2">
                <label className="inline-flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.pre_repair}
                    onChange={(e) => setField('pre_repair', e.target.checked)}
                    className="h-4 w-4 accent-brand"
                  />
                  Pre-Repair Scan
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.post_repair}
                    onChange={(e) => setField('post_repair', e.target.checked)}
                    className="h-4 w-4 accent-good"
                  />
                  Post-Repair Scan
                </label>
              </div>

              <div className="space-y-2 rounded-instrument border border-line-2 bg-void p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-ink">DTC Codes</h3>
                  <button type="button" onClick={addDtcRow} className="rounded-md border border-line-2 px-2 py-1 text-xs text-ink hover:border-brand">
                    Add DTC
                  </button>
                </div>
                {form.dtc_codes.map((row, index) => (
                  <div key={`dtc-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-line-2 bg-panel-2 p-2 md:grid-cols-12">
                    <input
                      value={row.code}
                      onChange={(e) => updateDtc(index, 'code', e.target.value)}
                      placeholder="Code"
                      className="rounded-lg border border-line-2 bg-void px-3 py-2 font-mono text-xs text-ink md:col-span-3"
                    />
                    <input
                      value={row.description}
                      onChange={(e) => updateDtc(index, 'description', e.target.value)}
                      placeholder="Description"
                      className="rounded-lg border border-line-2 bg-void px-3 py-2 text-xs text-ink md:col-span-5"
                    />
                    <select
                      value={row.severity}
                      onChange={(e) => updateDtc(index, 'severity', e.target.value)}
                      className="rounded-lg border border-line-2 bg-void px-3 py-2 text-xs text-ink md:col-span-3"
                    >
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                    <button type="button" onClick={() => removeDtcRow(index)} className="rounded-lg border border-crit/40 px-2 py-2 text-xs text-crit md:col-span-1">
                      <Trash2 size={14} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-2 rounded-instrument border border-line-2 bg-void p-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-ink">ADAS Systems</h3>
                  <button type="button" onClick={addAdasRow} className="rounded-md border border-line-2 px-2 py-1 text-xs text-ink hover:border-brand">
                    Add ADAS
                  </button>
                </div>
                {form.adas_systems.map((row, index) => (
                  <div key={`adas-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-line-2 bg-panel-2 p-2 md:grid-cols-12">
                    <input
                      value={row.system}
                      onChange={(e) => updateAdas(index, 'system', e.target.value)}
                      placeholder="System"
                      className="rounded-lg border border-line-2 bg-void px-3 py-2 text-xs text-ink md:col-span-8"
                    />
                    <select
                      value={row.status}
                      onChange={(e) => updateAdas(index, 'status', e.target.value)}
                      className="rounded-lg border border-line-2 bg-void px-3 py-2 text-xs text-ink md:col-span-3"
                    >
                      <option value="ok">OK</option>
                      <option value="needs_calibration">Needs Calibration</option>
                      <option value="fault">Fault</option>
                    </select>
                    <button type="button" onClick={() => removeAdasRow(index)} className="rounded-lg border border-crit/40 px-2 py-2 text-xs text-crit md:col-span-1">
                      <Trash2 size={14} className="mx-auto" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line-2 pt-3">
                <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-line-2 px-4 py-2 text-sm text-ink hover:text-ink">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Scan'}
                </button>
              </div>
            </form>
          </div>
        </AppOverlay>
      )}
    </div>
  )
}
