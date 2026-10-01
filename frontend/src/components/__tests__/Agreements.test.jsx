import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import api from '../../lib/api'
import AgreementTemplates from '../AgreementTemplates'
import ROAgreements from '../ROAgreements'

const context = { identity: { name: 'Customer', email: 'qa@example.test', vehicle:'2024 Toyota Camry', vin:'QA-VIN', claim:'CLAIM-1' }, defaults:{ estimate:'RO-QA / estimate v1',amount:'4250.50',deductible:'0.00',loss_date:'2026-09-20',invoice:'Invoice for RO-QA' }, sources:{amount:'Saved RO total, including tax'}, warnings:[],revision:'revision-1' }

beforeEach(() => { cleanup(); api.get.mockReset(); api.post.mockReset() })
describe('shop agreement controls', () => {
  it('only offers void for a pending request with the owner/admin capability', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/agreements/templates' ? { templates: [] } : {
      agreements: [{ id:'pending-1', title:'Pending agreement', status:'pending', recipient_name:'Customer', created_at:'2026-09-26' }],
    } }))
    const view = render(<ROAgreements roId="ro-void" archiveOnly />)
    await screen.findByText('Pending agreement')
    expect(screen.queryByRole('button', { name:'Void pending request' })).not.toBeInTheDocument()
    view.rerender(<ROAgreements roId="ro-void" archiveOnly canCountersign />)
    api.post.mockResolvedValue({ data:{ success:true } })
    fireEvent.click(screen.getByRole('button', { name:'Void pending request' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/agreements/pending-1/void'))
  })
  it.each(['awaiting_shop', 'signed', 'voided'])('never offers void for %s even to managers', async (status) => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path === '/agreements/templates' ? { templates: [] } : {
      agreements: [{ id:'immutable-1', title:'Existing agreement', status, recipient_name:'Customer', created_at:'2026-09-26' }],
    } }))
    render(<ROAgreements roId="ro-signed" archiveOnly canCountersign />)
    await screen.findByText('Existing agreement')
    expect(screen.queryByRole('button', { name:/Void .*request/ })).not.toBeInTheDocument()
  })
  it('uploads the PDF and configured signature requirements without sending messages', async () => {
    api.get.mockResolvedValue({ data: { templates: [] } })
    api.post.mockResolvedValue({ data: { id: 'template-1' } })
    render(<AgreementTemplates />)
    fireEvent.change(screen.getByLabelText('Agreement title'), { target: { value: 'Liability agreement' } })
    fireEvent.change(screen.getByLabelText('Agreement PDF'), { target: { files: [new File(['%PDF-test'], 'agreement.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('radio', { name: 'Customer only' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Customer and shop representative' }))
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
  it('requires deliberate Miles intake details and omits completion selection during New RO', async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: path.endsWith('/preparation') ? context : path === '/agreements/templates'
      ? { templates: [{ id: 'miles-cash', title: 'Cash agreement', preparation_kind: 'miles_cash_v1' }] } : { agreements: [] } }))
    api.post.mockResolvedValue({ data: { signing_path: '/sign#qa' } })
    render(<ROAgreements roId="new-ro" customerName="Customer" initialTemplate="miles-cash" intakeOnly />)
    await screen.findByLabelText(/Estimate reference \/ version/)
    await waitFor(() => expect(screen.getByLabelText(/Authorized total, including tax/)).toHaveValue(4250.5))
    expect(screen.getByText('2024 Toyota Camry')).toBeInTheDocument()
    expect(screen.getByRole('button', {name:'Prepare signing link'})).toBeDisabled()
    expect(screen.queryByLabelText('Signing stage')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Estimate reference \/ version/), { target: { value: 'Estimate 1' } })
    fireEvent.change(screen.getByLabelText(/Authorized total, including tax/), { target: { value: '2500' } })
    fireEvent.click(screen.getByLabelText(/I checked the customer/))
    fireEvent.submit(screen.getByRole('button', { name: 'Prepare signing link' }).closest('form'))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/agreements/ro/new-ro', expect.objectContaining({ preparation: expect.objectContaining({stage:'intake',estimate:'Estimate 1',amount:'2500',reviewed:true}) })))
  })

  it('resets review after financial edits and blocks preparation when RO details fail', async () => {
    api.get.mockImplementation((path) => path.endsWith('/preparation') ? Promise.reject({response:{data:{error:'RO details failed'}}}) : Promise.resolve({data:path.endsWith('/templates') ? {templates:[{id:'miles',title:'Miles insurance',preparation_kind:'miles_insurance_v1'}]} : {agreements:[]}}))
    const view=render(<ROAgreements roId="ro-failed" initialTemplate="miles" />)
    await screen.findByText('RO details failed')
    expect(screen.getByRole('button',{name:'Prepare signing link'})).toBeDisabled()
    api.get.mockImplementation((path) => Promise.resolve({data:path.endsWith('/preparation') ? context : path.endsWith('/templates') ? {templates:[{id:'miles',title:'Miles insurance',preparation_kind:'miles_insurance_v1'}]} : {agreements:[]}}))
    fireEvent.click(screen.getByRole('button',{name:'Reload RO details'}))
    await waitFor(()=>expect(screen.getByLabelText(/Deductible/)).toHaveValue(0))
    fireEvent.click(screen.getByLabelText(/I checked the customer/))
    expect(screen.getByRole('button',{name:'Prepare signing link'})).toBeEnabled()
    fireEvent.change(screen.getByLabelText(/Authorized total, including tax/),{target:{value:'4300'}})
    expect(screen.getByLabelText(/I checked the customer/)).not.toBeChecked()
    view.unmount()
  })
  it('discards an earlier RO response when switching repair orders', async () => {
    let releaseFirst
    api.get.mockImplementation((path) => path==='/agreements/ro/first/preparation' ? new Promise(resolve=>{releaseFirst=resolve}) : Promise.resolve({data:path.endsWith('/preparation') ? {...context,identity:{...context.identity,name:'Second customer'}} : path.endsWith('/templates') ? {templates:[{id:'miles',title:'Miles',preparation_kind:'miles_cash_v1'}]} : {agreements:[]}}))
    const view=render(<ROAgreements roId="first" initialTemplate="miles" />)
    view.rerender(<ROAgreements roId="second" initialTemplate="miles" />)
    await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveValue('Second customer'))
    releaseFirst({data:context})
    await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveValue('Second customer'))
    expect(screen.getByLabelText(/I checked the customer/)).not.toBeChecked()
  })

  it('never shows a previous RO signing link after an in-flight create resolves', async () => {
    let finishCreate
    api.get.mockImplementation((path)=>Promise.resolve({data:path.endsWith('/preparation')?context:path.endsWith('/templates')?{templates:[{id:'miles',title:'Miles',preparation_kind:'miles_cash_v1'}]}:{agreements:[]}}))
    api.post.mockImplementation(()=>new Promise(resolve=>{finishCreate=resolve}))
    const view=render(<ROAgreements roId="first" initialTemplate="miles" />)
    await waitFor(()=>expect(screen.getByLabelText(/Authorized total/)).toHaveValue(4250.5))
    fireEvent.click(screen.getByLabelText(/I checked the customer/))
    fireEvent.submit(screen.getByRole('button',{name:'Prepare signing link'}).closest('form'))
    await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1))
    view.rerender(<ROAgreements roId="second" initialTemplate="miles" />)
    await waitFor(()=>expect(api.get).toHaveBeenCalledWith('/agreements/ro/second/preparation'))
    finishCreate({data:{signing_path:'/sign#private-first-ro'}})
    await waitFor(()=>expect(screen.queryByLabelText('Private signing link')).not.toBeInTheDocument())
    expect(screen.queryByRole('link',{name:'Open for customer'})).not.toBeInTheDocument()
  })

})
