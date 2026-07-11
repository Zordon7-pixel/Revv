import { useState, useEffect, useRef } from 'react'
import { Camera, Trash2, ZoomIn, Upload, Sparkles } from 'lucide-react'
import api from '../lib/api'
import { optimizeImageForUpload } from '../lib/imageUpload'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'
import { safeExternalErrorMessage } from '../lib/safeErrors'
import PhotoLightbox from './PhotoLightbox'

const PHOTO_TYPE_META = {
  damage:   { label: 'Damage',   cls: 'border-crit/40 bg-crit/10 text-crit' },
  progress: { label: 'Progress', cls: 'border-brand/40 bg-brand/10 text-brand' },
  complete: { label: 'Complete', cls: 'border-good/40 bg-good/10 text-good' },
}

const SEVERITY_META = {
  minor:    { label: 'Minor',    cls: 'border-good/40 bg-good/10 text-good' },
  moderate: { label: 'Moderate', cls: 'border-brand/40 bg-brand/10 text-brand' },
  severe:   { label: 'Severe',   cls: 'border-crit/40 bg-crit/10 text-crit' },
}

export default function ROPhotos({ roId, isAdmin, canDelete = isAdmin }) {
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [analyzingMsg, setAnalyzingMsg] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [failedPhotoIds, setFailedPhotoIds] = useState({})
  const [caption, setCaption] = useState('')
  const [photoType, setPhotoType] = useState('damage')
  const [isDragActive, setIsDragActive] = useState(false)
  const [photoLoadError, setPhotoLoadError] = useState('')
  const [photoUploadError, setPhotoUploadError] = useState('')
  const fileRef = useRef(null)
  const dropZoneRef = useRef(null)

  const load = async () => {
    setFailedPhotoIds({})
    try {
      const r = await api.get(`/photos/${roId}`)
      setPhotos(r.data.photos || [])
      setPhotoLoadError('')
    } catch (err) {
      setPhotoLoadError(safeExternalErrorMessage(err, 'Failed to load photos'))
      console.error('[ROPhotos] Failed to load photos:', err.message)
    }
  }

  useEffect(() => { load() }, [roId])

  async function uploadPhotoFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    setUploading(true)
    setPhotoUploadError('')
    let uploadedCount = 0
    const failures = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      if (!String(file.type || '').startsWith('image/')) {
        failures.push({ file, message: 'File is not an image.' })
        continue
      }

      try {
        setAnalyzingMsg(`Optimizing ${index + 1} of ${files.length}…`)
        const preparedFile = await optimizeImageForUpload(file, {
          maxDimension: 2048,
          targetBytes: 3 * 1024 * 1024,
        })
        setAnalyzingMsg(photoType === 'damage'
          ? `Analyzing ${index + 1} of ${files.length}…`
          : `Uploading ${index + 1} of ${files.length}…`)
        const fd = new FormData()
        fd.append('photo', preparedFile)
        fd.append('caption', caption)
        fd.append('photo_type', photoType)
        await api.post(`/photos/${roId}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        uploadedCount += 1
      } catch (err) {
        failures.push({
          file,
          message: safeExternalErrorMessage(err, 'Upload failed'),
        })
      }
    }

    if (uploadedCount > 0) {
      setCaption('')
      await load()
    }
    if (failures.length > 0) {
      const firstFailure = failures[0]
      setPhotoUploadError(
        `${failures.length} of ${files.length} photos could not be uploaded. ${firstFailure.file.name}: ${firstFailure.message}`
      )
    }

    setUploading(false)
    setAnalyzingMsg('')
  }

  async function handleUpload(e) {
    const input = e.currentTarget
    await uploadPhotoFiles(input.files)
    input.value = ''
  }

  async function deletePhoto(photoId) {
    if (!confirm('Delete this photo?')) return
    try {
      setPhotoUploadError('')
      await api.delete(`/photos/${photoId}`)
      setPhotos((current) => current.filter((photo) => photo.id !== photoId))
      setLightbox((current) => current?.id === photoId ? null : current)
      load()
    } catch (err) {
      console.error('[ROPhotos] Photo delete failed')
      setLightbox((current) => current?.id === photoId ? null : current)
      setPhotoUploadError(safeExternalErrorMessage(err, 'Failed to delete photo'))
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
    await uploadPhotoFiles(files)
  }

  const inp = 'rounded-lg border border-line-2 bg-void px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

  return (
    <div className="rounded-instrument border border-line-2 bg-panel p-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          <Camera size={12} /> Photos
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={photoType}
            onChange={e => setPhotoType(e.target.value)}
            aria-label="Photo type"
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
            aria-label="Photo caption"
            className={`${inp} w-36`}
          />
          <label
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
              uploading
                ? 'pointer-events-none bg-brand/40 text-white opacity-50'
                : 'bg-brand text-white hover:bg-brand-lit'
            }`}
          >
            {uploading
              ? <><Sparkles size={12} className="animate-pulse" /> {analyzingMsg}</>
              : <><Upload size={12} /> Upload Photos</>
            }
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              aria-label="RO photos"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Damage AI hint */}
      {photoType === 'damage' && !uploading && (
        <p className="mb-3 flex items-center gap-1 text-[10px] text-brand">
          <Sparkles size={10} /> AI will auto-analyze damage severity and zones
        </p>
      )}

      {photoLoadError && (
        <div role="alert" className="mb-3 rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
          {photoLoadError}
        </div>
      )}

      {photoUploadError && (
        <div role="alert" className="mb-3 rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
          {photoUploadError}
        </div>
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
              ? 'border-brand bg-brand/10'
              : 'border-line-2 hover:border-brand/50'
          }`}
        >
          <Camera size={28} className={`mb-2 ${isDragActive ? 'text-brand' : 'text-faint'}`} />
          <p className={`text-sm ${isDragActive ? 'text-brand' : 'text-faint'}`}>
            {isDragActive ? 'Drop photos here' : 'No photos yet'}
          </p>
          <p className="text-xs text-faint">Drag & drop or click upload button</p>
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
            const photoUrl = resolveUploadedMediaUrl(photo.photo_url)
            const photoFailed = !!failedPhotoIds[photo.id]

            return (
              <div
                key={photo.id}
                role="button"
                tabIndex={0}
                aria-label={`View ${displayCaption || 'photo'}`}
                onClick={() => setLightbox(photo)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLightbox(photo)
                  }
                }}
                className="group relative aspect-video cursor-zoom-in overflow-hidden rounded-instrument border border-line-2 bg-void"
              >
                {photoUrl && !photoFailed ? (
                  <img
                    src={photoUrl}
                    alt={displayCaption || 'Photo'}
                    className="w-full h-full object-cover"
                    onError={() => setFailedPhotoIds((prev) => ({ ...prev, [photo.id]: true }))}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-faint">
                    <Camera size={22} className="text-faint" />
                    <span className="text-xs font-medium">Photo unavailable</span>
                  </div>
                )}

                {/* AI assessed badge — top right */}
                {photo.ai_severity && (
                  <div className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full border border-brand/40 bg-panel/90 px-1.5 py-0.5">
                    <Sparkles size={8} className="text-brand" />
                    <span className="text-[8px] font-semibold text-brand">AI</span>
                  </div>
                )}

                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deletePhoto(photo.id)
                    }}
                    className="absolute right-1.5 top-1.5 z-20 rounded-md border border-crit/40 bg-black/75 p-1.5 text-crit transition-colors hover:bg-crit/15"
                    aria-label={`Delete ${displayCaption || 'photo'}`}
                    title="Delete photo"
                  >
                    <Trash2 size={14} />
                  </button>
                )}

                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center z-10 pointer-events-none">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setLightbox(photo)
                    }}
                    className="pointer-events-auto p-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                    aria-label={`Open ${displayCaption || 'photo'} full size`}
                  >
                    <ZoomIn size={14} className="text-white" />
                  </button>
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2">
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
                    <p className="truncate text-[9px] text-white/70">
                      {zones.join(', ')}
                    </p>
                  )}
                  {displayCaption && (
                    <p className="mt-0.5 truncate text-[10px] text-white/90">{displayCaption}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {lightbox && (
        <PhotoLightbox
          src={resolveUploadedMediaUrl(lightbox.photo_url)}
          alt={lightbox.caption || lightbox.ai_description || 'Photo'}
          title={lightbox.caption || lightbox.ai_description || 'RO photo'}
          unavailable={!!failedPhotoIds[lightbox.id]}
          onError={() => setFailedPhotoIds((prev) => ({ ...prev, [lightbox.id]: true }))}
          onClose={() => setLightbox(null)}
          onDelete={canDelete ? () => deletePhoto(lightbox.id) : undefined}
          footer={(lightbox.ai_severity || lightbox.caption || lightbox.ai_description) ? (
            <div>
              {lightbox.ai_severity && (
                <>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles size={11} className="text-brand" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-brand">AI Assessment</span>
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
                          <span key={i} className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] text-muted">{zone}</span>
                        ))}
                      </div>
                    ) : null
                  })()}
                  {lightbox.ai_description && (
                    <p className="text-xs text-muted">{lightbox.ai_description}</p>
                  )}
                </>
              )}
              {!lightbox.ai_severity && (lightbox.caption || lightbox.ai_description) && (
                <p className="text-center text-sm text-muted">
                  {lightbox.caption || lightbox.ai_description}
                </p>
              )}
            </div>
          ) : null}
        />
      )}
    </div>
  )
}
