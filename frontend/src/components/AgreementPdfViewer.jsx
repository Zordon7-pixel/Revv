import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { agreementButton } from '../lib/agreements'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export default function AgreementPdfViewer({ url }) {
  const [pdf, setPdf] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(true)
  const container = useRef(null)
  const canvas = useRef(null)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width - 2)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    setPdf(null); setPageNumber(1); setError('')
    const task = pdfjs.getDocument({ url, isEvalSupported: false, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/' })
    task.promise.then((document) => { if (active) setPdf(document) }).catch(() => { if (active) setError('The preview could not load. Download the original PDF to review the agreement.') })
    return () => { active = false; task.destroy().catch(() => {}) }
  }, [url])
  useEffect(() => {
    if (container.current) { container.current.scrollTop = 0; container.current.scrollLeft = 0 }
  }, [pageNumber, url])
  useEffect(() => {
    if (!pdf) return
    let active = true; let task
    setRendering(true); setError('')
    pdf.getPage(pageNumber).then(async (page) => {
      if (!active) return
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width * zoom })
      const resolution = Math.min(window.devicePixelRatio || 1, 2)
      const target = canvas.current
      target.width = Math.ceil(viewport.width * resolution); target.height = Math.ceil(viewport.height * resolution)
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`
      task = page.render({ canvasContext: target.getContext('2d'), viewport, transform: [resolution, 0, 0, resolution, 0, 0] })
      await task.promise
      const content = await page.getTextContent()
      if (active) { setText(content.items.map((item) => item.str || '').join(' ')); setRendering(false) }
    }).catch((err) => { if (active && err.name !== 'RenderingCancelledException') { setError('This page could not be displayed. Download the original PDF to review it.'); setRendering(false) } })
    return () => { active = false; task?.cancel() }
  }, [pdf, pageNumber, zoom, width])
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={agreementButton} disabled={!pdf || pageNumber === 1} onClick={() => setPageNumber((n) => n - 1)}>Previous page</button>
      <span className="text-xs text-muted">Page {pageNumber} of {pdf?.numPages || '…'}</span>
      <button type="button" className={agreementButton} disabled={!pdf || pageNumber === pdf.numPages} onClick={() => setPageNumber((n) => n + 1)}>Next page</button>
      <label className="text-xs text-muted">Zoom <select aria-label="Agreement zoom" className="rounded border border-line bg-void p-1 text-ink" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value="1">Fit width</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
    </div>
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {rendering && !error && <p role="status" className="text-xs text-muted">Rendering agreement page…</p>}
    <div ref={container} className="max-h-[65vh] w-full overflow-auto rounded-lg border border-line bg-white" role="region" aria-label="Agreement document preview">
      <canvas ref={canvas} aria-label={`Agreement page ${pageNumber}`} />
    </div>
    <p className="sr-only">{text}</p>
  </div>
}
