import { useEffect, useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import api from '../lib/api'

function StarRow({ rating }) {
  return (
    <div className="flex items-center gap-1 text-brand">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={16} fill={n <= rating ? 'currentColor' : 'none'} />
      ))}
    </div>
  )
}

export default function Reviews() {
  const [summary, setSummary] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const [summaryRes, reviewsRes] = await Promise.all([
          api.get('/reviews/summary'),
          api.get('/reviews'),
        ])
        if (!mounted) return
        setSummary(summaryRes.data || null)
        setReviews(reviewsRes.data?.reviews || [])
        setLoading(false)
      } catch (err) {
        if (!mounted) return
        setError(err?.response?.data?.error || 'Could not load reviews.')
        setLoading(false)
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  const average = Number(summary?.average_rating || 0)
  const distribution = summary?.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const maxCount = useMemo(() => Math.max(...Object.values(distribution), 1), [distribution])

  if (loading) return <div className="text-sm text-muted" role="status">Loading reviews...</div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Customer Reviews</h1>
        <p className="text-sm text-muted">Track post-repair customer feedback across closed jobs.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-4 py-3 text-sm text-crit">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-instrument border border-line-2 bg-panel p-5 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-faint">Average Rating</p>
          <p className="mt-2 font-mono text-4xl font-bold tabular-nums text-ink">{average.toFixed(1)}</p>
          <div className="mt-2">
            <StarRow rating={Math.round(average)} />
          </div>
          <p className="mt-2 text-sm text-muted">{summary?.total_reviews || 0} total reviews</p>
        </div>

        <div className="rounded-instrument border border-line-2 bg-panel p-5 md:col-span-2">
          <p className="text-xs uppercase tracking-wide text-faint">Rating Distribution</p>
          <div className="mt-4 space-y-2">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = Number(distribution[n] || 0)
              const width = (count / maxCount) * 100
              return (
                <div key={n} className="flex items-center gap-3 text-sm">
                  <span className="w-8 font-mono text-ink">{n}★</span>
                  <div className="h-3 flex-1 rounded-full bg-raised">
                    <div className="h-3 rounded-full bg-brand" style={{ width: `${width}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-muted">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="rounded-instrument border border-line-2 bg-panel p-5">
        <h2 className="font-display text-lg font-semibold text-ink">Recent Feedback</h2>
        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-faint">No reviews yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {reviews.map((review) => (
              <article key={review.id} className="rounded-instrument border border-line-2 bg-void p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StarRow rating={review.rating} />
                  <p className="font-mono text-xs text-faint">{new Date(review.submitted_at).toLocaleDateString()}</p>
                </div>
                {review.comment && <p className="mt-2 text-sm text-ink">{review.comment}</p>}
                <p className="mt-2 text-xs text-muted">{review.customer_name || 'Anonymous customer'}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
