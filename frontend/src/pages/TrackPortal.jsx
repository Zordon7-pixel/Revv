import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Phone, MessageSquare, Star, Copy, Check, X, ChevronRight, Loader2 } from 'lucide-react'
import api from '../lib/api'

const STAGES = ['intake', 'estimate', 'approval', 'parts', 'repair', 'paint', 'qc', 'delivery', 'closed']
const STATUS_LABELS = {
  intake: 'Vehicle Received',
  estimate: 'Preparing Estimate',
  approval: 'Awaiting Approval',
  parts: 'Parts on Order',
  repair: 'In Repair',
  paint: 'In Paint',
  qc: 'Quality Check',
  delivery: 'Ready for Pickup',
  closed: 'Repair Complete',
}

const STATUS_COLORS = {
  intake: '#64748b',
  estimate: '#3b82f6',
  approval: '#f59e0b',
  parts: '#8b5cf6',
  repair: '#10b981',
  paint: '#ec4899',
  qc: '#14b8a6',
  delivery: '#22c55e',
  closed: '#eab308',
}

export default function TrackPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [message, setMessage] = useState('')
  const [messageSent, setMessageSent] = useState(false)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [rating, setRating] = useState(0)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)

  const loadData = async () => {
    try {
      const res = await api.get(`/portal/track/${token}`)
      setData(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load tracking info')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [token])

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!message.trim()) return
    setSendingMessage(true)
    try {
      await api.post(`/portal/track/${token}/message`, { notes: message })
      setMessage('')
      setMessageSent(true)
      setTimeout(() => setMessageSent(false), 3000)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send message')
    } finally {
      setSendingMessage(false)
    }
  }

  const submitRating = async (score) => {
    setSubmittingRating(true)
    try {
      await api.post(`/portal/track/${token}/rating`, { rating: score })
      setRating(score)
      setRatingSubmitted(true)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit rating')
    } finally {
      setSubmittingRating(false)
    }
  }

  const callShop = () => {
    if (data?.shop?.phone) {
      window.location.href = `tel:${data.shop.phone}`
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#EAB308] animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
        <div className="bg-[#1a1d2e] border border-red-800 rounded-xl p-6 max-w-md text-center">
          <X className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">Unable to Load</h2>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    )
  }

  const { ro, vehicle, customer, shop, parts, photos, timeline, has_rated, user_rating } = data
  const currentIdx = STAGES.indexOf(ro.status)
  const isPulsing = ['repair', 'paint', 'qc'].includes(ro.status)

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* Ready for Pickup Banner */}
      {ro.status === 'delivery' && (
        <div className="bg-emerald-900/30 border-b border-emerald-700/40 p-4">
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-3">
            <Check className="w-6 h-6 text-emerald-400" />
            <span className="text-emerald-300 font-semibold text-lg">Your vehicle is ready for pickup!</span>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Shop Info */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">{shop.name}</h1>
              <p className="text-slate-400 text-sm">{shop.address}, {shop.city}, {shop.state} {shop.zip}</p>
            </div>
            <button
              onClick={callShop}
              className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Phone size={16} />
              Call Shop
            </button>
          </div>
        </div>

        {/* Vehicle & RO Info */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h2>
            <span className="text-sm text-slate-400">RO: {ro.ro_number}</span>
          </div>
          {vehicle.color && (
            <p className="text-sm text-slate-500">Color: {vehicle.color}</p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">Repair Progress</span>
            <span className="text-xs text-slate-500">Step {currentIdx + 1} of {STAGES.length}</span>
          </div>
          <div className="flex gap-1 mb-2">
            {STAGES.slice(0, -1).map((stage, i) => (
              <div
                key={stage}
                className="flex-1 h-2 rounded-full transition-all"
                style={{
                  background: i <= currentIdx ? STATUS_COLORS[stage] : '#2a2d3e',
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: STATUS_COLORS[ro.status] }}>
                {STATUS_LABELS[ro.status]}
              </span>
              {isPulsing && (
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: STATUS_COLORS[ro.status] }} />
              )}
            </div>
            {ro.estimated_delivery && ro.status !== 'closed' && ro.status !== 'delivery' && (
              <span className="text-xs text-slate-500">Est: {ro.estimated_delivery}</span>
            )}
          </div>
        </div>

        {/* Photos Grid */}
        {photos && photos.length > 0 && (
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Photos</h3>
            <div className="grid grid-cols-3 gap-2">
              {photos.slice(0, 6).map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setLightboxPhoto(photo)}
                  className="aspect-square rounded-lg overflow-hidden bg-[#0f1117] border border-[#2a2d3e]"
                >
                  <img
                    src={photo.photo_url}
                    alt={photo.caption || 'Repair photo'}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Parts Status */}
        {parts && parts.length > 0 && (
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Parts</h3>
            <div className="space-y-2">
              {parts.map((part, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{part.part_name}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    part.status === 'received' ? 'bg-emerald-900/30 text-emerald-400' :
                    part.status === 'backordered' ? 'bg-red-900/30 text-red-400' :
                    'bg-blue-900/30 text-blue-400'
                  }`}>
                    {part.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Shop */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <MessageSquare size={16} />
            Message the Shop
          </h3>
          <form onSubmit={sendMessage} className="space-y-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask a question or leave a note..."
              className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#EAB308]"
              rows={3}
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={sendingMessage || !message.trim()}
                className="flex-1 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {sendingMessage ? 'Sending...' : 'Send Message'}
              </button>
              {messageSent && (
                <span className="text-emerald-400 text-sm flex items-center gap-1">
                  <Check size={14} /> Sent!
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Rating (only when closed) */}
        {(ro.status === 'closed' || ro.status === 'delivery') && (
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Star size={16} />
              How was your experience?
            </h3>
            {has_rated || ratingSubmitted ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={24}
                      className={star <= (user_rating || rating) ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600'}
                    />
                  ))}
                </div>
                <span className="text-sm text-emerald-400">Thanks for your feedback!</span>
              </div>
            ) : (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    onClick={() => submitRating(score)}
                    disabled={submittingRating}
                    className="p-2 hover:scale-110 transition-transform"
                  >
                    <Star
                      size={32}
                      className="text-slate-600 hover:text-yellow-400 transition-colors"
                    />
                  </button>
                ))}
              </div>
            )}
            {submittingRating && (
              <p className="text-sm text-slate-500 mt-2">Submitting your rating...</p>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-slate-300"
            onClick={() => setLightboxPhoto(null)}
          >
            <X size={32} />
          </button>
          <img
            src={lightboxPhoto.photo_url}
            alt={lightboxPhoto.caption || 'Photo'}
            className="max-w-full max-h-full object-contain"
          />
          {lightboxPhoto.caption && (
            <div className="absolute bottom-4 left-0 right-0 text-center text-white text-sm">
              {lightboxPhoto.caption}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
