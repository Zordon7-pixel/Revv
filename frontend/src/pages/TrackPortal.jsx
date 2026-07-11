import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, ImageOff, Loader2, MessageSquare, Phone, Star, X } from 'lucide-react'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { Logo, Panel, StatusBadge } from '../components/ui'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'

const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed']
const STATUS_LABELS = {
  intake: 'Vehicle received',
  estimate: 'Preparing estimate',
  approval: 'Awaiting approval',
  parts: 'Parts on order',
  repair: 'In repair',
  paint: 'In paint',
  qc: 'Quality check',
  delivery: 'Ready for pickup',
  closed: 'Repair complete',
}

function PortalPhoto({ photo, className = '' }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={`grid place-items-center bg-panel-2 text-faint ${className}`}>
        <span className="flex flex-col items-center gap-2 text-xs">
          <ImageOff size={20} aria-hidden="true" />
          Photo unavailable
        </span>
      </span>
    )
  }
  return (
    <img
      src={resolveUploadedMediaUrl(photo.photo_url)}
      alt={photo.caption || 'Repair photo'}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

export default function TrackPortal() {
  const { t } = useLanguage()
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [data, setData] = useState(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [message, setMessage] = useState('')
  const [messageSent, setMessageSent] = useState(false)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [rating, setRating] = useState(0)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError('')
      try {
        const response = await api.get(`/portal/track/${token}`)
        setData(response.data)
      } catch (requestError) {
        setData(null)
        setError(requestError?.response?.data?.error || 'Unable to load tracking information.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [token])

  useEffect(() => {
    if (!lightboxPhoto) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setLightboxPhoto(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [lightboxPhoto])

  async function sendMessage(event) {
    event.preventDefault()
    if (!message.trim()) return
    setSendingMessage(true)
    setActionError('')
    try {
      await api.post(`/portal/track/${token}/message`, { notes: message })
      setMessage('')
      setMessageSent(true)
      window.setTimeout(() => setMessageSent(false), 3000)
    } catch (requestError) {
      setActionError(requestError?.response?.data?.error || 'Failed to send message.')
    } finally {
      setSendingMessage(false)
    }
  }

  async function submitRating(score) {
    setSubmittingRating(true)
    setActionError('')
    try {
      await api.post(`/portal/track/${token}/rating`, { rating: score })
      setRating(score)
      setRatingSubmitted(true)
    } catch (requestError) {
      setActionError(requestError?.response?.data?.error || 'Failed to submit rating.')
    } finally {
      setSubmittingRating(false)
    }
  }

  function callShop() {
    if (data?.shop?.phone) window.location.href = `tel:${data.shop.phone}`
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-void">
        <div role="status" className="flex items-center gap-3 text-sm text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
          Loading repair status...
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-void px-4 text-ink">
        <Panel className="w-full max-w-md p-6 text-center">
          <X className="mx-auto h-9 w-9 text-crit" aria-hidden="true" />
          <h1 className="mt-4 font-display text-xl font-semibold text-ink">Tracking unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-crit">{error || 'Unable to load tracking information.'}</p>
        </Panel>
      </main>
    )
  }

  const { ro, vehicle, shop, parts = [], photos = [], timeline = [], has_rated: hasRated, user_rating: userRating } = data
  const rawCurrentIndex = STAGES.indexOf(String(ro.status || '').toLowerCase())
  const currentIndex = rawCurrentIndex >= 0 ? rawCurrentIndex : 0
  const timelineByStatus = timeline.reduce((accumulator, entry) => {
    if (entry?.to_status) accumulator[entry.to_status] = entry.created_at
    return accumulator
  }, {})
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'

  return (
    <main className="min-h-screen bg-void text-ink">
      {ro.status === 'delivery' && (
        <div className="border-b border-good/30 bg-good/10 px-4 py-3 text-good">
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-sm font-semibold">
            <Check size={18} aria-hidden="true" />
            Your vehicle is ready for pickup
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Logo variant="mark" className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="break-words font-display text-xl font-semibold leading-tight text-ink">{shop.name || 'Repair tracking'}</h1>
              <p className="mt-0.5 text-sm text-muted">{[shop.address, shop.city, shop.state, shop.zip].filter(Boolean).join(', ')}</p>
            </div>
          </div>
          <button type="button" onClick={callShop} disabled={!shop.phone} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-45">
            <Phone size={16} aria-hidden="true" />
            {t('portal.contactShop')}
          </button>
        </header>

        {actionError && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-4 py-3 text-sm text-crit">{actionError}</p>}

        <Panel title={vehicleLabel} description={`${t('ro.title')}: ${ro.ro_number || 'Not provided'}`} actions={<StatusBadge status={ro.status} />}>
          {vehicle.color && <p className="px-4 py-3 text-sm text-muted sm:px-5">Color: <span className="text-ink">{vehicle.color}</span></p>}
        </Panel>

        <Panel title={t('portal.trackTitle')} description={`Step ${currentIndex + 1} of ${STAGES.length}`}>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-9 gap-1.5" aria-label="Repair progress">
              {STAGES.map((stage, index) => (
                <span key={stage} className={`h-2 rounded-full ${index <= currentIndex ? 'bg-brand' : 'bg-raised'}`} aria-hidden="true" />
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden="true" />
                <span className="text-sm font-semibold text-brand">{STATUS_LABELS[ro.status] || 'Repair in progress'}</span>
              </div>
              {ro.estimated_delivery && !['closed', 'delivery'].includes(ro.status) && (
                <span className="text-xs text-muted">{t('portal.estimatedCompletion')}: <span className="font-mono tabular-nums text-ink">{ro.estimated_delivery}</span></span>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Status timeline">
          <ol className="divide-y divide-line px-4 sm:px-5">
            {STAGES.map((stage, index) => {
              const complete = index <= currentIndex
              const active = index === currentIndex
              return (
                <li key={stage} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${complete ? 'bg-brand' : 'bg-raised'} ${active ? 'ring-4 ring-brand/15' : ''}`} aria-hidden="true" />
                    <span className={`truncate text-sm ${complete ? 'text-ink' : 'text-faint'}`}>{STATUS_LABELS[stage]}</span>
                  </div>
                  <time className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                    {timelineByStatus[stage] ? new Date(timelineByStatus[stage]).toLocaleDateString() : '—'}
                  </time>
                </li>
              )
            })}
          </ol>
        </Panel>

        {photos.length > 0 && (
          <Panel title="Repair photos" description="Select a photo to view it full size.">
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
              {photos.slice(0, 6).map((photo) => (
                <button key={photo.id} type="button" onClick={() => setLightboxPhoto(photo)} className="aspect-square min-w-0 overflow-hidden rounded-instrument border border-line-2 bg-panel-2 focus:outline-none focus:ring-2 focus:ring-brand" aria-label={`View ${photo.caption || 'repair photo'}`}>
                  <PortalPhoto photo={photo} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </Panel>
        )}

        {parts.length > 0 && (
          <Panel title={t('ro.parts')}>
            <ul className="divide-y divide-line px-4 sm:px-5">
              {parts.map((part, index) => {
                const tone = part.status === 'received' ? 'good' : part.status === 'backordered' ? 'crit' : 'brand'
                return (
                  <li key={part.id || `${part.part_name}-${index}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0 truncate text-ink">{part.part_name}</span>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${tone === 'good' ? 'border-good/30 bg-good/10 text-good' : tone === 'crit' ? 'border-crit/30 bg-crit/10 text-crit' : 'border-brand/30 bg-brand/10 text-brand'}`}>{part.status}</span>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        <Panel title="Message the shop" description="Send a question or note directly to the repair team.">
          <form onSubmit={sendMessage} className="space-y-3 p-4 sm:p-5">
            <label className="sr-only" htmlFor="portal-message">Message</label>
            <textarea id="portal-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a question or leave a note..." className="w-full resize-y rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" rows={3} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="submit" disabled={sendingMessage || !message.trim()} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-45">
                <MessageSquare size={16} aria-hidden="true" />
                {sendingMessage ? 'Sending...' : 'Send message'}
              </button>
              {messageSent && <span role="status" className="inline-flex items-center gap-1 text-sm text-good"><Check size={14} aria-hidden="true" /> Sent</span>}
            </div>
          </form>
        </Panel>

        {ro.status === 'closed' && (
          <Panel title="How was your experience?">
            <div className="p-4 sm:p-5">
              {hasRated || ratingSubmitted ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex gap-1" aria-label={`${userRating || rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={24} className={star <= (userRating || rating) ? 'fill-brand text-brand' : 'text-faint'} aria-hidden="true" />)}
                  </div>
                  <span role="status" className="text-sm text-good">Thanks for your feedback.</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button key={score} type="button" onClick={() => submitRating(score)} disabled={submittingRating} className="rounded-md p-2 text-faint transition-colors hover:bg-brand/10 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand" aria-label={`Rate ${score} out of 5`}>
                      <Star size={28} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {submittingRating && <p role="status" className="mt-2 text-sm text-muted">Submitting your rating...</p>}
            </div>
          </Panel>
        )}
      </div>

      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-void/95 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Repair photo preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxPhoto(null) }}>
          <button type="button" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-line-2 bg-panel text-ink hover:border-brand" onClick={() => setLightboxPhoto(null)} aria-label="Close photo preview">
            <X size={22} aria-hidden="true" />
          </button>
          <figure className="grid max-h-[calc(100dvh-6rem)] max-w-5xl place-items-center gap-3">
            <PortalPhoto photo={lightboxPhoto} className="max-h-[calc(100dvh-9rem)] max-w-full object-contain" />
            {lightboxPhoto.caption && <figcaption className="text-center text-sm text-muted">{lightboxPhoto.caption}</figcaption>}
          </figure>
        </div>
      )}
    </main>
  )
}
