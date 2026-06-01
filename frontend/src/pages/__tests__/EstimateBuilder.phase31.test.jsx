import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}))

import api from '../../lib/api'
import EstimateBuilder from '../EstimateBuilder'
import { AI_CONFIG_ERROR } from '../../lib/safeErrors'

function renderEstimateBuilder() {
  return render(
    <MemoryRouter initialEntries={['/estimate-builder/ro-1']}>
      <Routes>
        <Route path="/estimate-builder/:roId" element={<EstimateBuilder />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EstimateBuilder OCR import', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.delete.mockReset()
    api.patch.mockReset()
    window.alert = vi.fn()

    api.get.mockImplementation((url) => {
      if (url === '/estimate-items/ro-1') return Promise.resolve({ data: { items: [], summary: null } })
      if (url === '/ros/ro-1') return Promise.resolve({ data: { id: 'ro-1', ro_number: 'RO-3101', customer: { name: 'Miles Automotive' } } })
      if (url === '/estimate-metadata/metadata/ro-1') return Promise.resolve({ data: { metadata: null } })
      if (url === '/estimate-items/ro-1/opportunities') return Promise.resolve({ data: { summary: null, flags: [] } })
      return Promise.resolve({ data: {} })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a safe inline OCR error instead of alerting provider key text', async () => {
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

    const { container } = renderEstimateBuilder()

    await screen.findByRole('heading', { name: 'Estimate Builder' })
    const fileInput = container.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['pdf'], '15 Benz CLS 400.pdf', { type: 'application/pdf' })],
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(AI_CONFIG_ERROR)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/insurance-ocr/parse', expect.any(FormData), expect.any(Object)))
    expect(screen.queryByText(/sk-(?:proj-)?|platform\.[a-z]+\.com|api key/i)).not.toBeInTheDocument()
    expect(window.alert).not.toHaveBeenCalled()
  })
})
