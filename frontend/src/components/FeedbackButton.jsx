import { useState } from 'react'
import { MessageSquarePlus, X, Send, Plus, CheckCircle, Trash2, Bug, Palette, Lightbulb, HelpCircle, Search, Rocket } from 'lucide-react'
import api from '../lib/api'
import { useLocation } from 'react-router-dom'
import AppOverlay from './AppOverlay'

const CATEGORIES = [
  { value: 'bug', label: 'Bug / Broken', icon: Bug, soldier: 'Codex 5.3', color: 'text-crit' },
  { value: 'ui', label: 'Design / UI', icon: Palette, soldier: 'Codex 5.3', color: 'text-brand' },
  { value: 'feature', label: 'Feature Idea', icon: Lightbulb, soldier: 'Colonel Zordon', color: 'text-brand' },
  { value: 'question', label: 'Question', icon: HelpCircle, soldier: 'Colonel Zordon', color: 'text-brand' },
  { value: 'missing', label: 'Missing Info', icon: Search, soldier: 'Codex 5.3', color: 'text-crit' },
  { value: 'idea', label: 'Big Idea', icon: Rocket, soldier: 'Colonel Zordon', color: 'text-good' },
]

const PRIORITIES = [
  { value: 'low', label: 'Nice to have' },
  { value: 'medium', label: 'Important' },
  { value: 'high', label: 'Critical — blocking me' },
]

const blank = () => ({ category: 'bug', priority: 'medium', message: '', expected: '' })

export default function FeedbackButton({ placement = 'floating' }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [items, setItems] = useState([blank()])
  const [submitted, setSubmitted] = useState([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, blank()])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const cat = (val) => CATEGORIES.find(c => c.value === val)

  async function submit() {
    const valid = items.filter(it => it.message.trim())
    if (!valid.length) return
    setLoading(true)
    setError('')
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
    } catch {
      console.error('[FeedbackButton] Feedback submission failed')
      setError('Failed to send feedback. Please try again.')
    }
    finally { setLoading(false) }
  }

  function reset() {
    setDone(false); setItems([blank()]); setSubmitted([]); setError('')
  }

  function close() {
    setOpen(false); setTimeout(reset, 300)
  }

  const triggerClass = placement === 'sidebar'
    ? 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:bg-brand/10 hover:text-brand'
    : 'fixed bottom-5 right-36 z-40 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-brand-lit'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={triggerClass}>
        <MessageSquarePlus size={16} /> Feedback
      </button>

      {open && (
        <AppOverlay label="Send feedback" onClose={close} className="items-end bg-black/70 p-4 sm:items-center">
          <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-instrument border border-line-2 bg-panel">

            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-line-2 p-5">
              <div>
                <h2 className="font-bold text-ink">Tester Feedback</h2>
                <p className="mt-0.5 text-xs text-faint">Every idea, question, and bug goes straight to HQ</p>
              </div>
              <button type="button" onClick={close} className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink" aria-label="Close feedback dialog"><X size={18} /></button>
            </div>

            {done ? (
              <div className="p-8 text-center">
                <CheckCircle size={48} className="mx-auto mb-4 text-good" />
                <div className="mb-2 text-lg font-bold text-ink">Feedback received — thank you!</div>
                <div className="mb-4 text-sm text-muted">
                  {submitted.length} item{submitted.length > 1 ? 's' : ''} routed to the right soldier at HQ.
                </div>
                <div className="space-y-2 mb-5">
                  {submitted.map((it, i) => {
                    const catData = cat(it.category)
                    const IconComp = catData?.icon
                    return (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-void px-3 py-2 text-xs">
                        <span className="flex items-center gap-1.5 text-muted">
                          {IconComp && <IconComp size={13} />}
                          {catData?.label}
                        </span>
                        <span className="font-medium text-brand">→ {catData?.soldier}</span>
                      </div>
                    )
                  })}
                </div>
                <button type="button" onClick={reset} className="text-sm text-brand underline transition-colors hover:text-brand-lit">Submit more feedback</button>
              </div>
            ) : (
              <>
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {/* Tester name — once */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">Your Name <span className="text-faint">(optional)</span></label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="First name is fine"
                      aria-label="Your name"
                      className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                  </div>

                  {/* Feedback items */}
                  {items.map((item, i) => (
                    <div key={i} className="space-y-3 rounded-instrument border border-line-2 bg-void p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">#{i + 1}</span>
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)} className="rounded-md p-1 text-faint transition-colors hover:bg-crit/10 hover:text-crit" aria-label={`Remove feedback item ${i + 1}`}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-faint">Type</label>
                          <select value={item.category} onChange={e => setItem(i, 'category', e.target.value)}
                            aria-label={`Feedback item ${i + 1} type`}
                            className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
                            {CATEGORIES.map(c => {
                              const IconComp = c.icon
                              return <option key={c.value} value={c.value}>{c.label}</option>
                            })}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-faint">Priority</label>
                          <select value={item.priority} onChange={e => setItem(i, 'priority', e.target.value)}
                            aria-label={`Feedback item ${i + 1} priority`}
                            className="w-full rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
                            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-medium text-faint">What happened / your idea <span className="text-crit">*</span></label>
                        <textarea value={item.message} onChange={e => setItem(i, 'message', e.target.value)} rows={3}
                          aria-label={`Feedback item ${i + 1} message`}
                          placeholder={item.category === 'bug' ? "Describe what went wrong..." : item.category === 'feature' || item.category === 'idea' ? "Describe your idea..." : "Your question or feedback..."}
                          className="w-full resize-none rounded-lg border border-line-2 bg-panel px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                      </div>

                      {(item.category === 'bug' || item.category === 'missing') && (
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-faint">What did you expect instead?</label>
                          <input value={item.expected} onChange={e => setItem(i, 'expected', e.target.value)}
                            aria-label={`Feedback item ${i + 1} expected outcome`}
                            placeholder="What should have happened..."
                            className="w-full rounded-lg border border-line-2 bg-panel px-3 py-2 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-[10px] text-faint">
                        <span>→ Routes to:</span>
                        <span className={`font-bold ${cat(item.category)?.color}`}>{cat(item.category)?.soldier}</span>
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addItem}
                    className="flex w-full items-center justify-center gap-2 rounded-instrument border border-dashed border-line-2 py-2.5 text-xs text-faint transition-colors hover:border-brand/50 hover:text-brand">
                    <Plus size={14} /> Add another item
                  </button>
                </div>

                <div className="flex-shrink-0 border-t border-line-2 p-5">
                  {error && <div role="alert" className="mb-3 rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</div>}
                  <button type="button" onClick={submit} disabled={loading || !items.some(it => it.message.trim())}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-40">
                    <Send size={14} />
                    {loading ? 'Sending to HQ...' : `Send ${items.filter(it => it.message.trim()).length || ''} item${items.filter(it => it.message.trim()).length !== 1 ? 's' : ''} to HQ`}
                  </button>
                </div>
              </>
            )}
          </div>
        </AppOverlay>
      )}
    </>
  )
}
