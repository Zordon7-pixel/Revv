import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'

/**
 * LibraryAutocomplete
 * Props:
 *  - value: current text value
 *  - onChange(text): called when text changes
 *  - onSelect(item): called when an item is selected from the list
 *  - searchFn(query): returns array of matching items
 *  - renderItem(item): returns JSX for each suggestion row
 *  - placeholder: input placeholder
 *  - className: extra classes for input
 */
export default function LibraryAutocomplete({
  value = '',
  onChange,
  onSelect,
  searchFn,
  renderItem,
  placeholder = 'Type to search...',
  className = '',
}) {
  const [open,    setOpen]    = useState(false)
  const [results, setResults] = useState([])
  const [active,  setActive]  = useState(-1)
  const ref = useRef(null)

  function handleChange(e) {
    const v = e.target.value
    onChange(v)
    const hits = searchFn(v)
    setResults(hits)
    setOpen(hits.length > 0)
    setActive(-1)
  }

  function handleSelect(item) {
    onSelect(item)
    setOpen(false)
    setResults([])
  }

  function handleKey(e) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); handleSelect(results[active]) }
    if (e.key === 'Escape')    { setOpen(false) }
  }

  // Close on click/touch outside
  useEffect(() => {
    function out(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    document.addEventListener('touchstart', out)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('touchstart', out)
    }
  }, [])

  const base = 'w-full rounded-instrument border border-line-2 bg-void px-3 py-2.5 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        onFocus={() => value.length > 0 && results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${base} ${className}`}
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); setOpen(false); setResults([]) }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
          aria-label="Clear autocomplete value">
          <X size={13} />
        </button>
      )}
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto overflow-x-hidden rounded-instrument border border-line-2 bg-panel shadow-xl">
          {results.map((item, i) => (
            <button key={i} type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(item) }}
              onTouchEnd={e => { e.preventDefault(); handleSelect(item) }}
              className={`w-full border-b border-line-2 px-3 py-2.5 text-left text-ink transition-colors last:border-0 ${i === active ? 'bg-brand/15 text-brand' : 'hover:bg-raised'}`}>
              {renderItem(item)}
            </button>
          ))}
          <div className="border-t border-line-2 px-3 py-1.5 text-right text-[9px] text-faint">
            Built-in library — start typing to search
          </div>
        </div>
      )}
    </div>
  )
}
