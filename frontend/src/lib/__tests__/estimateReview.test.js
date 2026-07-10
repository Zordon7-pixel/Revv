import { describe, expect, it } from 'vitest'
import { estimateFormatLabel, estimateReviewMessages } from '../estimateReview'

describe('estimate review messages', () => {
  it('turns parser review codes into shop-facing instructions', () => {
    expect(estimateReviewMessages({
      needs_review: true,
      review_reasons: [
        'subtotal_does_not_reconcile',
        'low_confidence_line_18',
        'ccc_line_items_missing',
      ],
    })).toEqual([
      'The extracted subtotal does not match the sum of its estimate buckets.',
      'Estimate line 18 could not be read with high confidence.',
      'No detailed CCC line items were detected.',
    ])
  })

  it('keeps an unexplained review flag visible and labels known formats', () => {
    expect(estimateReviewMessages({ needs_review: true })).toEqual([
      'Some extracted estimate details could not be confirmed automatically.',
    ])
    expect(estimateFormatLabel({ detected_format: 'ccc' })).toBe('CCC')
    expect(estimateFormatLabel({ detected_format: 'mitchell' })).toBe('Mitchell')
  })
})
