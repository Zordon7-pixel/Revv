import { useState } from 'react'
import { MessageSquarePlus, X, Send, Plus, CheckCircle, Trash2, Bug, Palette, Lightbulb, HelpCircle, Search, Rocket } from 'lucide-react'
import api from '../lib/api'
import { useLocation } from 'react-router-dom'

const CATEGORIES = [
  { value: 'bug', label: 'Bug / Broken', icon: Bug, soldier: 'Codex 5.3', color: 'text-red-400' },
  { value: 'ui', label: 'Design / UI', icon: Palette, soldier: 'Codex 5.3', color: 'text-purple-400' },
  { value: 'feature', label: 'Feature Idea', icon: Lightbulb, soldier: 'Colonel Zordon', color: 'text-indigo-400' },
  { value: 'question', label: 'Question', icon: HelpCircle, soldier: 'Colonel Zordon', color: 'text-blue-400' },
  { value: 'missing', label: 'Missing Info', icon: Search, soldier: 'Codex 5.3', color: 'text-orange-400' },
  { value: 'idea', label: 'Big Idea', icon: Rocket, soldier: 'Colonel Zordon', color: 'text-yellow-400' },
]

const PRIORITIES = [
  { value: 'low', label: 'Nice to have' },
  { value: 'medium', label: 'Important' },
  { value: 'high', label: 'Critical — blocking me' },
]

const blank = () => ({ category: 'bug', priority: 'medium', message: '', expected: '' })

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [items, setItems] = useState([blank()])
  const [submitted, setSubmitted] = useState([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const location = useLocation()

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, blank()])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const cat = (val) => CATEGORIES.find(c => c.value === val)

  async function submit() {
    const valid = items.filter(it => it.message.trim())
    if (!valid.length) return
    setLoading(true)
    try {
      for (const item of valid) {
        await api.post('/feedback', {
          tester_name: name || 'Anonymous',
          category: item.category,
          priority: item.priority,
          message: item.message.trim(),
          expected: item.expected.trim(),
          page: location.pathname,
          routed_to: cat(item.category)?.soldier
        })
      }
      setSubmitted(valid)
      setDone(true)
    } catch { alert('Failed to send — try again') }
    finally { setLoading(false) }
  }

  function reset() {
    setDone(false); setItems([blank()]); setSubmitted([])
  }

  function close() {
    setOpen(false); setTimeout(reset, 300)
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="fixed bottom-5 right-36 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg shadow-indigo-900/50 transition-all hover:scale-105">
        <MessageSquarePlus size={16} /> Feedback
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#2a2d3e] flex-shrink-0">
              <div>
                <h2 className="font-bold text-white">Tester Feedback</h2>
                <p className="text-xs text-slate-500 mt-0.5">Every idea, question, and bug goes straight to HQ</p>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            {done ? (
              <div className="p-8 text-center">
                <CheckCircle size={48} className="text-emerald-400 mx-auto mb-4" />
                <div className="text-white font-bold text-lg mb-2">Feedback received — thank you!</div>
                <div className="text-slate-400 text-sm mb-4">
                  {submitted.length} item{submitted.length > 1 ? 's' : ''} routed to the right soldier at HQ.
                </div>
                <div className="space-y-2 mb-5">
                  {submitted.map((it, i) => {
                    const catData = cat(it.category)
                    const IconComp = catData?.icon
                    return (
                      <div key={i} className="flex items-center justify-between bg-[#0f1117] rounded-lg px-3 py-2 text-xs">
                        <span className="text-slate-300 flex items-center gap-1.5">
                          {IconComp && <IconComp size={13} />}
                          {catData?.label}
                        </span>
                        <span className="text-indigo-400 font-medium">→ {catData?.soldier}</span>
                      </div>
                    )
                  })}
                </div>
                <button onClick={reset} className="text-indigo-400 hover:text-indigo-300 text-sm underline">Submit more feedback</button>
              </div>
            ) : (
              <>
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {/* Tester name — once */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Your Name <span className="text-slate-600">(optional)</span></label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="First name is fine"
                      className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                  </div>

                  {/* Feedback items */}
                  {items.map((item, i) => (
                    <div key={i} className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">#{i + 1}</span>
                        {items.length > 1 && (
                          <button onClick={() => removeItem(i)} className="text-slate-600 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">Type</label>
                          <select value={item.category} onChange={e => setItem(i, 'category', e.target.value)}
                            className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
                            {CATEGORIES.map(c => {
                              const IconComp = c.icon
                              return <option key={c.value} value={c.value}>{c.label}</option>
                            })}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">Priority</label>
                          <select value={item.priority} onChange={e => setItem(i, 'priority', e.target.value)}
                            className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
                            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">What happened / your idea <span className="text-red-400">*</span></label>
                        <textarea value={item.message} onChange={e => setItem(i, 'message', e.target.value)} rows={3}
                          placeholder={item.category === 'bug' ? "Describe what went wrong..." : item.category === 'feature' || item.category === 'idea' ? "Describe your idea..." : "Your question or feedback..."}
                          className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
                      </div>

                      {(item.category === 'bug' || item.category === 'missing') && (
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">What did you expect instead?</label>
                          <input value={item.expected} onChange={e => setItem(i, 'expected', e.target.value)}
                            placeholder="What should have happened..."
                            className="w-full bg-[#1a1d2e] border border-[#2a2d3e] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                        <span>→ Routes to:</span>
                        <span className={`font-bold ${cat(item.category)?.color}`}>{cat(item.category)?.soldier}</span>
                      </div>
                    </div>
                  ))}

                  <button onClick={addItem}
                    className="w-full flex items-center justify-center gap-2 border border-dashed border-[#2a2d3e] hover:border-indigo-500/50 text-slate-500 hover:text-indigo-400 rounded-xl py-2.5 text-xs transition-all">
                    <Plus size={14} /> Add another item
                  </button>
                </div>

                <div className="p-5 border-t border-[#2a2d3e] flex-shrink-0">
                  <button onClick={submit} disabled={loading || !items.some(it => it.message.trim())}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
                    <Send size={14} />
                    {loading ? 'Sending to HQ...' : `Send ${items.filter(it => it.message.trim()).length || ''} item${items.filter(it => it.message.trim()).length !== 1 ? 's' : ''} to HQ`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
