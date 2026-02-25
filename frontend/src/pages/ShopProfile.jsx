import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Phone, MapPin, Star, Award, Loader2, Calendar, Share2, CheckCircle } from 'lucide-react'
import api from '../lib/api'

export default function ShopProfile() {
  const { shopId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get(`/public/shop/${shopId}`)
        setData(res.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load shop')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shopId])

  const callShop = () => {
    if (data?.shop?.phone) {
      window.location.href = `tel:${data.shop.phone}`
    }
  }

  const bookAppointment = () => {
    navigate('/book')
  }

  const shareProfile = async () => {
    const shareUrl = `${window.location.origin}/shop/${shopId}`
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert('Could not copy link. Please copy the URL from your browser.')
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
          <h2 className="text-lg font-bold text-white mb-2">Shop Not Found</h2>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    )
  }

  const { shop, rating = {}, badges, reviews } = data
  const hasRating = rating?.avg && rating.avg > 0

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Shop Header */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-6">
          <h1 className="text-2xl font-bold text-white mb-2">{shop.name}</h1>
          
          <div className="flex items-center gap-2 text-slate-400 mb-4">
            <MapPin size={16} />
            <span>{shop.address}, {shop.city}, {shop.state} {shop.zip}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={callShop}
              className="flex items-center gap-2 bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Phone size={16} />
              Call
            </button>
            <button
              onClick={bookAppointment}
              className="flex items-center gap-2 bg-[#2a2d3e] hover:bg-[#3a3d4e] text-white font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Calendar size={16} />
              Book Appointment
            </button>
            <button
              onClick={shareProfile}
              className="flex items-center gap-2 bg-indigo-900/30 border border-indigo-700/40 hover:bg-indigo-900/50 text-indigo-300 font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {copied ? <CheckCircle size={16} /> : <Share2 size={16} />}
              {copied ? 'Copied' : 'Share'}
            </button>
          </div>
        </div>

        {/* Rating Section */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-6 text-center">
          {hasRating ? (
            <>
              <div className="flex items-center justify-center gap-2 mb-2">
                <Star className="w-8 h-8 text-yellow-400 fill-yellow-400" />
                <span className="text-5xl font-bold text-white">{rating.avg}</span>
                <span className="text-2xl text-slate-500">/5</span>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                {rating?.count} review{rating?.count !== 1 ? 's' : ''}
              </p>
            </>
          ) : (
            <div className="text-slate-500 mb-4">No ratings yet</div>
          )}

          {/* Badges */}
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {badges.map((badge) => (
                <div
                  key={badge.type}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                    badge.type === 'top_rated'
                      ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40'
                      : 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40'
                  }`}
                >
                  <Award size={14} />
                  {badge.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Labor Rate */}
        {shop.labor_rate && (
          <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Labor Rate</span>
              <span className="text-white font-semibold">${shop.labor_rate}/hr</span>
            </div>
          </div>
        )}

        {/* Reviews */}
        <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Reviews</h2>
          
          {reviews && reviews.length > 0 ? (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="border-b border-[#2a2d3e] pb-4 last:border-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={16}
                          className={star <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600'}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-slate-500">
                      {new Date(review.date).toLocaleDateString()}
                    </span>
                  </div>
                  {review.vehicle && (
                    <p className="text-xs text-slate-500">{review.vehicle}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No reviews yet</p>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={bookAppointment}
          className="w-full bg-[#EAB308] hover:bg-yellow-400 text-[#0f1117] font-bold py-3 rounded-xl transition-colors"
        >
          Book Appointment
        </button>
      </div>
    </div>
  )
}
