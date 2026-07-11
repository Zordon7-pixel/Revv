import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import AppOverlay from './AppOverlay'
import { StatusBadge } from './ui'

const MIN_QUERY_LENGTH = 2

function vehicleLabel(result) {
  return [result.year, result.make, result.model].filter(Boolean).join(' ') || 'Vehicle not listed'
}

export default function CommandPalette({ open, onOpenChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const requestSequence = useRef(0)
  const navigate = useNavigate()

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestSequence.current += 1
      setResults([])
      setError('')
      setLoading(false)
      setActiveIndex(0)
      return undefined
    }

    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await api.get('/search', { params: { q: trimmed } })
        if (requestSequence.current !== sequence) return
        const nextResults = Array.isArray(response?.data?.results) ? response.data.results : []
        setResults(nextResults)
        setActiveIndex(0)
      } catch (err) {
        if (requestSequence.current !== sequence) return
        setResults([])
        setError(err?.response?.data?.error || 'Search is temporarily unavailable')
      } finally {
        if (requestSequence.current === sequence) setLoading(false)
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [open, query])

  function close() {
    onOpenChange(false)
    setQuery('')
    setResults([])
    setError('')
    setActiveIndex(0)
  }

  function openResult(result) {
    close()
    navigate(`/ros/${result.id}`)
  }

  function handleInputKeyDown(event) {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      openResult(results[activeIndex])
    }
  }

  if (!open) return null

  return (
    <AppOverlay label="Search repair orders" onClose={close} className="bg-void/80 p-3 backdrop-blur-sm">
      <section className="flex max-h-[min(36rem,calc(100dvh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-instrument border border-line-2 bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={18} className="shrink-0 text-brand-lit" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
            placeholder="Search RO, customer, plate, VIN, or claim"
            aria-label="Search repair orders"
            aria-controls="command-search-results"
            aria-activedescendant={results[activeIndex] ? `command-result-${results[activeIndex].id}` : undefined}
            autoComplete="off"
          />
          <kbd className="hidden rounded border border-line-2 bg-panel-2 px-2 py-1 font-mono text-[10px] text-muted sm:inline">ESC</kbd>
          <button type="button" onClick={close} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink" aria-label="Close search">
            <X size={16} />
          </button>
        </div>

        <div id="command-search-results" role="listbox" aria-label="Repair order search results" className="min-h-40 overflow-y-auto p-2">
          {query.trim().length < MIN_QUERY_LENGTH && (
            <p className="px-3 py-10 text-center text-sm text-muted">Type at least two characters to search this shop.</p>
          )}
          {loading && <p role="status" className="px-3 py-10 text-center text-sm text-muted">Searching this shop...</p>}
          {error && <p role="alert" className="px-3 py-10 text-center text-sm text-crit">{error}</p>}
          {!loading && !error && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <p role="status" className="px-3 py-10 text-center text-sm text-muted">No repair orders found in this shop.</p>
          )}
          {!loading && results.map((result, index) => (
            <button
              key={result.id}
              id={`command-result-${result.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openResult(result)}
              className={`grid w-full grid-cols-[1fr_auto] gap-3 rounded-md px-3 py-3 text-left transition-colors ${index === activeIndex ? 'bg-raised' : 'hover:bg-panel-2'}`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-brand-lit">{result.ro_number}</span>
                  <StatusBadge status={result.status} />
                </span>
                <span className="mt-1 block truncate text-sm text-ink">{result.customer_name || 'No customer'}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{vehicleLabel(result)}</span>
              </span>
              <span className="self-center text-right font-mono text-[11px] text-faint">
                {result.plate || result.claim_number || result.vin || ''}
              </span>
            </button>
          ))}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-faint">
          <span>Results are limited to your shop</span>
          <span className="font-mono">↑ ↓ navigate · ↵ open</span>
        </footer>
      </section>
    </AppOverlay>
  )
}
