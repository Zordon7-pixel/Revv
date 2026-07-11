import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Printer, Mail, Download } from 'lucide-react'
import api from '../lib/api'

export default function Invoice() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState('status')

  useEffect(() => {
    api.get(`/ros/${id}/invoice`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not load invoice. Make sure you are signed in.'))
  }, [id])

  if (error) return (
    <div className="min-h-screen bg-void p-8 text-ink">
      <p role="alert" className="rounded-instrument border border-crit/40 bg-crit/10 px-4 py-3 text-sm text-crit">{error}</p>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-void p-8 text-muted">
      <p role="status">Loading invoice...</p>
    </div>
  )

  const { shop, customer, vehicle, parts, labor_cost, parts_cost, sublet_cost, tax, total, ro_number, intake_date, actual_delivery, payment_type, claim_number, insurer, notes } = data

  const subtotal = parseFloat(parts_cost || 0) + parseFloat(labor_cost || 0) + parseFloat(sublet_cost || 0)
  const taxAmt = parseFloat(tax || 0)
  const totalAmt = parseFloat(total || 0)

  const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  async function emailInvoice() {
    setEmailing(true)
    setNotice('')
    setNoticeType('status')
    try {
      const { data: res } = await api.post(`/ros/${id}/email-invoice`)
      if (res?.skipped) {
        setNotice('Email skipped: email service is not configured.')
        setNoticeType('error')
      } else {
        setNotice('Invoice emailed to customer.')
      }
    } catch (e) {
      setNotice(e?.response?.data?.error || 'Could not send invoice email.')
      setNoticeType('error')
    } finally {
      setEmailing(false)
    }
  }

  async function downloadPdf() {
    setDownloading(true)
    setNotice('')
    setNoticeType('status')
    try {
      const response = await api.get(`/invoice/${id}`, { responseType: 'blob' })
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `invoice-${ro_number || id}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (e) {
      setNotice(e?.response?.data?.error || 'Could not download invoice PDF.')
      setNoticeType('error')
    } finally {
      setDownloading(false)
    }
  }

  const moneyClass = 'font-mono tabular-nums'
  const sectionLabelClass = 'mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-black/50'
  const tableHeadingClass = 'px-2 py-2 text-xs font-bold uppercase text-black/60'

  return (
    <main className="min-h-screen bg-void text-ink print:bg-white print:text-black">
      <style>{`@media print { body { background: white !important; } }`}</style>

      <div className="flex flex-wrap items-center gap-2 border-b border-line-2 bg-panel px-4 py-3 print:hidden sm:px-6">
        <button type="button" onClick={downloadPdf} disabled={downloading} className="inline-flex items-center gap-2 rounded-instrument bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-lit disabled:opacity-60">
          <Download size={15} /> {downloading ? 'Downloading...' : 'Download PDF'}
        </button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-instrument border border-line-2 bg-raised px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand">
          <Printer size={15} /> Print
        </button>
        <button type="button" onClick={emailInvoice} disabled={emailing} className="inline-flex items-center gap-2 rounded-instrument border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/15 disabled:opacity-60">
          <Mail size={15} /> {emailing ? 'Sending...' : 'Email to Customer'}
        </button>
        <span className="font-mono text-xs text-muted">{ro_number}</span>
        {notice && (
          <span role={noticeType === 'error' ? 'alert' : 'status'} className={`text-xs ${noticeType === 'error' ? 'text-crit' : 'text-good'}`}>
            {notice}
          </span>
        )}
      </div>

      <article className="mx-auto my-6 max-w-[780px] rounded-instrument bg-white p-[clamp(1rem,5vw,2.5rem)] text-black shadow-lg print:m-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-5">
          <div className="flex items-start gap-3">
            {shop?.logo_url && (
              <div className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-instrument border border-black/10 bg-white">
                <img src={shop.logo_url} alt={`${shop?.name || 'Shop'} logo`} className="max-h-full max-w-full object-contain" />
              </div>
            )}
            <div>
              <h1 className="font-display text-2xl font-extrabold uppercase">{shop?.name || 'Auto Body Shop'}</h1>
              {shop?.address && <p className="mt-1 text-sm text-black/70">{shop.address}{shop.city ? `, ${shop.city}` : ''}{shop.state ? `, ${shop.state}` : ''} {shop.zip || ''}</p>}
              {shop?.phone && <p className="text-sm text-black/70">{shop.phone}</p>}
            </div>
          </div>
          <div className="text-right text-sm text-black/70">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-black">Invoice</h2>
            <p className="mt-1">RO: <strong className="font-mono text-black">{ro_number}</strong></p>
            <p>Date: {today}</p>
            {intake_date && <p>Intake: {intake_date}</p>}
            {actual_delivery && <p>Delivered: {actual_delivery}</p>}
          </div>
        </header>

        <div className="mb-8 grid gap-6 sm:grid-cols-2">
          <section>
            <h3 className={sectionLabelClass}>Bill To</h3>
            <p className="font-bold">{customer?.name || '—'}</p>
            {customer?.address && <p className="mt-1 text-sm text-black/70">{customer.address}</p>}
            {customer?.phone && <p className="text-sm text-black/70">{customer.phone}</p>}
            {customer?.email && <p className="break-all text-sm text-black/70">{customer.email}</p>}
          </section>
          <section>
            <h3 className={sectionLabelClass}>Vehicle</h3>
            <p className="font-bold">{vehicle?.year} {vehicle?.make} {vehicle?.model}</p>
            {vehicle?.color && <p className="mt-1 text-sm text-black/70">Color: {vehicle.color}</p>}
            {vehicle?.vin && <p className="font-mono text-sm text-black/70">VIN: {vehicle.vin}</p>}
            {vehicle?.plate && <p className="font-mono text-sm text-black/70">Plate: {vehicle.plate}</p>}
            {vehicle?.mileage && <p className="font-mono text-sm text-black/70">Mileage: {vehicle.mileage.toLocaleString()}</p>}
          </section>
        </div>

        {payment_type === 'insurance' && (insurer || claim_number) && (
          <div className="mb-6 flex flex-wrap gap-x-4 gap-y-1 rounded-instrument bg-black/[0.04] px-4 py-3 text-sm text-black/70">
            <strong className="text-black">Insurance Claim</strong>
            {insurer && <span>Carrier: <strong>{insurer}</strong></span>}
            {claim_number && <span>Claim #: <strong className="font-mono">{claim_number}</strong></span>}
          </div>
        )}

        {parts && parts.length > 0 && (
          <section className="mb-6">
            <h3 className={sectionLabelClass}>Parts</h3>
            <div className="overflow-x-auto">
              <table className="min-w-[620px] w-full border-collapse text-sm">
                <thead><tr className="border-b-2 border-black/10">
                  <th className={`${tableHeadingClass} text-left`}>Description</th>
                  <th className={`${tableHeadingClass} text-left`}>Part #</th>
                  <th className={`${tableHeadingClass} text-center`}>Qty</th>
                  <th className={`${tableHeadingClass} text-right`}>Unit Price</th>
                  <th className={`${tableHeadingClass} text-right`}>Total</th>
                </tr></thead>
                <tbody>{parts.map((p, i) => (
                  <tr key={p.id || i} className="border-b border-black/[0.06]">
                    <td className="px-2 py-2">{p.part_name}</td>
                    <td className="px-2 py-2 font-mono text-xs text-black/60">{p.part_number || '—'}</td>
                    <td className="px-2 py-2 text-center font-mono">{p.quantity || 1}</td>
                    <td className={`px-2 py-2 text-right ${moneyClass}`}>{fmt(p.unit_cost)}</td>
                    <td className={`px-2 py-2 text-right font-semibold ${moneyClass}`}>{fmt((p.unit_cost || 0) * (p.quantity || 1))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mb-6">
          <h3 className={sectionLabelClass}>Services</h3>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b-2 border-black/10">
              <th className={`${tableHeadingClass} text-left`}>Description</th>
              <th className={`${tableHeadingClass} text-right`}>Amount</th>
            </tr></thead>
            <tbody>
              {parseFloat(labor_cost || 0) > 0 && <tr className="border-b border-black/[0.06]"><td className="px-2 py-2">Labor</td><td className={`px-2 py-2 text-right font-semibold ${moneyClass}`}>{fmt(labor_cost)}</td></tr>}
              {parseFloat(parts_cost || 0) > 0 && parts?.length === 0 && <tr className="border-b border-black/[0.06]"><td className="px-2 py-2">Parts</td><td className={`px-2 py-2 text-right font-semibold ${moneyClass}`}>{fmt(parts_cost)}</td></tr>}
              {parseFloat(sublet_cost || 0) > 0 && <tr className="border-b border-black/[0.06]"><td className="px-2 py-2">Sublet Work</td><td className={`px-2 py-2 text-right font-semibold ${moneyClass}`}>{fmt(sublet_cost)}</td></tr>}
            </tbody>
          </table>
        </section>

        <div className="mb-8 flex justify-end">
          <div className="w-full max-w-[260px] text-sm">
            <div className="flex justify-between border-t border-black/10 py-1.5"><span className="text-black/60">Subtotal</span><span className={`font-semibold ${moneyClass}`}>{fmt(subtotal)}</span></div>
            {taxAmt > 0 && <div className="flex justify-between py-1.5"><span className="text-black/60">Tax</span><span className={`font-semibold ${moneyClass}`}>{fmt(taxAmt)}</span></div>}
            <div className="mt-1 flex justify-between border-t-2 border-black py-2.5 text-base font-extrabold"><span>Total</span><span className={moneyClass}>{fmt(totalAmt > 0 ? totalAmt : subtotal + taxAmt)}</span></div>
          </div>
        </div>

        {notes && <section className="mb-6 rounded-instrument bg-black/[0.04] px-4 py-3 text-sm text-black/70"><h3 className={sectionLabelClass}>Notes</h3>{notes}</section>}

        <footer className="border-t border-black/10 pt-5 text-center">
          <p className="text-sm font-semibold">Thank you for your business.</p>
          <p className="mt-1 text-xs text-black/50">{shop?.name}{shop?.phone ? ` · ${shop.phone}` : ''}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.02] px-2 py-1">
            <img src="/icon-192.svg" alt="REVV logo" className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold text-black/50">Estimated & tracked with REVV · revvshop.app</span>
          </div>
        </footer>
      </article>
    </main>
  )
}
