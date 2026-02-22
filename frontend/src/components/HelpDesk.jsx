import { useEffect, useState } from 'react'

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
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-[#6366f1] text-white text-xl font-bold shadow-lg hover:brightness-110"
        aria-label="Open Help Desk"
      >
        ?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-[#2a2d3e] bg-[#1a1d2e] text-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">REVV HelpDesk</h2>
              <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-white">Close</button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-[#2a2d3e] border-t-[#6366f1] rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="text-red-400 text-sm bg-red-950/30 border border-red-800 rounded-lg p-3">{error}</div>
            ) : (
              <>
                <div className="mb-4 text-sm font-medium">
                  {diagnostics?.ok ? 'All systems healthy 🟢' : 'Issues detected 🔴'}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                  {(diagnostics?.checks || []).map((check, idx) => (
                    <div key={`${check.name}-${idx}`} className="border border-[#2a2d3e] rounded-lg p-3 bg-[#151827]">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <span>{check.ok ? '✅' : '❌'}</span>
                        <span>{check.name}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{check.detail}</div>
                    </div>
                  ))}
                </div>

                {actions.length > 0 && (
                  <div className="mb-4 border border-[#2a2d3e] rounded-lg p-3 bg-[#151827]">
                    <div className="text-sm font-semibold mb-2">Auto-Fix Actions</div>
                    <ul className="list-disc list-inside text-sm text-slate-300 space-y-1">
                      {actions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={runHeal}
                    disabled={healing}
                    className="px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {healing ? 'Running...' : 'Run Auto-Fix'}
                  </button>
                  <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-[#2a2d3e] text-slate-300 text-sm">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
