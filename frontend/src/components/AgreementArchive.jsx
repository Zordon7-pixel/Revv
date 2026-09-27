import { useEffect, useState } from 'react'
import api from '../lib/api'
import { agreementButton, agreementInput, agreementStatus, agreementError } from '../lib/agreements'
import ROAgreements from './ROAgreements'

export default function AgreementArchive() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.get('/agreements/archive', { params: { q: query, offset } }).then(({ data }) => {
      if (active) { setItems(Array.isArray(data.agreements) ? data.agreements : []); setHasMore(data.has_more); setError('') }
    }).catch((err) => { if (active) setError(agreementError(err)) })
    return () => { active = false }
  }, [query, offset])
  return <section className="rounded-2xl border border-line bg-panel p-5 space-y-4">
    <div><h2 className="font-semibold text-ink">Agreement records</h2><p className="text-sm text-muted">Find signing records and completed PDFs, including records whose repair order was removed.</p></div>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(search); setSelected(null) }}>
      <input aria-label="Search agreement records" className={agreementInput} value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} placeholder="Customer, agreement, or repair order" /><button className={agreementButton}>Search</button>
    </form>
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {!items.length && <p className="text-sm text-muted">No matching agreement records.</p>}
    {items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
      <div><p className="text-sm font-medium text-ink">{item.title} · {item.ro_number}</p><p className="text-xs text-muted">{item.recipient_name} · {agreementStatus[item.status]}</p></div>
      <button className={agreementButton} onClick={() => setSelected(item)}>View records</button>
    </div>)}
    <div className="flex gap-2"><button className={agreementButton} disabled={!offset} onClick={() => { setOffset((n) => Math.max(0, n - 50)); setSelected(null) }}>Previous</button><button className={agreementButton} disabled={!hasMore} onClick={() => { setOffset((n) => n + 50); setSelected(null) }}>Next</button></div>
    {selected && <div className="space-y-2"><button className={agreementButton} onClick={() => setSelected(null)}>Close records</button><ROAgreements key={selected.ro_id} roId={selected.ro_id} canCountersign archiveOnly /></div>}
  </section>
}
