import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
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

function scheduleScore() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null

  const context = new AudioContext()
  const master = context.createGain()
  master.gain.setValueAtTime(0.0001, context.currentTime)
  master.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.25)
  master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 29.5)
  master.connect(context.destination)

  const cueTimes = [0, 5.5, 11, 17, 23.5]
  cueTimes.forEach((offset, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + offset
    oscillator.type = index === 4 ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime([55, 65.41, 73.42, 82.41, 110][index], start)
    oscillator.frequency.exponentialRampToValueAtTime([73.42, 82.41, 98, 110, 146.83][index], start + 4.4)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(index === 3 ? 0.35 : 0.22, start + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 4.8)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(start)
    oscillator.stop(start + 4.9)
  })

  return context
}

const RevvDemo = forwardRef(function RevvDemo({ className = '' }, ref) {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [elapsed, setElapsed] = useState(() => (prefersReducedMotion() ? DURATION_MS : 0))
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [soundEnabled, setSoundEnabled] = useState(false)
  const videoRef = useRef(null)
  const voiceRef = useRef(null)
  const scoreRef = useRef(null)

  const stopAudio = useCallback(() => {
    if (voiceRef.current) {
      voiceRef.current.pause()
      voiceRef.current.currentTime = 0
    }
    if (scoreRef.current) {
      scoreRef.current.close().catch(() => {})
      scoreRef.current = null
    }
  }, [])

  const start = useCallback(({ sound = false } = {}) => {
    stopAudio()
    setSoundEnabled(sound)
    setElapsed(0)
    const video = videoRef.current
    let videoPlayback = null
    if (video) {
      video.pause()
      video.currentTime = 0
      video.muted = true
      if (!reducedMotion) videoPlayback = video.play()
    }
    setPlaying(!reducedMotion)

    let voicePlayback = null
    if (sound) {
      scoreRef.current = scheduleScore()
      if (scoreRef.current?.state === 'suspended') {
        scoreRef.current.resume().catch(() => {})
      }
      if (voiceRef.current) {
        voiceRef.current.currentTime = 0
        voicePlayback = voiceRef.current.play()
      }
    }

    videoPlayback?.catch?.(() => setPlaying(false))
    voicePlayback?.catch?.(() => setSoundEnabled(false))
    if (reducedMotion) {
      setElapsed(DURATION_MS)
      setPlaying(false)
    }
  }, [reducedMotion, stopAudio])

  useImperativeHandle(ref, () => ({
    playWithSound: () => start({ sound: true }),
    replayMuted: () => start({ sound: false }),
  }), [start])

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
          if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05)
        }
        stopAudio()
      } else if (video) {
        video.currentTime = 0
        video.play().catch(() => setPlaying(false))
      }
    }
    query.addEventListener?.('change', handleChange)
    return () => query.removeEventListener?.('change', handleChange)
  }, [stopAudio])

  useEffect(() => () => stopAudio(), [stopAudio])

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
          muted
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
            onClick={() => start({ sound: true })}
            aria-label="Restart product tour with sound"
            title="Restart with sound"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            type="button"
            className="revv-demo-icon-control"
            onClick={() => start({ sound: false })}
            aria-label="Replay product tour muted"
            title="Replay muted"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <audio ref={voiceRef} src="/demo/revv-wow-tv-ad.mp3" preload="metadata" />
    </div>
  )
})

export { BEATS, DURATION_MS }
export default RevvDemo
