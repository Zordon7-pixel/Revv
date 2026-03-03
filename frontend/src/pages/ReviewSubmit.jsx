import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star } from 'lucide-react'
import api from '../lib/api'

function StarButton({ filled, onClick, onHover, onLeave }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="p-1 text-amber-400 transition-transform hover:scale-110"
      aria-label="Rate star"
    >
      <Star size={48} fill={filled ? 'currentColor' : 'none'} />
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
        setLoading(false)
      } catch (err) {
        if (!mounted) return
        setError(err?.response?.data?.error || 'This review link is unavailable or expired.')
        setLoading(false)
      }
    }

    loadContext()
    return () => {
      mounted = false
    }
  }, [token])

  const displayRating = useMemo(() => hovered || rating, [hovered, rating])

  async function submit() {
    if (rating < 1 || rating > 5 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/reviews/submit/${token}`, { rating, comment })
      setDone(true)
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit your feedback.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#2a2d3e] bg-[#1a1d2e] p-6 md:p-8">
        {loading ? (
          <div className="text-sm text-slate-400">Loading review form...</div>
        ) : done ? (
          <div className="space-y-3 text-center">
            <h1 className="text-3xl font-bold text-white">Thank you for your feedback! ⭐</h1>
            <p className="text-slate-300">We appreciate you taking a minute to rate your experience.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white">Rate your experience at {shopName}</h1>
            <p className="mt-2 text-sm text-slate-400">Your response helps the shop improve service quality.</p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <StarButton
                  key={n}
                  filled={n <= displayRating}
                  onClick={() => setRating(n)}
                  onHover={() => setHovered(n)}
                  onLeave={() => setHovered(0)}
                />
              ))}
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Optional comment"
              className="mt-6 w-full rounded-lg border border-[#2a2d3e] bg-[#0f1117] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />

            <button
              type="button"
              onClick={submit}
              disabled={rating < 1 || submitting}
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'Submitting...' : 'Submit Rating'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
