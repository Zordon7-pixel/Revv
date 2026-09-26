import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import api from '../../lib/api'
import AgreementTemplates from '../AgreementTemplates'
import ROAgreements from '../ROAgreements'

beforeEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset() })
describe('shop agreement controls', () => {
  it('uploads the PDF and configured signature requirements without sending messages', async () => {
    api.get.mockResolvedValue({ data: { templates: [] } })
    api.post.mockResolvedValue({ data: { id: 'template-1' } })
    render(<AgreementTemplates />)
    fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'Liability agreement' } })
    fireEvent.change(screen.getByLabelText('Agreement PDF'), { target: { files: [new File(['%PDF-test'], 'agreement.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(/Sections requiring/), { target: { value: 'Page 2 - Storage\nPage 3 - Repairs' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Upload agreement' }).closest('form'))
    await screen.findByRole('status')
    expect(api.post).toHaveBeenCalledTimes(1)
    const [path, body] = api.post.mock.calls[0]
    expect(path).toBe('/agreements/templates')
    expect(body.get('title')).toBe('Liability agreement')
    expect(body.get('requires_shop_signature')).toBe('true')
    expect(JSON.parse(body.get('initial_sections'))).toEqual(['Page 2 - Storage', 'Page 3 - Repairs'])
    expect(body.get('agreement').name).toBe('agreement.pdf')
  })
  it('prepares a link for the current repair order and clearly reports that it was not sent', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/agreements/templates'
      ? { templates: [{ id: 'template-1', title: 'Liability agreement' }] }
      : { agreements: [], consent_version: 'v1' } }))
    api.post.mockResolvedValue({ data: { id: 'request-1', signing_path: `/sign#${'a'.repeat(64)}` } })
    render(<ROAgreements roId="ro-current" customerName="Current Customer" customerEmail="current@example.test" />)
    await screen.findByRole('option', { name: 'Liability agreement' })
    fireEvent.change(screen.getByLabelText('Shop agreement'), { target: { value: 'template-1' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Prepare signing link' }).closest('form'))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/agreements/ro/ro-current', { template_id: 'template-1', recipient_name: 'Current Customer', recipient_email: 'current@example.test' }))
    expect(await screen.findByText('Link ready. No message has been sent to the customer.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open for customer' }).getAttribute('href')).toContain('/sign#')
  })
  it('archive-only controls retain downloads without allowing creation against a deleted RO', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/agreements/templates' ? { templates: [] } : { agreements: [{ id: 'signed-1', title: 'Signed agreement', status: 'signed', recipient_name: 'Customer', created_at: '2026-09-26' }] } }))
    render(<ROAgreements roId="deleted-ro" archiveOnly canCountersign />)
    expect(await screen.findByRole('button', { name: 'Download signed PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare signing link' })).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/agreements/ro/deleted-ro')
  })
})
