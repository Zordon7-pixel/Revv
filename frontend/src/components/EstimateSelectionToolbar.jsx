function selectionForMode(items, mode) {
  return items.reduce((selection, item, index) => {
    if (mode === 'all') selection[index] = true
    else if (mode === 'parts') selection[index] = String(item?.type || '').toLowerCase() === 'parts'
    else selection[index] = false
    return selection
  }, {})
}

export default function EstimateSelectionToolbar({ items = [], selected = {}, onChange }) {
  const selectedCount = items.reduce((count, _, index) => count + (selected[index] ? 1 : 0), 0)
  const partsCount = items.filter((item) => String(item?.type || '').toLowerCase() === 'parts').length

  function applyMode(mode) {
    onChange?.(selectionForMode(items, mode))
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted" role="status" aria-live="polite">
        {selectedCount} of {items.length} estimate lines selected
      </p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Estimate line selection">
        <button
          type="button"
          onClick={() => applyMode('parts')}
          disabled={!partsCount}
          className="min-h-11 rounded-lg border border-brand/40 bg-brand/10 px-3 text-xs font-semibold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Select Parts Only
        </button>
        <button
          type="button"
          onClick={() => applyMode('all')}
          disabled={!items.length}
          className="min-h-11 rounded-lg border border-line-2 bg-void px-3 text-xs font-semibold text-ink transition-colors hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={() => applyMode('none')}
          disabled={!items.length}
          className="min-h-11 rounded-lg border border-line-2 bg-void px-3 text-xs font-semibold text-muted transition-colors hover:border-crit/40 hover:text-crit disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

export { selectionForMode }
