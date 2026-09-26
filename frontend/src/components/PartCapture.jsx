import { useEffect, useRef, useState } from 'react'
import { Camera, Search, X } from 'lucide-react'
import api from '../lib/api'
import AppOverlay from './AppOverlay'

const normalizeNumber = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const inputClass = 'mt-1 w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink'
const errorMessage = (err) => err?.response?.data?.error || err?.message || 'Could not read this part. Please try again.'

export async function prepareLabelPhoto(file) {
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('Choose a photo under 20MB.')
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob || blob.size > 4 * 1024 * 1024) throw new Error('Photo is too large. Try a closer crop of the part number.')
    return blob
  } finally { bitmap.close() }
}

export default function PartCapture({ onClose, onCreate, onUseStock, preparePhoto = prepareLabelPhoto }) {
  const [number, setNumber] = useState(''), [brand, setBrand] = useState('')
  const [label, setLabel] = useState(null), [preview, setPreview] = useState('')
  const [results, setResults] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const request = useRef(null), generation = useRef(0), previewRef = useRef('')
  useEffect(() => () => { generation.current++; request.current?.abort(); if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])
  function resetLookup() { generation.current++; request.current?.abort(); setResults(null); setError(''); setBusy('') }
  async function readPhoto(file) {
    resetLookup(); const current = generation.current; setLabel(null); setNumber(''); setBrand(''); setBusy('Reading label…')
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = ''; setPreview('')
    try {
      const photo = await preparePhoto(file)
      if (current !== generation.current) return
      previewRef.current = URL.createObjectURL(photo); setPreview(previewRef.current)
      const body = new FormData(); body.append('photo', photo, 'part-label.jpg')
      request.current = new AbortController()
      const { data } = await api.post('/part-capture/extract', body, { signal: request.current.signal })
      if (current !== generation.current) return
      setLabel(data); setNumber(data.candidates?.[0]?.part_number || ''); setBrand(data.candidates?.[0]?.brand || '')
      if (!data.candidates?.length) setError('No readable part number found. Enter it below or take a closer photo.')
    } catch (err) { if (current === generation.current) setError(errorMessage(err)) }
    finally { if (current === generation.current) setBusy('') }
  }
  async function search(event) {
    event.preventDefault(); resetLookup(); const current = generation.current; setBusy('Checking shop stock…')
    request.current = new AbortController()
    const params = { part_number: number.trim(), brand: brand.trim() }
    try {
      const { data } = await api.get('/part-capture/lookup', { params, signal: request.current.signal })
      if (current !== generation.current) return
      setResults(data); setBusy('Finding external details…')
      const response = await api.get('/part-capture/lookup', { params: { ...params, external: true }, signal: request.current.signal })
      if (current === generation.current) setResults(response.data)
    } catch (err) { if (current === generation.current) setError(errorMessage(err)) }
    finally { if (current === generation.current) setBusy('') }
  }
  const hasStockCollision = results?.stock.some((item) => item.brand_match !== 'different')
  function create(candidate) {
    const observed = label?.candidates?.find((c) => c.part_number === number)
    onCreate({ part_number: candidate?.part_number || number.trim(), name: candidate?.description || observed?.description || '', brand: candidate?.brand || brand.trim(),
      source_details: { source: candidate?.source || (label ? 'Photo label — staff confirmed' : 'Manual entry'), source_url: candidate?.source_url || '', raw_text: label?.raw_text || '', description: candidate?.description || observed?.description || '', part_number: candidate?.part_number || number, brand: candidate?.brand || brand } })
  }
  return <AppOverlay label="Find a part from a photo" onClose={onClose} className="bg-void/75 p-3 sm:p-6">
    <section className="sheet-modal-card w-full max-w-3xl rounded-instrument border border-line-2 bg-panel">
      <div className="sheet-modal-header flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-xs text-brand">PHOTO → DETAILS → SHOP STOCK</p><h2 className="font-display text-xl font-semibold text-ink">Find a part</h2></div><button type="button" onClick={onClose} aria-label="Close part lookup" className="p-2 text-muted"><X size={20} /></button></div>
      <div className="sheet-modal-body space-y-5 p-5">
        <div className="rounded-lg border border-dashed border-line-2 p-4">
          <label className="block text-sm font-medium text-ink"><Camera size={18} className="mb-2 text-brand" />Take or choose a label photo<input aria-label="Part label photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="mt-3 block w-full text-sm text-muted" onChange={(e) => { const file = e.target.files?.[0]; if (file) readPhoto(file); e.target.value = '' }} /></label>
          <p className="mt-2 text-xs text-muted">Include the printed part number and brand. Photo reading uses REVV’s image provider. You can also type the number below.</p>
          {preview && <img src={preview} alt="Part label being reviewed" className="mt-3 max-h-40 rounded-lg object-contain" />}
        </div>
        {error && <p role="alert" className="text-sm text-crit">{error}</p>}
        {label?.candidates?.length > 1 && <div><p className="text-sm text-muted">Several numbers were found. Choose the part number:</p><div className="mt-2 flex flex-wrap gap-2">{label.candidates.map((c, index) => <button type="button" className="revv-btn revv-btn-secondary" key={`${c.part_number}-${index}`} onClick={() => { resetLookup(); setNumber(c.part_number); setBrand(c.brand || '') }}>{c.part_number}</button>)}</div></div>}
        {label && <details className="text-xs text-muted"><summary>View text read from label</summary><p className="mt-2 whitespace-pre-wrap break-words">{label.raw_text}</p></details>}
        <form onSubmit={search} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-muted">Part number<input required maxLength={120} className={inputClass} value={number} onChange={(e) => { resetLookup(); setNumber(e.target.value) }} /></label><label className="text-sm text-muted">Brand (if known)<input maxLength={100} className={inputClass} value={brand} onChange={(e) => { resetLookup(); setBrand(e.target.value) }} /></label></div>
          <p className="text-xs text-muted">Check every character, especially O/0 and I/1. The photo suggests details; it does not confirm compatibility.</p>
          <button type="submit" disabled={!!busy || !number.trim()} className="revv-btn revv-btn-primary"><Search size={16} />Find matching parts</button>
        </form>
        {busy && <p role="status" className="text-sm text-brand">{busy}</p>}
        {results && <div className="space-y-4">
          <div><h3 className="font-semibold text-ink">Your shop’s stock</h3>{results.stock.length === 0 ? <p className="mt-2 text-sm text-muted">No saved stock matches this number.</p> : results.stock.map((item) => <article key={item.id} className="mt-2 rounded-lg border border-good/40 bg-good/5 p-4"><p className="font-medium text-ink">{item.name}</p><p className="mt-1 font-mono text-sm text-brand">{item.part_number}{item.brand ? ` · ${item.brand}` : ''}</p><p className="mt-2 text-sm text-ink">{item.qty_on_hand} on hand · {item.location || 'No bin recorded'}</p><p className="mt-1 text-xs text-muted">Shop inventory record · Confirm the physical part before use.</p>{item.brand_match === 'different' && <p className="mt-2 text-sm text-crit">The saved brand differs. Check the part before using this stock.</p>}<button type="button" onClick={() => onUseStock(item)} className="revv-btn revv-btn-secondary mt-3">Review existing stock</button></article>)}</div>
          <div><h3 className="font-semibold text-ink">External part details</h3>{results.catalog.message && <p className="mt-2 text-sm text-muted">{results.catalog.message}</p>}
            {results.catalog.status === 'available' && !results.catalog.candidates.length && <p className="mt-2 text-sm text-muted">No external matches found. You can enter the details yourself.</p>}
            {results.catalog.candidates.map((part) => <article key={part.id} className="mt-3 rounded-lg border border-line p-4"><div className="flex gap-3">{part.image_url && <img src={part.image_url} referrerPolicy="no-referrer" alt="Listing part" className="h-20 w-20 rounded-lg object-contain" />}<div className="min-w-0"><p className="break-words font-medium text-ink">{part.description}</p><p className="mt-1 text-sm text-muted">{part.brand || 'Brand not provided'} · {part.part_number || 'Part number not supplied'}</p><p className="mt-1 text-xs text-brand">{part.match === 'exact_number' ? 'Matching part number — confirm compatibility' : 'Possible match — check the listing'}</p></div></div>
              <p className="mt-2 text-xs text-muted">{part.condition || 'Condition not provided'}{part.price ? ` · Listed at ${part.price} ${part.currency}` : ''}</p>
              <a href={part.source_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-brand">View source: {part.source}</a>
              {part.specifications?.length > 0 && <details className="mt-3 text-sm text-muted"><summary>Listing specifications</summary><dl className="mt-2 space-y-2">{part.specifications.map((s, i) => <div key={i}><dt className="font-medium text-ink">{s.name}</dt><dd className="break-words">{s.value}</dd></div>)}</dl></details>}
              {part.part_number && (normalizeNumber(part.part_number) !== normalizeNumber(number) || (part.brand && normalizeNumber(part.brand) !== normalizeNumber(brand))) ? <button type="button" className="revv-btn revv-btn-secondary mt-3" onClick={() => { resetLookup(); setNumber(part.part_number); setBrand(part.brand || ''); }}>Check this part’s stock first</button> : !hasStockCollision && part.part_number && <button type="button" className="revv-btn revv-btn-secondary mt-3" onClick={() => create(part)}>Review details for new stock</button>}
            </article>)}
          </div>
          {!hasStockCollision && <button type="button" onClick={() => create(null)} className="revv-btn revv-btn-secondary">Enter new stock details</button>}
          <p className="text-xs text-muted">Nothing is added until you review the item and save its quantity and location.</p>
        </div>}
      </div>
    </section>
  </AppOverlay>
}
