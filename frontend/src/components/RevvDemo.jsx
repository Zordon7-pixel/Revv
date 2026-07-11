import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Volume2, VolumeX } from 'lucide-react'

const DURATION_MS = 30_000

const BEATS = [
  {
    id: 'hook',
    start: 0,
    end: 5_500,
    eyebrow: 'REVV PROFIT SIGNAL',
    title: 'This RO is $1,450 short.',
    metric: '-$1,450',
    tone: 'critical',
  },
  {
    id: 'floor',
    start: 5_500,
    end: 11_000,
    eyebrow: 'LIVE PRODUCTION FLOOR',
    title: 'Parts stalled. Paint is waiting.',
    metric: '2 BLOCKS',
    tone: 'brand',
  },
  {
    id: 'catch',
    start: 11_000,
    end: 17_000,
    eyebrow: 'THE CATCH',
    title: 'Three operations never made the estimate.',
    metric: '3 FOUND',
    tone: 'brand',
  },
  {
    id: 'payout',
    start: 17_000,
    end: 23_500,
    eyebrow: 'PROFIT RECOVERED',
    title: '$1,450 protected before delivery.',
    metric: '+$1,450',
    tone: 'money',
  },
  {
    id: 'cta',
    start: 23_500,
    end: DURATION_MS + 1,
    eyebrow: 'REVV SHOP OPERATING SYSTEM',
    title: 'Run every repair. Protect every dollar.',
    metric: 'IN SYNC',
    tone: 'brand',
  },
]

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function RevvDemo({ className = '' }) {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [elapsed, setElapsed] = useState(() => (prefersReducedMotion() ? DURATION_MS : 0))
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [soundEnabled, setSoundEnabled] = useState(false)
  const videoRef = useRef(null)

  const start = useCallback(({ sound = false } = {}) => {
    const playWithSound = sound && !reducedMotion
    setSoundEnabled(playWithSound)
    setElapsed(0)
    const video = videoRef.current
    let videoPlayback = null
    if (video) {
      video.pause()
      video.currentTime = 0
      video.muted = !playWithSound
      if (!reducedMotion) videoPlayback = video.play()
    }
    setPlaying(!reducedMotion)

    videoPlayback?.catch?.(() => {
      setPlaying(false)
      setSoundEnabled(false)
      if (video) video.muted = true
    })
    if (reducedMotion) {
      setElapsed(DURATION_MS)
      setPlaying(false)
    }
  }, [reducedMotion])

  const toggleSound = useCallback(() => {
    const video = videoRef.current
    if (soundEnabled) {
      setSoundEnabled(false)
      if (video) video.muted = true
      return
    }
    if (reducedMotion) return
    setSoundEnabled(true)
    if (video) {
      video.muted = false
      if (video.ended) video.currentTime = 0
      if (video.paused) {
        video.play().catch(() => {
          video.muted = true
          setSoundEnabled(false)
          setPlaying(false)
        })
      }
    }
  }, [reducedMotion, soundEnabled])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return undefined
    const handleChange = (event) => {
      setReducedMotion(event.matches)
      setPlaying(!event.matches)
      setElapsed(event.matches ? DURATION_MS : 0)
      const video = videoRef.current
      if (event.matches) {
        if (video) {
          video.pause()
          video.muted = true
          if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05)
        }
        setSoundEnabled(false)
      } else if (video) {
        video.currentTime = 0
        video.muted = true
        setSoundEnabled(false)
        video.play().catch(() => setPlaying(false))
      }
    }
    query.addEventListener?.('change', handleChange)
    return () => query.removeEventListener?.('change', handleChange)
  }, [])

  const beat = useMemo(
    () => BEATS.find((item) => elapsed >= item.start && elapsed < item.end) || BEATS.at(-1),
    [elapsed],
  )
  const progress = reducedMotion ? 100 : Math.min(100, (elapsed / DURATION_MS) * 100)

  return (
    <div
      id="revv-demo"
      className={`revv-demo ${className}`}
      data-beat={beat.id}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-playing={playing ? 'true' : 'false'}
      aria-label="Thirty second REVV product demo"
    >
      <div className="revv-demo-media" aria-hidden="true">
        <video
          ref={videoRef}
          className="revv-demo-video"
          autoPlay={!reducedMotion}
          muted={!soundEnabled}
          playsInline
          preload="auto"
          poster="/demo/revv-product-tour-poster.png"
          onLoadedMetadata={(event) => {
            if (reducedMotion && Number.isFinite(event.currentTarget.duration)) {
              event.currentTarget.currentTime = Math.max(0, event.currentTarget.duration - 0.05)
            }
          }}
          onTimeUpdate={(event) => setElapsed(Math.min(DURATION_MS, event.currentTarget.currentTime * 1000))}
          onPlay={() => setPlaying(true)}
          onEnded={() => {
            setElapsed(DURATION_MS)
            setPlaying(false)
          }}
        >
          <source src="/demo/revv-product-tour-mobile.mp4" type="video/mp4" media="(max-width: 767px)" />
          <source src="/demo/revv-product-tour-desktop.mp4" type="video/mp4" />
        </video>
      </div>

      <div className="revv-demo-readout" aria-live="polite" aria-atomic="true">
        <div>
          <p className="revv-demo-eyebrow">{beat.eyebrow}</p>
          <p className="revv-demo-title">{beat.title}</p>
        </div>
        <p className={`revv-demo-metric is-${beat.tone}`}>{beat.metric}</p>
      </div>

      <div className="revv-demo-controls">
        <div className="revv-demo-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="revv-demo-control-row">
          <span className="revv-demo-time">0:{String(Math.min(30, Math.floor(elapsed / 1000))).padStart(2, '0')} / 0:30</span>
          <button
            type="button"
            className="revv-demo-icon-control"
            onClick={toggleSound}
            aria-label={soundEnabled ? 'Mute product tour' : 'Turn product tour sound on'}
            title={soundEnabled ? 'Mute' : 'Sound on'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            type="button"
            className="revv-demo-icon-control"
            onClick={() => start({ sound: soundEnabled })}
            aria-label="Replay product tour"
            title="Replay"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

    </div>
  )
}

export { BEATS, DURATION_MS }
export default RevvDemo
