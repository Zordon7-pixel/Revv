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
    detail: 'The estimate is moving. The missed money is not.',
    metric: '-$1,450',
    tone: 'critical',
    asset: '/demo/job-costing.png',
  },
  {
    id: 'floor',
    start: 5_500,
    end: 11_000,
    eyebrow: 'LIVE PRODUCTION FLOOR',
    title: 'Parts stalled. Paint is waiting.',
    detail: 'REVV connects the handoffs before cycle time slips.',
    metric: '2 BLOCKS',
    tone: 'brand',
    asset: '/demo/repair-orders.png',
  },
  {
    id: 'catch',
    start: 11_000,
    end: 17_000,
    eyebrow: 'THE CATCH',
    title: 'Three operations never made the estimate.',
    detail: 'Proof, labor, and supplements surface while the RO is still open.',
    metric: '3 FOUND',
    tone: 'brand',
    asset: '/demo/ro-detail.png',
  },
  {
    id: 'payout',
    start: 17_000,
    end: 23_500,
    eyebrow: 'PROFIT RECOVERED',
    title: '$1,450 protected before delivery.',
    detail: 'One operating system keeps the job, proof, and money in sync.',
    metric: '+$1,450',
    tone: 'money',
    asset: '/demo/job-costing.png',
  },
  {
    id: 'cta',
    start: 23_500,
    end: DURATION_MS + 1,
    eyebrow: 'REVV SHOP OPERATING SYSTEM',
    title: 'Run every repair. Protect every dollar.',
    detail: 'From first photo to final payment, the whole shop moves together.',
    metric: 'IN SYNC',
    tone: 'brand',
    asset: '/demo/repair-orders.png',
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
  const frameRef = useRef(null)
  const startedAtRef = useRef(null)
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

  const start = useCallback(async ({ sound = false } = {}) => {
    stopAudio()
    setSoundEnabled(sound)
    setElapsed(0)
    startedAtRef.current = null
    setPlaying(!reducedMotion)

    if (sound) {
      scoreRef.current = scheduleScore()
      if (scoreRef.current?.state === 'suspended') {
        await scoreRef.current.resume().catch(() => {})
      }
      if (voiceRef.current) {
        voiceRef.current.currentTime = 0
        const playback = voiceRef.current.play()
        await playback?.catch?.(() => {})
      }
    }

    if (reducedMotion) setElapsed(DURATION_MS)
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
      startedAtRef.current = null
      if (event.matches) stopAudio()
    }
    query.addEventListener?.('change', handleChange)
    return () => query.removeEventListener?.('change', handleChange)
  }, [stopAudio])

  useEffect(() => {
    if (!playing || reducedMotion) return undefined
    const tick = (timestamp) => {
      if (startedAtRef.current === null) startedAtRef.current = timestamp
      const nextElapsed = Math.min(DURATION_MS, timestamp - startedAtRef.current)
      setElapsed(nextElapsed)
      if (nextElapsed < DURATION_MS) {
        frameRef.current = window.requestAnimationFrame(tick)
      } else {
        setPlaying(false)
      }
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [playing, reducedMotion])

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    stopAudio()
  }, [stopAudio])

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
      aria-label="Thirty second REVV product demo"
    >
      <div className="revv-demo-media" aria-hidden="true">
        {BEATS.map((item) => (
          <img
            key={item.id}
            src={item.asset}
            alt=""
            className={`revv-demo-screen ${item.id === beat.id ? 'is-active' : ''}`}
          />
        ))}
      </div>
      <div className="revv-demo-grid" aria-hidden="true" />
      <div className="revv-demo-sweep" aria-hidden="true" />

      <div className="revv-demo-readout" aria-live="polite" aria-atomic="true">
        <p className="revv-demo-eyebrow">{beat.eyebrow}</p>
        <p className="revv-demo-title">{beat.title}</p>
        <p className="revv-demo-detail">{beat.detail}</p>
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
            className="revv-demo-control"
            onClick={() => start({ sound: true })}
            aria-label="Play demo with sound"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'Sound on' : 'Play with sound'}</span>
          </button>
          <button
            type="button"
            className="revv-demo-icon-control"
            onClick={() => start({ sound: false })}
            aria-label="Replay demo muted"
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
