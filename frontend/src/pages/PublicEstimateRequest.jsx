import { useMemo, useState } from 'react'
import { Camera, CheckCircle2, Loader2, ShieldCheck, Wrench } from 'lucide-react'

const DAMAGE_TYPES = ['front impact', 'rear impact', 'side damage', 'hail', 'glass']

const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none'

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function compressImage(file) {
  const rawDataUrl = await fileToDataUrl(file)
  const img = new Image()

  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = rawDataUrl
  })

  const maxWidth = 1280
  const scale = img.width > maxWidth ? maxWidth / img.width : 1
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)

  let quality = 0.76
  let compressed = canvas.toDataURL('image/jpeg', quality)
  while (compressed.length > 180000 && quality > 0.45) {
    quality -= 0.08
    compressed = canvas.toDataURL('image/jpeg', quality)
  }

  return compressed
}

export default function PublicEstimateRequest() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const shopId = params.get('shop') || ''

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    year: '',
    make: '',
    model: '',
    damage_type: DAMAGE_TYPES[0],
    description: '',
    preferred_date: '',
  })

  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onPickPhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const availableSlots = 5 - photos.length
    const nextFiles = files.slice(0, availableSlots)
    if (!nextFiles.length) return

    try {
      const compressed = await Promise.all(nextFiles.map((file) => compressImage(file)))
      setPhotos((prev) => [...prev, ...compressed].slice(0, 5))
      setError('')
    } catch {
      setError('Failed to process one or more photos. Try different files.')
    } finally {
      e.target.value = ''
    }
  }

  function removePhoto(index) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const query = shopId ? `?shop=${encodeURIComponent(shopId)}` : ''
      const res = await fetch(`/api/public/estimate-request${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photos }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not submit estimate request')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 px-4 py-14 text-slate-100">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center shadow-2xl shadow-blue-900/20">
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-blue-400" />
          <h1 className="text-2xl font-semibold text-white">Request submitted</h1>
          <p className="mt-3 text-slate-300">We got your request! We&apos;ll be in touch within 1 business day.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 p-6 shadow-xl shadow-blue-900/20">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-600/40 bg-blue-900/20 px-3 py-1 text-xs font-medium text-blue-200">
            <ShieldCheck size={14} />
            Public Estimate Request
          </div>
          <h1 className="text-2xl font-semibold text-white">Request a Collision Estimate</h1>
          <p className="mt-2 text-sm text-slate-400">Share your vehicle details and damage photos. REVV shop staff will review and contact you.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-700 bg-slate-800 p-5 md:p-6">
          {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-sm text-red-200">{error}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Full Name</label>
              <input required value={form.name} onChange={(e) => setField('name', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Phone</label>
              <input required value={form.phone} onChange={(e) => setField('phone', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Email</label>
              <input required type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Vehicle Year</label>
              <input required value={form.year} onChange={(e) => setField('year', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Make</label>
              <input required value={form.make} onChange={(e) => setField('make', e.target.value)} className={inputClass} />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Model</label>
              <input required value={form.model} onChange={(e) => setField('model', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Damage Type</label>
              <select value={form.damage_type} onChange={(e) => setField('damage_type', e.target.value)} className={inputClass}>
                {DAMAGE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Preferred Drop-off Date</label>
              <input type="date" value={form.preferred_date} onChange={(e) => setField('preferred_date', e.target.value)} className={inputClass} />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Damage Description</label>
              <textarea
                required
                rows={4}
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                className={inputClass}
                placeholder="Tell us what happened and which areas look damaged"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-slate-400">Damage Photos (up to 5)</label>
              <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/60 p-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
                  <Camera size={15} />
                  Upload Photos
                  <input type="file" accept="image/*" multiple onChange={onPickPhotos} className="hidden" />
                </label>
                <p className="mt-2 text-xs text-slate-500">{photos.length}/5 selected</p>

                {photos.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                    {photos.map((src, index) => (
                      <button
                        key={`${index}-${src.slice(0, 20)}`}
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="group relative overflow-hidden rounded-md border border-slate-600"
                        title="Remove photo"
                      >
                        <img src={src} alt={`Damage ${index + 1}`} className="h-24 w-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 bg-slate-950/80 px-1 py-0.5 text-[10px] text-slate-200 opacity-0 transition-opacity group-hover:opacity-100">
                          Remove
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-700 pt-5">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Wrench size={14} className="text-blue-400" />
              REVV auto body estimate intake
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
