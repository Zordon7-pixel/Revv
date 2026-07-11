import { forwardRef } from 'react'

const LOGO_ASSETS = {
  mark: '/revv-mark-transparent.png',
  wordmark: '/revv-wordmark-transparent.png',
}

const STATUS_META = {
  intake: ['Intake', 'neutral'],
  estimate: ['Estimate', 'brand'],
  approval: ['Awaiting approval', 'brand'],
  parts: ['Parts', 'brand'],
  repair: ['In repair', 'brand'],
  paint: ['Paint', 'brand'],
  qc: ['QC', 'brand'],
  delivery: ['Delivery', 'brand'],
  closed: ['Closed', 'good'],
  paid: ['Paid', 'good'],
  total_loss: ['Total loss', 'crit'],
  closed_total_loss: ['Total loss closed', 'crit'],
  siu_hold: ['SIU hold', 'crit'],
  overdue: ['Overdue', 'crit'],
}

const TONES = {
  brand: 'var(--brand)',
  gold: 'var(--gold)',
  good: 'var(--good)',
  crit: 'var(--crit)',
  neutral: 'var(--muted)',
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

export const Logo = forwardRef(function Logo({
  variant = 'mark',
  alt = 'REVV',
  className = '',
  ...props
}, ref) {
  const safeVariant = variant === 'wordmark' ? 'wordmark' : 'mark'
  return (
    <img
      ref={ref}
      src={LOGO_ASSETS[safeVariant]}
      alt={alt}
      className={classNames('revv-logo-image', className)}
      {...props}
    />
  )
})

function parseCents(cents) {
  if (typeof cents === 'bigint') return cents
  const normalized = String(cents ?? '').trim()
  if (!/^-?\d+$/.test(normalized)) return null
  try {
    return BigInt(normalized)
  } catch {
    return null
  }
}

export function formatMoneyCents(cents, { currency = 'USD', locale = 'en-US' } = {}) {
  const value = parseCents(cents)
  if (value === null) return '—'
  const negative = value < 0n
  const absolute = negative ? -value : value
  const dollars = absolute / 100n
  const remainder = String(absolute % 100n).padStart(2, '0')
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${negative ? '-' : ''}${symbol}${dollars.toLocaleString(locale)}.${remainder}`
}

export function dollarsToCents(value) {
  const dollars = Number(value)
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0
}

export function Money({ cents, currency = 'USD', locale = 'en-US', className = '', as: Component = 'span', ...props }) {
  return (
    <Component className={classNames('font-mono tabular-nums tracking-normal', className)} data-numeric="true" {...props}>
      {formatMoneyCents(cents, { currency, locale })}
    </Component>
  )
}

export function GaugeArc({ value = 0, max = 100, tone = 'brand', label = 'Progress', className = '', children }) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0
  const safeMax = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : 100
  const ratio = Math.min(1, Math.max(0, safeValue / safeMax))
  const circumference = 263.89
  const arcLength = circumference * 0.75
  const progressLength = arcLength * ratio
  const color = TONES[tone] || TONES.brand
  return (
    <div
      className={classNames('relative inline-grid place-items-center', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
    >
      <svg viewBox="0 0 120 108" aria-hidden="true" className="h-full w-full overflow-visible">
        <circle
          cx="60"
          cy="56"
          r="42"
          fill="none"
          stroke="var(--line-2)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          transform="rotate(135 60 56)"
        />
        <circle
          cx="60"
          cy="56"
          r="42"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${progressLength} ${circumference - progressLength}`}
          transform="rotate(135 60 56)"
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center pt-1">{children}</div>}
    </div>
  )
}

export function displayStatusKey(status, claimStatus) {
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const normalizedClaim = String(claimStatus || '').trim().toLowerCase()
  if (normalizedStatus === 'closed' && normalizedClaim === 'total_loss') return 'closed_total_loss'
  return normalizedStatus
}

export function StatusBadge({ status, claimStatus, label, className = '' }) {
  const key = displayStatusKey(status, claimStatus)
  const [defaultLabel, tone] = STATUS_META[key] || [String(label || status || 'Unknown'), 'neutral']
  const color = TONES[tone]
  return (
    <span
      className={classNames('inline-flex min-h-6 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium', className)}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 36%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label || defaultLabel}
    </span>
  )
}

export function StatInstrument({ label, value, detail, gauge, tone = 'brand', className = '', onClick }) {
  const Component = onClick ? 'button' : 'section'
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={classNames(
        'grid min-h-32 w-full grid-cols-[1fr_auto] items-center gap-4 rounded-instrument border border-line bg-panel p-4 text-left shadow-[0_16px_40px_rgba(0,0,0,0.12)]',
        onClick && 'transition-colors hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</span>
        <span className="mt-2 block font-display text-2xl font-semibold leading-none text-ink">{value}</span>
        {detail && <span className="mt-2 block text-xs text-faint">{detail}</span>}
      </span>
      {gauge && (
        <GaugeArc value={gauge.value} max={gauge.max} tone={gauge.tone || tone} label={`${label} progress`} className="h-20 w-20">
          <span className="font-mono text-xs font-semibold text-ink" data-numeric="true">{gauge.label ?? `${Math.round((Number(gauge.value || 0) / Math.max(Number(gauge.max || 1), 1)) * 100)}%`}</span>
        </GaugeArc>
      )}
    </Component>
  )
}

export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={classNames('flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-2xl font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  )
}

export function Panel({ as: Component = 'section', title, description, actions, className = '', children, ...props }) {
  return (
    <Component className={classNames('rounded-instrument border border-line bg-panel', className)} {...props}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="font-display text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Component>
  )
}

export function EmptyState({ icon: Icon, media, title, description, action, className = '' }) {
  return (
    <div className={classNames('grid min-h-52 place-items-center px-6 py-10 text-center', className)} role="status">
      <div className="max-w-sm">
        {media || (Icon && <Icon size={24} className="mx-auto text-brand" aria-hidden="true" />)}
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}
