import { useState, useEffect, useRef } from 'react'
import { Camera, Trash2, ZoomIn, Upload, X } from 'lucide-react'
import api from '../lib/api'

const PHOTO_TYPE_META = {
  damage:   { label: 'Damage',   cls: 'text-red-400 bg-red-900/30 border-red-700/40' },
  progress: { label: 'Progress', cls: 'text-blue-400 bg-blue-900/30 border-blue-700/40' },
  complete: { label: 'Complete', cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' },
}

export default function ROPhotos({ roId, isAdmin }) {
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [caption, setCaption] = useState('')
  const [photoType, setPhotoType] = useState('damage')
  const fileRef = useRef(null)

  const load = () =>
    api.get(`/photos/${roId}`).then(r => setPhotos(r.data.photos || []))

  useEffect(() => { load() }, [roId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      fd.append('caption', caption)
      fd.append('photo_type', photoType)
      await api.post(`/photos/${roId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setCaption('')
      load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function deletePhoto(photoId) {
    if (!confirm('Delete this photo?')) return
    await api.delete(`/photos/${photoId}`)
    load()
  }

  const inp = 'bg-[#0f1117] border border-[#2a2d3e] rounded-lg text-xs text-slate-300 px-2 py-1.5 focus:outline-none focus:border-indigo-500'

  return (
    <div className="bg-[#1a1d2e] rounded-xl border border-[#2a2d3e] p-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
          <Camera size={12} /> Photos
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={photoType}
            onChange={e => setPhotoType(e.target.value)}
            className={inp}
          >
            <option value="damage">Damage</option>
            <option value="progress">Progress</option>
            <option value="complete">Complete</option>
          </select>
          <input
            type="text"
            placeholder="Caption (optional)"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            className={`${inp} w-36`}
          />
          <label
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
              uploading
                ? 'bg-indigo-800 text-indigo-300 opacity-50 pointer-events-none'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            <Upload size={12} /> {uploading ? 'Uploading...' : 'Upload'}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 border border-dashed border-[#2a2d3e] rounded-xl">
          <Camera size={28} className="text-slate-600 mb-2" />
          <p className="text-slate-500 text-sm">No photos yet</p>
          <p className="text-slate-600 text-xs">Upload damage, progress, or completion photos</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(photo => {
            const meta = PHOTO_TYPE_META[photo.photo_type] || PHOTO_TYPE_META.damage
            return (
              <div
                key={photo.id}
                className="relative group rounded-xl overflow-hidden border border-[#2a2d3e] aspect-video bg-[#0f1117]"
              >
                <img
                  src={photo.photo_url}
                  alt={photo.caption || 'Photo'}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => setLightbox(photo)}
                    className="p-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                  >
                    <ZoomIn size={14} className="text-white" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => deletePhoto(photo.id)}
                      className="p-1.5 bg-red-600/80 rounded-lg hover:bg-red-500 transition-colors"
                    >
                      <Trash2 size={14} className="text-white" />
                    </button>
                  )}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${meta.cls}`}>
                    {meta.label}
                  </span>
                  {photo.caption && (
                    <p className="text-[10px] text-slate-300 truncate mt-0.5">{photo.caption}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-4xl max-h-full"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={lightbox.photo_url}
              alt={lightbox.caption || 'Photo'}
              className="max-h-[85vh] max-w-full object-contain rounded-xl"
            />
            {lightbox.caption && (
              <p className="text-center text-slate-300 text-sm mt-2">{lightbox.caption}</p>
            )}
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 bg-slate-700 hover:bg-slate-600 rounded-full p-1 transition-colors"
            >
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
