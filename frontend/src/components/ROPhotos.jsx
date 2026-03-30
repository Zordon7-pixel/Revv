import { useState, useEffect, useRef } from 'react'
import { Camera, Trash2, ZoomIn, Upload, X, Sparkles } from 'lucide-react'
import api from '../lib/api'
import { optimizeImageForUpload } from '../lib/imageUpload'

const PHOTO_TYPE_META = {
  damage:   { label: 'Damage',   cls: 'text-red-400 bg-red-900/30 border-red-700/40' },
  progress: { label: 'Progress', cls: 'text-blue-400 bg-blue-900/30 border-blue-700/40' },
  complete: { label: 'Complete', cls: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' },
}

const SEVERITY_META = {
  minor:    { label: 'Minor',    cls: 'text-yellow-400 bg-yellow-900/30 border-yellow-600/40' },
  moderate: { label: 'Moderate', cls: 'text-orange-400 bg-orange-900/30 border-orange-600/40' },
  severe:   { label: 'Severe',   cls: 'text-red-300 bg-red-800/40 border-red-500/50' },
}

export default function ROPhotos({ roId, isAdmin }) {
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [analyzingMsg, setAnalyzingMsg] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [caption, setCaption] = useState('')
  const [photoType, setPhotoType] = useState('damage')
  const [isDragActive, setIsDragActive] = useState(false)
  const fileRef = useRef(null)
  const dropZoneRef = useRef(null)

  const load = () =>
    api.get(`/photos/${roId}`).then(r => setPhotos(r.data.photos || [])).catch(err => console.error('[ROPhotos] Failed to load photos:', err.message))

  useEffect(() => { load() }, [roId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setAnalyzingMsg('Optimizing photo…')
    try {
      const preparedFile = await optimizeImageForUpload(file, {
        maxDimension: 2048,
        targetBytes: 3 * 1024 * 1024,
      })
      setAnalyzingMsg(photoType === 'damage' ? 'Analyzing damage…' : 'Uploading…')
      const fd = new FormData()
      fd.append('photo', preparedFile)
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
      setAnalyzingMsg('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function deletePhoto(photoId) {
    if (!confirm('Delete this photo?')) return
    try {
      await api.delete(`/photos/${photoId}`)
      load()
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to delete photo')
    }
  }

  function handleDragEnter(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    if (e.target === dropZoneRef.current) {
      setIsDragActive(false)
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    
    // Process each dropped file
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not an image`)
        continue
      }
      
      setUploading(true)
      setAnalyzingMsg('Optimizing photo…')
      try {
        const preparedFile = await optimizeImageForUpload(file, {
          maxDimension: 2048,
          targetBytes: 3 * 1024 * 1024,
        })
        setAnalyzingMsg(photoType === 'damage' ? 'Analyzing damage…' : 'Uploading…')
        const fd = new FormData()
        fd.append('photo', preparedFile)
        fd.append('caption', caption)
        fd.append('photo_type', photoType)
        await api.post(`/photos/${roId}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } catch (err) {
        alert(err?.response?.data?.error || `Upload of ${file.name} failed`)
      } finally {
        setUploading(false)
        setAnalyzingMsg('')
      }
    }
    setCaption('')
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
            {uploading
              ? <><Sparkles size={12} className="animate-pulse" /> {analyzingMsg}</>
              : <><Upload size={12} /> Upload</>
            }
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

      {/* Damage AI hint */}
      {photoType === 'damage' && !uploading && (
        <p className="text-[10px] text-indigo-400/70 flex items-center gap-1 mb-3">
          <Sparkles size={10} /> AI will auto-analyze damage severity and zones
        </p>
      )}

      {photos.length === 0 ? (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center py-10 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragActive
              ? 'border-indigo-500 bg-indigo-900/20'
              : 'border-[#2a2d3e] hover:border-indigo-600/50'
          }`}
        >
          <Camera size={28} className={`mb-2 ${isDragActive ? 'text-indigo-400' : 'text-slate-600'}`} />
          <p className={`text-sm ${isDragActive ? 'text-indigo-400' : 'text-slate-500'}`}>
            {isDragActive ? 'Drop photos here' : 'No photos yet'}
          </p>
          <p className="text-slate-600 text-xs">Drag & drop or click upload button</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(photo => {
            const meta = PHOTO_TYPE_META[photo.photo_type] || PHOTO_TYPE_META.damage
            const sevMeta = photo.ai_severity ? SEVERITY_META[photo.ai_severity] : null
            const zones = Array.isArray(photo.ai_zones)
              ? photo.ai_zones
              : photo.ai_zones
                ? (() => { try { return JSON.parse(photo.ai_zones) } catch { return [] } })()
                : []
            const displayCaption = photo.caption || photo.ai_description || null

            return (
              <div
                key={photo.id}
                role="button"
                tabIndex={0}
                onClick={() => setLightbox(photo)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLightbox(photo)
                  }
                }}
                className="relative group rounded-xl overflow-hidden border border-[#2a2d3e] aspect-video bg-[#0f1117] cursor-zoom-in"
              >
                <img
                  src={photo.photo_url}
                  alt={displayCaption || 'Photo'}
                  className="w-full h-full object-cover"
                />

                {/* AI assessed badge — top right */}
                {photo.ai_severity && (
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-indigo-900/80 border border-indigo-700/50 rounded-full px-1.5 py-0.5">
                    <Sparkles size={8} className="text-indigo-300" />
                    <span className="text-[8px] text-indigo-300 font-semibold">AI</span>
                  </div>
                )}

                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLightbox(photo)
                    }}
                    className="p-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                  >
                    <ZoomIn size={14} className="text-white" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deletePhoto(photo.id)
                      }}
                      className="p-1.5 bg-red-600/80 rounded-lg hover:bg-red-500 transition-colors"
                    >
                      <Trash2 size={14} className="text-white" />
                    </button>
                  )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80">
                  <div className="flex flex-wrap items-center gap-1 mb-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {sevMeta && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${sevMeta.cls}`}>
                        {sevMeta.label}
                      </span>
                    )}
                  </div>
                  {zones.length > 0 && (
                    <p className="text-[9px] text-slate-400 truncate">
                      {zones.join(', ')}
                    </p>
                  )}
                  {displayCaption && (
                    <p className="text-[10px] text-slate-300 truncate mt-0.5">{displayCaption}</p>
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
              alt={lightbox.caption || lightbox.ai_description || 'Photo'}
              className="max-h-[85vh] max-w-full object-contain rounded-xl"
            />
            {/* AI assessment detail in lightbox */}
            {lightbox.ai_severity && (
              <div className="mt-3 bg-[#1a1d2e]/90 rounded-xl border border-[#2a2d3e] p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles size={11} className="text-indigo-400" />
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">AI Assessment</span>
                  {SEVERITY_META[lightbox.ai_severity] && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${SEVERITY_META[lightbox.ai_severity].cls}`}>
                      {SEVERITY_META[lightbox.ai_severity].label}
                    </span>
                  )}
                </div>
                {(() => {
                  const z = Array.isArray(lightbox.ai_zones)
                    ? lightbox.ai_zones
                    : lightbox.ai_zones
                      ? (() => { try { return JSON.parse(lightbox.ai_zones) } catch { return [] } })()
                      : []
                  return z.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {z.map((zone, i) => (
                        <span key={i} className="text-[9px] bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded-full">{zone}</span>
                      ))}
                    </div>
                  ) : null
                })()}
                {lightbox.ai_description && (
                  <p className="text-slate-300 text-xs">{lightbox.ai_description}</p>
                )}
              </div>
            )}
            {!lightbox.ai_severity && (lightbox.caption || lightbox.ai_description) && (
              <p className="text-center text-slate-300 text-sm mt-2">
                {lightbox.caption || lightbox.ai_description}
              </p>
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
