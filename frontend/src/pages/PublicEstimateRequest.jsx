import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, Loader2, ShieldCheck, Wrench, X } from 'lucide-react'
import { Logo, Panel } from '../components/ui'

const DAMAGE_TYPES = ['front impact', 'rear impact', 'side damage', 'hail', 'glass']
const inputClass = 'mt-1 w-full rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

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
  const image = new Image()

  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
    image.src = rawDataUrl
  })

  const maxWidth = 1280
  const scale = image.width > maxWidth ? maxWidth / image.width : 1
  const width = Math.round(image.width * scale)
  const height = Math.round(image.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, width, height)

  let quality = 0.76
  let compressed = canvas.toDataURL('image/jpeg', quality)
  while (compressed.length > 180000 && quality > 0.45) {
    quality -= 0.08
    compressed = canvas.toDataURL('image/jpeg', quality)
  }
  return compressed
}

export default function PublicEstimateRequest() {
  const [params] = useSearchParams()
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
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  async function onPickPhotos(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    const nextFiles = files.slice(0, 5 - photos.length)
    if (!nextFiles.length) return

    try {
      const compressed = await Promise.all(nextFiles.map((file) => compressImage(file)))
      setPhotos((previous) => [...previous, ...compressed].slice(0, 5))
      setError('')
    } catch {
      setError('Failed to process one or more photos. Try different files.')
    } finally {
      event.target.value = ''
    }
  }

  function removePhoto(index) {
    setPhotos((previous) => previous.filter((_, photoIndex) => photoIndex !== index))
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const query = shopId ? `?shop=${encodeURIComponent(shopId)}` : ''
      const response = await fetch(`/api/public/estimate-request${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photos }),
      })
      const responseData = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(responseData?.error || 'Could not submit estimate request')
      setDone(true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-void px-4 py-10 text-ink sm:py-14">
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-center gap-3 border-b border-line pb-5">
            <Logo variant="mark" className="h-10 w-10" />
            <p className="font-display text-lg font-semibold text-ink">Collision estimate request</p>
          </header>
          <Panel className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-good" aria-hidden="true" />
            <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Request submitted</h1>
            <p role="status" className="mt-2 text-sm text-muted">The shop received your request and will contact you within one business day.</p>
          </Panel>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-void px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3 border-b border-line pb-5">
          <Logo variant="mark" className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-brand">
              <ShieldCheck size={15} aria-hidden="true" />
              Public estimate request
            </div>
            <h1 className="mt-1 font-display text-xl font-semibold text-ink sm:text-2xl">Request a collision estimate</h1>
          </div>
        </header>

        <Panel as="form" onSubmit={submit} title="Vehicle and damage details" description="Share the information and photos the shop needs to review your request.">
          <div className="space-y-5 p-4 sm:p-6">
            {error && <p role="alert" className="rounded-instrument border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Full name *
                <input aria-label="Full name" required value={form.name} onChange={(event) => setField('name', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Phone *
                <input aria-label="Phone" required value={form.phone} onChange={(event) => setField('phone', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Email *
                <input aria-label="Email" required type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Vehicle year *
                <input aria-label="Vehicle year" required inputMode="numeric" value={form.year} onChange={(event) => setField('year', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Make *
                <input aria-label="Vehicle make" required value={form.make} onChange={(event) => setField('make', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Model *
                <input aria-label="Vehicle model" required value={form.model} onChange={(event) => setField('model', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted">
                Damage type
                <select aria-label="Damage type" value={form.damage_type} onChange={(event) => setField('damage_type', event.target.value)} className={inputClass}>
                  {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted">
                Preferred drop-off date
                <input aria-label="Preferred drop-off date" type="date" value={form.preferred_date} onChange={(event) => setField('preferred_date', event.target.value)} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-muted sm:col-span-2">
                Damage description *
                <textarea aria-label="Damage description" required rows={4} value={form.description} onChange={(event) => setField('description', event.target.value)} className={`${inputClass} resize-y`} placeholder="Tell us what happened and which areas look damaged" />
              </label>

              <fieldset className="rounded-instrument border border-dashed border-line-2 bg-panel-2 p-4 sm:col-span-2">
                <legend className="px-1 text-xs font-medium text-muted">Damage photos (up to 5)</legend>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-instrument bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit">
                  <Camera size={16} aria-hidden="true" />
                  Add photos
                  <input aria-label="Damage photos" type="file" accept="image/*" multiple onChange={onPickPhotos} className="sr-only" />
                </label>
                <p className="mt-2 font-mono text-xs tabular-nums text-faint">{photos.length}/5 selected</p>

                {photos.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {photos.map((source, index) => (
                      <div key={`${index}-${source.slice(0, 20)}`} className="relative aspect-square overflow-hidden rounded-instrument border border-line-2 bg-void">
                        <img src={source} alt={`Damage ${index + 1}`} className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removePhoto(index)} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full border border-line-2 bg-void/90 text-ink hover:border-crit hover:text-crit" aria-label={`Remove damage photo ${index + 1}`}>
                          <X size={15} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>

            <div className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-muted">
                <Wrench size={15} className="text-brand" aria-hidden="true" />
                REVV auto body estimate intake
              </div>
              <button type="submit" disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-instrument bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:cursor-not-allowed disabled:opacity-50">
                {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {submitting ? 'Submitting...' : 'Submit request'}
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </main>
  )
}
