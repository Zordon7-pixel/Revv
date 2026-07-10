import { AlertTriangle } from 'lucide-react'
import { estimateFormatLabel, estimateReviewMessages } from '../lib/estimateReview'

export default function EstimateReviewWarning({ parsed, pendingActionCopy, className = '' }) {
  const messages = estimateReviewMessages(parsed)
  if (!messages.length) return null

  return (
    <div role="status" aria-live="polite" className={`rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-3 ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">Review this {estimateFormatLabel(parsed)} estimate before import</p>
          <p className="mt-1 text-xs text-amber-100/80">REVV extracted the estimate, but some details need confirmation. {pendingActionCopy}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-100/80">
            {messages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
