import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api', () => ({
  default: {
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

import api from '../../lib/api'
import InsurancePanel from '../InsurancePanel'
import { AI_CONFIG_ERROR } from '../../lib/safeErrors'

describe('InsurancePanel OCR import', () => {
  beforeEach(() => {
    api.post.mockReset()
    api.patch.mockReset()
    window.alert = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a safe message for provider auth failures without leaking key text', async () => {
    const user = userEvent.setup()
    const key = ['sk', 'proj-secret'].join('-')
    const docsUrl = ['https://platform', 'openai', 'com/account/api-keys'].join('.')
    const keyError = ['Incorrect', 'API key provided'].join(' ')
    api.post.mockRejectedValue({
      response: {
        data: {
          error: `401 ${keyError}: ${key}. You can find your API key at ${docsUrl}.`,
        },
      },
    })

    const { container } = render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Sedgwick', insurance_claim_number: 'CLM-1' }}
        onUpdated={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Upload estimate photo/i }))
    const fileInput = container.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['pdf'], '15 Benz CLS 400.pdf', { type: 'application/pdf' })],
      },
    })

    await user.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(AI_CONFIG_ERROR)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/parse', expect.any(FormData), expect.any(Object)))
    expect(screen.queryByText(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i)).not.toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('saves deductible as dollars instead of cents', async () => {
    const user = userEvent.setup()
    api.patch.mockResolvedValue({ data: { deductible: 1000 } })

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1', deductible: 500 }}
        onUpdated={vi.fn()}
      />
    )

    const deductible = screen.getByLabelText(/Deductible/i)
    await user.clear(deductible)
    await user.type(deductible, '1000')
    await user.click(screen.getByRole('button', { name: /Save Insurance/i }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ros/ro-1/insurance', expect.objectContaining({
      deductible: 1000,
    })))
    expect(api.patch.mock.calls[0][1].deductible).not.toBe(100000)
  })

  it('validates supplement amount before requesting a supplement', async () => {
    const user = userEvent.setup()

    render(
      <InsurancePanel
        roId="ro-1"
        ro={{ insurance_company: 'Progressive', insurance_claim_number: 'CLM-1', supplement_amount: 0 }}
        onUpdated={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Request Supplement/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a supplement amount greater than $0.00.')
    expect(api.post).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })
})
