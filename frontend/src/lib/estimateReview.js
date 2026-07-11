const REVIEW_REASON_MESSAGES = {
  ccc_line_grid_missing: 'The detailed CCC line-item grid was not fully detected.',
  mitchell_line_grid_missing: 'The detailed Mitchell line-item grid was not fully detected.',
  ccc_totals_missing: 'The CCC estimate totals section was not detected.',
  mitchell_totals_missing: 'The Mitchell estimate totals section was not detected.',
  ccc_line_items_missing: 'No detailed CCC line items were detected.',
  mitchell_line_items_missing: 'No detailed Mitchell line items were detected.',
  ccc_summary_items_from_totals: 'Detailed CCC rows could not be read, so REVV prepared reviewable estimate categories from the totals page.',
  mitchell_summary_items_from_totals: 'Detailed Mitchell rows could not be read, so REVV prepared reviewable estimate categories from the totals page.',
  unknown_summary_items_from_totals: 'Detailed rows could not be read, so REVV prepared reviewable estimate categories from the totals page.',
  body_labor_total_unreadable: 'The body labor total could not be read confidently.',
  paint_labor_total_unreadable: 'The paint labor total could not be read confidently.',
  mechanical_labor_total_unreadable: 'The mechanical labor total could not be read confidently.',
  frame_labor_total_unreadable: 'The frame labor total could not be read confidently.',
  glass_labor_total_unreadable: 'The glass labor total could not be read confidently.',
  sales_tax_total_unreadable: 'The sales tax total could not be read confidently.',
  subtotal_does_not_reconcile: 'The extracted subtotal does not match the sum of its estimate buckets.',
  total_cost_does_not_reconcile: 'The extracted gross repair total does not reconcile with the subtotal and taxes.',
  net_cost_does_not_reconcile: 'The extracted net total does not reconcile after deductible and adjustments.',
}

function fallbackReasonMessage(reason) {
  const message = String(reason || '')
    .replace(/^(ccc|mitchell)_/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
  return message ? `${message.replace(/\.$/, '')}.` : ''
}

export function estimateReviewMessages(parsed) {
  const reasons = Array.isArray(parsed?.review_reasons) ? parsed.review_reasons : []
  const messages = reasons.map((reason) => {
    const lineNumber = String(reason || '').match(/^low_confidence_line_(\d+)$/)?.[1]
    if (lineNumber) return `Estimate line ${lineNumber} could not be read with high confidence.`
    return REVIEW_REASON_MESSAGES[reason] || fallbackReasonMessage(reason)
  }).filter(Boolean)

  if (!messages.length && parsed?.needs_review) {
    messages.push('Some extracted estimate details could not be confirmed automatically.')
  }
  return [...new Set(messages)]
}

export function estimateFormatLabel(parsed) {
  const format = String(parsed?.detected_format || '').trim().toLowerCase()
  if (format === 'ccc') return 'CCC'
  if (format === 'mitchell') return 'Mitchell'
  return 'insurance'
}
