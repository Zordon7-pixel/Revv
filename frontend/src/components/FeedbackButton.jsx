import { useState } from 'react'
import { MessageSquarePlus, X, Send, ChevronDown } from 'lucide-react'
import api from '../lib/api'
import { useLocation } from 'react-router-dom'

const CATEGORIES = [
  { value: 'bug', label: '🐛 Bug / Something broken' },
  { value: 'ui', label: '🎨 Design / UI suggestion' },
  { value: 'feature', label: '💡 Feature idea' },
  { value: 'missing', label: '🔍 Missing info or data' },
  { value: 'general', label: '💬 General feedback' },
]

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ tester_name: '', category: 'general', message: '' })
  const location = useLocation()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.message.trim()) return
    setLoading(true)
    try {
      await api.post('/feedback', { ...form, page: location.pathname })
      setSent(true)
      setTimeout(() => { setSent(false); setOpen(false); setForm({ tester_name: '', category: 'general', message: '' }) }, 2500)
    } catch { alert('Failed to send — try again') }
    finally { setLoading(false) }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg shadow-indigo-900/50 transition-all hover:scale-105"
      >
        <MessageSquarePlus size={16} />
        Feedback
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e]">
              <div>
                <h2 className="font-bold text-white">Share Your Feedback</h2>
                <p className="text-xs text-slate-500 mt-0.5">Help us make this better — every note gets read</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {sent ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-3">🎯</div>
                <div className="text-white font-bold text-lg">Got it — thanks!</div>
                <div className="text-slate-400 text-sm mt-1">Zordon is on it. Your feedback just landed in HQ.</div>
              </div>
            ) : (
              <form onSubmit={submit} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Your Name <span className="text-slate-600">(optional)</span></label>
                  <input
                    value={form.tester_name}
                    onChange={e => set('tester_name', e.target.value)}
                    placeholder="First name is fine"
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Type of feedback</label>
                  <div className="relative">
                    <select
                      value={form.category}
                      onChange={e => set('category', e.target.value)}
                      className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
                    >
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">What's on your mind? <span className="text-red-400">*</span></label>
                  <textarea
                    value={form.message}
                    onChange={e => set('message', e.target.value)}
                    required
                    rows={4}
                    placeholder="Be as specific as possible — the more detail the better..."
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                  <div className="text-[10px] text-slate-600 mt-1">Currently on: <span className="text-slate-500">{location.pathname}</span></div>
                </div>
                <button
                  type="submit"
                  disabled={loading || !form.message.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
                >
                  <Send size={14} />
                  {loading ? 'Sending...' : 'Send to HQ'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
