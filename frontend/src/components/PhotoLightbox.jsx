import { useEffect, useState } from 'react'
import { Camera, RotateCcw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import AppOverlay from './AppOverlay'

const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 2]

export default function PhotoLightbox({
  src,
  alt = 'Photo',
  title = 'Photo preview',
  unavailable = false,
  onError,
  onClose,
  onDelete,
  deleting = false,
  footer = null,
}) {
  const [zoomIndex, setZoomIndex] = useState(1)
  const zoom = ZOOM_LEVELS[zoomIndex]

  useEffect(() => setZoomIndex(1), [src])

  const imageStyle = zoom === 1
    ? undefined
    : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }

  return (
    <AppOverlay
      data-photo-lightbox="true"
      label={title}
      onClose={onClose}
      zClassName="z-[200]"
      className="bg-black/90 p-3 sm:p-5"
    >
      <section
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-instrument border border-line-2 bg-panel shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-2 px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{title}</p>
            <p className="text-[11px] text-faint">{Math.round(zoom * 100)}%</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
              disabled={zoomIndex === 0}
              className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              onClick={() => setZoomIndex(1)}
              disabled={zoomIndex === 1}
              className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35"
              aria-label="Reset zoom"
              title="Reset zoom"
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setZoomIndex((current) => Math.min(ZOOM_LEVELS.length - 1, current + 1))}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn size={17} />
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="rounded-md p-2 text-crit transition-colors hover:bg-crit/10 disabled:opacity-40"
                aria-label="Delete photo"
                title="Delete photo"
              >
                <Trash2 size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
              aria-label="Close photo preview"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/50 p-3 sm:p-5">
          {src && !unavailable ? (
            <img
              data-testid="photo-lightbox-image"
              src={src}
              alt={alt}
              onError={onError}
              style={imageStyle}
              className="block h-auto max-h-[64dvh] max-w-[min(76vw,60rem)] object-contain"
            />
          ) : (
            <div className="flex min-h-64 w-80 max-w-full flex-col items-center justify-center gap-2 rounded-instrument border border-line-2 bg-void text-faint">
              <Camera size={28} className="text-faint" />
              <span className="text-sm font-medium">Photo unavailable</span>
            </div>
          )}
        </div>

        {footer && (
          <div className="max-h-36 shrink-0 overflow-y-auto border-t border-line-2 px-4 py-3">
            {footer}
          </div>
        )}
      </section>
    </AppOverlay>
  )
}
