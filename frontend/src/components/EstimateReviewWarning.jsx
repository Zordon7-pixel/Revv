import { AlertTriangle } from 'lucide-react'
import { estimateFormatLabel, estimateReviewMessages } from '../lib/estimateReview'

export default function EstimateReviewWarning({ parsed, pendingActionCopy, className = '' }) {
  const messages = estimateReviewMessages(parsed)
  if (!messages.length) return null

  return (
    <div role="status" aria-live="polite" className={`rounded-instrument border border-brand/35 bg-brand/10 px-3 py-3 ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Review this {estimateFormatLabel(parsed)} estimate before import</p>
          <p className="mt-1 text-xs text-muted">REVV extracted the estimate, but some details need confirmation. {pendingActionCopy}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
            {messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
