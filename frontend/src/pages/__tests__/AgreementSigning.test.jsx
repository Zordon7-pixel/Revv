import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import AgreementSigning from '../AgreementSigning'

vi.mock('../../components/AgreementPdfViewer', () => ({ default: () => <div title="Agreement PDF">PDF viewer</div> }))

const tokenA = 'a'.repeat(64)
const tokenB = 'b'.repeat(64)
const agreement = { id: 'a', title: 'Shop agreement', shop_name: 'Example Shop', ro_number: 'RO-1', recipient_name: 'José Rivera', status: 'pending', initial_sections: ['Storage'], document_sha256: 'document-hash', expires_at: '2026-10-26' }
const metadata = (title = 'Shop agreement') => ({ agreement: { ...agreement, title }, consent_text: 'I agree and intend to sign electronically.', consent_version: 'revv-esign-v1' })
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value })
let mockFetch
beforeEach(() => {
  cleanup(); mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('URL', URL)
  URL.createObjectURL = vi.fn(() => 'blob:test-document'); URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup() { return render(<MemoryRouter initialEntries={[`/sign#${tokenA}`]}><AgreementSigning /></MemoryRouter>) }
describe('customer signing', () => {
  it('requires document review, name, initials and consent before submitting the exact document', async () => {
    mockFetch.mockResolvedValueOnce(json(metadata()))
    setup()
    const sign = await screen.findByRole('button', { name: 'Agree and sign' })
    expect(sign).toBeDisabled()
    mockFetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['pdf']) })
    fireEvent.click(screen.getByRole('button', { name: 'Open agreement PDF' }))
    await screen.findByTitle('Agreement PDF')
    fireEvent.change(screen.getByLabelText(/Type your full legal name/), { target: { value: 'José Rivera' } })
    fireEvent.change(screen.getByLabelText(/Initials — Storage/), { target: { value: 'JR' } })
    fireEvent.click(screen.getByRole('checkbox'))
    mockFetch.mockResolvedValueOnce(json({ agreement: { ...agreement, status: 'signed' } }))
    fireEvent.click(sign)
    expect(await screen.findByText('Agreement signed')).toBeInTheDocument()
    const [url, options] = mockFetch.mock.calls[2]
    expect(url).toBe('/api/agreements/public/session/sign')
    expect(url).not.toContain(tokenA)
    expect(options.headers.Authorization).toBe(`Bearer ${tokenA}`)
    expect(JSON.parse(options.body)).toEqual({ name: 'José Rivera', initials: { Storage: 'JR' }, consent: true, consent_version: 'revv-esign-v1', document_sha256: 'document-hash' })
  })
  it('shows expired-link errors without enabling a signature form', async () => {
    mockFetch.mockResolvedValueOnce(json({ error: 'This agreement link has expired.' }, 410))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('expired')
    expect(screen.queryByRole('button', { name: 'Agree and sign' })).not.toBeInTheDocument()
  })
  it('resets signatures and aborts old requests when the signing token changes', async () => {
    let resolvePdf
    mockFetch.mockResolvedValueOnce(json(metadata('Agreement A')))
    function Harness() { const navigate = useNavigate(); return <><button onClick={() => navigate(`/sign#${tokenB}`)}>Switch agreement</button><AgreementSigning /></> }
    render(<MemoryRouter initialEntries={[`/sign#${tokenA}`]}><Harness /></MemoryRouter>)
    await screen.findByText('Agreement A')
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => { resolvePdf = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Open agreement PDF' }))
    mockFetch.mockResolvedValueOnce(json(metadata('Agreement B')))
    fireEvent.click(screen.getByRole('button', { name: 'Switch agreement' }))
    await screen.findByText('Agreement B')
    expect(mockFetch.mock.calls[1][1].signal.aborted).toBe(true)
    resolvePdf({ ok: true, blob: async () => new Blob(['old-pdf']) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agree and sign' })).toBeDisabled())
    expect(screen.queryByTitle('Agreement PDF')).not.toBeInTheDocument()
  })
})
