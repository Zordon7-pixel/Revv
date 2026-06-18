const TEXT_ENTRY_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(',')

export function isTextEntryTarget(target) {
  return Boolean(target?.matches?.(TEXT_ENTRY_SELECTOR))
}

export function scrollFocusedElementIntoView(targetWindow = window) {
  const target = targetWindow?.document?.activeElement
  if (!isTextEntryTarget(target) || typeof target.scrollIntoView !== 'function') return false

  const viewport = targetWindow.visualViewport
  const viewportTop = Math.round(viewport?.offsetTop || 0)
  const viewportHeight = Math.round(viewport?.height || targetWindow.innerHeight || 0)
  const margin = 28
  const rect = typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : null

  if (!rect || rect.bottom > viewportTop + viewportHeight - margin || rect.top < viewportTop + margin) {
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    return true
  }

  return false
}

function setTextEntryFocusState(targetDocument, focused) {
  const root = targetDocument?.documentElement
  if (!root) return
  if (focused) {
    root.dataset.textEntryFocus = 'true'
  } else {
    delete root.dataset.textEntryFocus
  }
}

export function installKeyboardFocusGuard(targetWindow = window) {
  if (!targetWindow?.document) return () => {}

  let timer = null
  const schedule = () => {
    targetWindow.clearTimeout?.(timer)
    timer = targetWindow.setTimeout?.(() => scrollFocusedElementIntoView(targetWindow), 90)
    targetWindow.setTimeout?.(() => scrollFocusedElementIntoView(targetWindow), 280)
  }

  const onFocusIn = (event) => {
    if (!isTextEntryTarget(event.target)) return
    setTextEntryFocusState(targetWindow.document, true)
    schedule()
  }
  const onFocusOut = () => {
    targetWindow.setTimeout?.(() => {
      setTextEntryFocusState(targetWindow.document, isTextEntryTarget(targetWindow.document.activeElement))
    }, 0)
  }
  const onViewportChange = () => {
    if (isTextEntryTarget(targetWindow.document.activeElement)) schedule()
  }

  targetWindow.document.addEventListener('focusin', onFocusIn)
  targetWindow.document.addEventListener('focusout', onFocusOut)
  targetWindow.visualViewport?.addEventListener('resize', onViewportChange)
  targetWindow.visualViewport?.addEventListener('scroll', onViewportChange)
  targetWindow.addEventListener?.('orientationchange', onViewportChange)

  return () => {
    targetWindow.clearTimeout?.(timer)
    setTextEntryFocusState(targetWindow.document, false)
    targetWindow.document.removeEventListener('focusin', onFocusIn)
    targetWindow.document.removeEventListener('focusout', onFocusOut)
    targetWindow.visualViewport?.removeEventListener('resize', onViewportChange)
    targetWindow.visualViewport?.removeEventListener('scroll', onViewportChange)
    targetWindow.removeEventListener?.('orientationchange', onViewportChange)
  }
}
