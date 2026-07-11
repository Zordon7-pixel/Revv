import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Award, Calendar, CheckCircle2, Loader2, MapPin, Phone, Share2, Star, Store } from 'lucide-react'
import api from '../lib/api'
import { Logo, Money, Panel, dollarsToCents } from '../components/ui'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'

export default function ShopProfile() {
  const { shopId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shareError, setShareError] = useState('')
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const response = await api.get(`/public/shop/${shopId}`)
        setData(response.data)
      } catch (requestError) {
        setError(requestError?.response?.data?.error || 'Unable to load shop.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shopId])

  function callShop() {
    if (data?.shop?.phone) window.location.href = `tel:${data.shop.phone}`
  }

  function bookAppointment() {
    navigate('/book')
  }

  async function shareProfile() {
    const shareUrl = `${window.location.origin}/shop/${shopId}`
    setShareError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setShareError('Could not copy the shop link. Copy the URL from your browser instead.')
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-void">
        <div role="status" className="flex items-center gap-3 text-sm text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
          Loading shop profile...
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-void px-4 text-ink">
        <Panel className="w-full max-w-md p-6 text-center">
          <Store className="mx-auto h-9 w-9 text-crit" aria-hidden="true" />
          <h1 className="mt-4 font-display text-xl font-semibold text-ink">Shop not found</h1>
          <p role="alert" className="mt-2 text-sm text-crit">{error || 'Unable to load shop.'}</p>
        </Panel>
      </main>
    )
  }

  const { shop, rating = {}, badges = [], reviews = [] } = data
  const hasRating = Number(rating?.avg) > 0
  const address = [shop.address, shop.city, shop.state, shop.zip].filter(Boolean).join(', ')

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          {shop.logo_url ? (
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-instrument border border-line bg-panel p-1.5">
              <img src={resolveUploadedMediaUrl(shop.logo_url)} alt={`${shop.name} logo`} className="h-full w-full object-contain" />
            </span>
          ) : <Logo variant="mark" className="h-12 w-12 shrink-0" />}
          <div className="min-w-0">
            <h1 className="break-words font-display text-2xl font-semibold leading-tight text-ink">{shop.name}</h1>
            {address && <p className="mt-1 flex items-start gap-1.5 text-sm text-muted"><MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{address}</span></p>}
          </div>
        </header>

        {shareError && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">{shareError}</p>}
        {copied && <p role="status" className="rounded-instrument border border-good/30 bg-good/10 px-4 py-3 text-sm text-good">Shop profile link copied.</p>}

        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={callShop} disabled={!shop.phone} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-45">
            <Phone size={16} aria-hidden="true" /> Call
          </button>
          <button type="button" onClick={bookAppointment} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/15">
            <Calendar size={16} aria-hidden="true" /> Book appointment
          </button>
          <button type="button" onClick={shareProfile} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument border border-line-2 bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand">
            {copied ? <CheckCircle2 size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>

        <Panel title="Customer rating">
          <div className="p-5 text-center">
            {hasRating ? (
              <div className="flex items-center justify-center gap-2">
                <Star className="h-8 w-8 fill-brand text-brand" aria-hidden="true" />
                <span className="font-mono text-4xl font-bold tabular-nums text-ink">{rating.avg}</span>
                <span className="font-mono text-lg tabular-nums text-faint">/5</span>
              </div>
            ) : <p className="text-sm text-muted">No ratings yet</p>}
            {hasRating && <p className="mt-2 font-mono text-xs tabular-nums text-muted">{rating.count} review{rating.count !== 1 ? 's' : ''}</p>}

            {badges.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {badges.map((badge) => (
                  <span key={badge.type} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${badge.type === 'top_rated' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-good/30 bg-good/10 text-good'}`}>
                    <Award size={14} aria-hidden="true" /> {badge.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {shop.labor_rate && (
          <Panel title="Posted labor rate">
            <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <span className="text-sm text-muted">Body labor</span>
              <span className="flex items-baseline gap-1"><Money cents={dollarsToCents(shop.labor_rate)} className="font-semibold text-gold" /><span className="text-xs text-muted">/hr</span></span>
            </div>
          </Panel>
        )}

        <Panel title="Recent reviews">
          {reviews.length > 0 ? (
            <div className="divide-y divide-line px-4 sm:px-5">
              {reviews.map((review) => (
                <article key={review.id} className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex gap-1" aria-label={`${review.rating} out of 5 stars`}>
                      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={16} className={star <= review.rating ? 'fill-brand text-brand' : 'text-faint'} aria-hidden="true" />)}
                    </div>
                    <time className="font-mono text-xs tabular-nums text-faint">{new Date(review.date).toLocaleDateString()}</time>
                  </div>
                  {review.vehicle && <p className="mt-2 text-xs text-muted">{review.vehicle}</p>}
                </article>
              ))}
            </div>
          ) : <p role="status" className="px-4 py-8 text-center text-sm text-muted">No reviews yet</p>}
        </Panel>

        <button type="button" onClick={bookAppointment} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">
          <Calendar size={17} aria-hidden="true" /> Book appointment
        </button>
      </div>
    </main>
  )
}
