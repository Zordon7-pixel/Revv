import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'

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

  // Close on click outside
  useEffect(() => {
    function out(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [])

  const base = 'w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        onFocus={() => value.length > 0 && results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={`${base} ${className}`}
      />
      {value && (
        <button type="button" onClick={() => { onChange(''); setOpen(false); setResults([]) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
          <X size={13} />
        </button>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {results.map((item, i) => (
            <button key={i} type="button"
              onMouseDown={() => handleSelect(item)}
              className={`w-full text-left px-3 py-2.5 transition-colors border-b border-[#2a2d3e] last:border-0 ${i === active ? 'bg-indigo-600/30' : 'hover:bg-[#2a2d3e]'}`}>
              {renderItem(item)}
            </button>
          ))}
          <div className="px-3 py-1.5 text-[9px] text-slate-600 text-right border-t border-[#2a2d3e]">
            Built-in library — start typing to search
          </div>
        </div>
      )}
    </div>
  )
}
