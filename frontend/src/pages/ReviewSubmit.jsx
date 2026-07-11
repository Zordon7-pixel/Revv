import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Star } from 'lucide-react'
import api from '../lib/api'
import { Logo, Panel } from '../components/ui'

function StarButton({ score, filled, onClick, onHover, onLeave }) {
  return (
    <button type="button" onClick={onClick} onMouseEnter={onHover} onMouseLeave={onLeave} className="rounded-instrument p-1.5 text-faint transition-colors hover:bg-brand/10 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand" aria-label={`Rate ${score} out of 5`}>
      <Star size={40} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}

export default function ReviewSubmit() {
  const { token } = useParams()
  const [shopName, setShopName] = useState('this shop')
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function loadContext() {
      try {
        const { data } = await api.get(`/reviews/context/${token}`)
        if (!mounted) return
        setShopName(data.shop_name || 'this shop')
      } catch (requestError) {
        if (!mounted) return
        setError(requestError?.response?.data?.error || 'This review link is unavailable or expired.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    loadContext()
    return () => { mounted = false }
  }, [token])

  const displayRating = useMemo(() => hovered || rating, [hovered, rating])

  async function submit() {
    if (rating < 1 || rating > 5 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/reviews/submit/${token}`, { rating, comment })
      setDone(true)
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Could not submit your feedback.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-void px-4 py-8 text-ink sm:px-6 sm:py-12">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          <Logo variant="mark" className="h-10 w-10 shrink-0" />
          <div>
            <p className="font-display text-lg font-semibold text-ink">Customer review</p>
            <p className="text-sm text-muted">Share your experience with the repair shop</p>
          </div>
        </header>

        <Panel className="p-5 sm:p-7">
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-3 py-10 text-sm text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
              Loading review form...
            </div>
          ) : done ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-good" aria-hidden="true" />
              <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Thank you for your feedback</h1>
              <p role="status" className="mt-2 text-sm text-muted">Your rating helps {shopName} improve the customer experience.</p>
            </div>
          ) : (
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink">Rate your experience at {shopName}</h1>
              <p className="mt-2 text-sm text-muted">Choose a rating, then add an optional comment.</p>

              {error && <p role="alert" className="mt-4 rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">{error}</p>}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-1" aria-label="Select a rating">
                {[1, 2, 3, 4, 5].map((score) => (
                  <StarButton key={score} score={score} filled={score <= displayRating} onClick={() => setRating(score)} onHover={() => setHovered(score)} onLeave={() => setHovered(0)} />
                ))}
              </div>

              <label className="mt-6 block text-xs font-medium text-muted">
                Comment
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder="Optional comment" className="mt-1 w-full resize-y rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
              </label>

              <button type="button" onClick={submit} disabled={rating < 1 || submitting} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-40">
                {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {submitting ? 'Submitting...' : 'Submit rating'}
              </button>
            </div>
          )}
        </Panel>
      </div>
    </main>
  )
}
