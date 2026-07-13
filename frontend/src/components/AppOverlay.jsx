import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function AppOverlay({
  children,
  onClose,
  label,
  className = 'bg-black/60 p-4',
  zClassName = 'z-[150]',
  ...overlayProps
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      {...overlayProps}
      data-app-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`app-overlay fixed inset-0 flex items-center justify-center ${zClassName} ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>,
    document.body
  )
}
