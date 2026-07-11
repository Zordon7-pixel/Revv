import { useEffect, useState } from 'react'
import { CheckCircle, CircleHelp, Wrench, X, XCircle } from 'lucide-react'
import AppOverlay from './AppOverlay'

export default function HelpDesk() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [healing, setHealing] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [actions, setActions] = useState([])
  const [error, setError] = useState('')

  async function loadDiagnostics() {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('sc_token')
      const res = await fetch('/api/diagnostics', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load diagnostics')
      setDiagnostics(data)
    } catch (e) {
      setError(e.message || 'Failed to load diagnostics')
    } finally {
      setLoading(false)
    }
  }

  async function runHeal() {
    setHealing(true)
    setError('')
    try {
      const token = localStorage.getItem('sc_token')
      const res = await fetch('/api/diagnostics/heal', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Auto-fix failed')
      setActions(data.actions || [])
      await loadDiagnostics()
    } catch (e) {
      setError(e.message || 'Auto-fix failed')
    } finally {
      setHealing(false)
    }
  }

  useEffect(() => {
    if (open) loadDiagnostics()
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-lit"
        aria-label="Open Help Desk"
      >
        <CircleHelp size={20} />
      </button>

      {open && (
        <AppOverlay label="REVV HelpDesk" onClose={() => setOpen(false)} className="bg-black/60 p-4">
          <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-instrument border border-line-2 bg-panel p-5 text-ink">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">REVV HelpDesk</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink" aria-label="Close Help Desk"><X size={18} /></button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-line-2 border-t-brand" />
              </div>
            ) : error ? (
              <div role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 p-3 text-sm text-crit">{error}</div>
            ) : (
              <>
                <div className="mb-4 text-sm font-medium flex items-center gap-1.5">
                  {diagnostics?.ok
                    ? <><CheckCircle size={14} className="text-good" /> All systems healthy</>
                    : <><XCircle size={14} className="text-crit" /> Issues detected</>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                  {(diagnostics?.checks || []).map((check, idx) => (
                    <div key={`${check.name}-${idx}`} className="rounded-instrument border border-line-2 bg-panel-2 p-3">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {check.ok ? <CheckCircle size={14} className="text-good" /> : <XCircle size={14} className="text-crit" />}
                        <span>{check.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">{check.detail}</div>
                    </div>
                  ))}
                </div>

                {actions.length > 0 && (
                  <div className="mb-4 rounded-instrument border border-line-2 bg-panel-2 p-3">
                    <div className="text-sm font-semibold mb-2">Auto-Fix Actions</div>
                    <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                      {actions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={runHeal}
                    disabled={healing}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-50"
                  >
                    <Wrench size={15} /> {healing ? 'Running...' : 'Run Auto-Fix'}
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-line-2 bg-panel-2 px-4 py-2 text-sm text-muted transition-colors hover:border-brand/50 hover:text-ink">Close</button>
                </div>
              </>
            )}
          </div>
        </AppOverlay>
      )}
    </>
  )
}
