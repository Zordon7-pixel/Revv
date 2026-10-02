import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const route = vi.hoisted(() => ({ token: `pe_${'1'.repeat(64)}` }))
vi.mock('react-router-dom', () => ({ useParams: () => route }))
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => ({ 'common.loading': 'Loading', 'portal.approveEstimate': 'Approve estimate', 'ro.estimate': 'Estimate' }[key] || key) }) }))
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
import api from '../../lib/api'
import ApprovalPortal from '../ApprovalPortal'
const require = createRequire(import.meta.url)
const n = require('../../../../backend/src/services/panelEstimatorStore.js')
const { assembleDraft, hashInputs } = require('../../../../backend/src/services/panelEstimatorDraft.js')
const { DISCLOSURE } = require('../../../../backend/src/services/panelEstimatorApproval.js')
function projection(revision = 'r1') {
  const draft = n.publicSnapshot({ assessments: [{ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light', operation: 'repair', refinish: false, body_hours: 2, body_rate_cents: 10000, parts_sell_cents: 0, materials_sell_cents: 0, sublet_sell_cents: 0, taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true }, reviewed: true }] })
  const quote = { ...assembleDraft({ draft, costs: n.privateSnapshot({}), taxRateBps: 1000, paidCents: 0 }).sell, revision_id: revision, reviewed: true, reviewed_at: '2026-10-01T12:00:00Z', comparisons: [] }
  quote.quote_hash = hashInputs(quote)
  return { kind: 'panel_estimator', revision_id: revision, quote_hash: quote.quote_hash, version: 2, quote, disclosure: DISCLOSURE, expires_at: '2026-10-08T12:00:00Z', receipt: null }
}
const makeReceipt = (dto, body = {}) => ({ id: 'event-1', revision_id: dto.revision_id, quote_hash: dto.quote_hash, disclosure_version: DISCLOSURE.version, decision: 'approve', actor_name: 'Synthetic Customer', acknowledged: true, reason: null, responded_at: '2026-10-01T13:00:00Z', ...body })
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const acknowledge = () => fireEvent.click(screen.getByRole('checkbox'))
async function mount() { const result = render(<ApprovalPortal />); await screen.findByRole('article', { name: 'Customer quote' }); return result }
let dto
beforeEach(() => {
  vi.resetAllMocks(); route.token = `pe_${'1'.repeat(64)}`; dto = projection()
  api.get.mockImplementation(async () => ({ data: dto }))
  api.post.mockImplementation(async (_, body) => ({ data: { ...dto, receipt: makeReceipt(dto, body) } }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quote'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('requires a named actor and explicit acknowledgement, then submits only the exact A1 decision binding', async () => {
  await mount(); expect(screen.getByRole('button', { name: 'Approve this revision' })).toBeDisabled()
  change('Your full name', 'Synthetic Customer'); expect(screen.getByRole('button', { name: 'Approve this revision' })).toBeDisabled(); acknowledge()
  expect(screen.getByRole('button', { name: 'Decline this revision' })).toBeDisabled()
  click('Approve this revision'); await screen.findByText('Approved by Synthetic Customer')
  expect(api.post).toHaveBeenCalledWith(`/approval/${route.token}/respond`, { decision: 'approve', actor_name: 'Synthetic Customer', acknowledged: true, revision_id: dto.revision_id, quote_hash: dto.quote_hash, disclosure_version: DISCLOSURE.version })
  expect(screen.getByText(/Recorded at: 2026/)).toBeInTheDocument()
  expect(screen.getByText(/Matches the current selected quote loaded here/)).toBeInTheDocument()
  expect(screen.getByText(/No shop notification was sent/)).toBeInTheDocument()
  expect(screen.getByText(/not approval of a future revision/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve this revision' })).not.toBeInTheDocument()
})
it('requires a decline reason and renders the returned immutable receipt on reload', async () => {
  const { unmount } = await mount(); change('Your full name', 'Synthetic Customer'); acknowledge()
  expect(screen.getByRole('button', { name: 'Decline this revision' })).toBeDisabled()
  change('Change request reason', 'Please retain original trim'); click('Decline this revision'); await screen.findByText('Declined by Synthetic Customer')
  const body = api.post.mock.calls[0][1]; expect(body.reason).toBe('Please retain original trim'); expect(body.decision).toBe('decline')
  dto = { ...dto, receipt: makeReceipt(dto, body) }; unmount(); await mount()
  expect(screen.getByText('Declined by Synthetic Customer')).toBeInTheDocument(); expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
it('locks concurrent submissions and retries exactly the same body after an ambiguous network failure', async () => {
  await mount(); change('Your full name', 'Synthetic Customer'); acknowledge(); change('Change request reason', 'Keep this exact reason')
  let reject; api.post.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  click('Decline this revision'); click('Approve this revision'); expect(api.post).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Your full name')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download quote PDF' })).toBeDisabled()
  const original = api.post.mock.calls[0][1]; await act(async () => reject(new Error(`secret /approve/${route.token}`)))
  expect(await screen.findByRole('alert')).not.toHaveTextContent(route.token)
  expect(screen.getByLabelText('Your full name')).toBeDisabled(); click('Retry same decision'); await screen.findByText('Declined by Synthetic Customer')
  expect(api.post.mock.calls[1][1]).toBe(original)
})
it.each(['APPROVAL_DECISION_CONFLICT', 'APPROVAL_REVISION_CONFLICT', 'APPROVAL_DISCLOSURE_CONFLICT'])('shows %s without claiming success or allowing further responses', async code => {
  await mount(); change('Your full name', 'Synthetic Customer'); acknowledge()
  api.post.mockRejectedValue({ response: { status: 409, data: { error: code, detail: route.token } } })
  click('Approve this revision'); expect(await screen.findByRole('alert')).not.toHaveTextContent(route.token)
  expect(screen.queryByText('Approved by Synthetic Customer')).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload approval link' })).toBeInTheDocument()
})
it.each([404, 410, 409])('hides active controls on an invalid, expired, revoked or superseded GET (%s)', async status => {
  api.get.mockRejectedValue({ response: { status, data: { error: route.token } } }); render(<ApprovalPortal />)
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired, revoked or superseded')
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Download quote PDF' })).not.toBeInTheDocument()
})
it('retries failed GET and refuses a receipt whose immutable binding does not match', async () => {
  api.get.mockRejectedValueOnce(new Error('Network')); render(<ApprovalPortal />); await screen.findByRole('alert'); click('Reload approval link')
  await screen.findByRole('article'); cleanup(); dto.receipt = makeReceipt(dto, { quote_hash: 'wrong-hash' }); render(<ApprovalPortal />)
  await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
it('discards a late GET from a previous token and clears displayed quote immediately on token change', async () => {
  let finish; api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { rerender } = render(<ApprovalPortal />); const old = dto; dto = projection('r2'); route.token = `pe_${'2'.repeat(64)}`; rerender(<ApprovalPortal />)
  await screen.findByRole('article', { name: 'Customer quote' }); expect(screen.getByRole('article')).toHaveTextContent('Revision r2'); await act(async () => finish({ data: old }))
  expect(screen.queryByText(/Revision r1/)).not.toBeInTheDocument()
  api.get.mockImplementation(() => new Promise(() => {})); route.token = `pe_${'3'.repeat(64)}`; rerender(<ApprovalPortal />)
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByText('Loading')).toBeInTheDocument()
})
it('discards a late POST receipt from a previous token', async () => {
  const { rerender } = await mount(); change('Your full name', 'Synthetic Customer'); acknowledge(); const old = dto; let finish
  api.post.mockImplementation(() => new Promise(resolve => { finish = resolve })); click('Approve this revision')
  dto = projection('r2'); route.token = `pe_${'2'.repeat(64)}`; rerender(<ApprovalPortal />); await screen.findByRole('article')
  await act(async () => finish({ data: { ...old, receipt: makeReceipt(old) } }))
  expect(screen.queryByText('Approved by Synthetic Customer')).not.toBeInTheDocument(); expect(screen.getByLabelText('Your full name')).toHaveValue('')
})
it('downloads guarded PDF as a blob, revokes its URL, and suppresses late PDF side effects', async () => {
  const { rerender } = await mount(); const blob = new Blob(['%PDF synthetic'], { type: 'application/pdf' })
  api.get.mockResolvedValueOnce({ data: blob }); click('Download quote PDF'); await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(blob))
  expect(api.get).toHaveBeenLastCalledWith(`/approval/${route.token}/pdf`, { responseType: 'blob' }); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:quote')
  let finish; api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Download quote PDF')
  route.token = `pe_${'2'.repeat(64)}`; dto = projection('r2'); rerender(<ApprovalPortal />); await screen.findByRole('article')
  await act(async () => finish({ data: blob })); expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
})
it('removes response controls when the server rejects PDF access', async () => {
  await mount(); api.get.mockRejectedValueOnce({ response: { status: 410, data: new Blob() } }); click('Download quote PDF')
  expect(await screen.findByRole('alert')).toHaveTextContent('expired, revoked or superseded'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
it('preserves legacy approval payload and successful legacy branch', async () => {
  route.token = 'legacy-link'; dto = { ro: { labor_cost: 100, parts_cost: 50, tax: 15, total: 165 }, shop: { name: 'Synthetic Shop' }, vehicle: { year: 2020, make: 'Test', model: 'Sedan' }, customer: { name: 'Legacy Customer' } }
  render(<ApprovalPortal />); await screen.findByText('Legacy Customer'); click('Approve Estimate')
  await screen.findByText('Estimate approved'); expect(api.post).toHaveBeenCalledWith('/approval/legacy-link/respond', { decision: 'approve', reason: undefined })
  expect(screen.queryByLabelText('Your full name')).not.toBeInTheDocument()
})
it('preserves legacy decline validation and request payload', async () => {
  route.token = 'legacy-link'; dto = { ro: { total: 100 } }; render(<ApprovalPortal />); await screen.findByLabelText('Change request note')
  click('Request changes'); expect(api.post).not.toHaveBeenCalled(); change('Change request note', 'Review bumper'); click('Request changes')
  await screen.findByText('Changes requested'); expect(api.post).toHaveBeenCalledWith('/approval/legacy-link/respond', { decision: 'decline', reason: 'Review bumper' })
})

it('refuses missing hash bindings and a nonmatching successful response receipt', async () => {
  const validDto = dto; dto = { ...dto, quote_hash: undefined, quote: { ...dto.quote, quote_hash: undefined } }
  render(<ApprovalPortal />); await screen.findByRole('alert'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); cleanup()
  dto = validDto; await mount(); change('Your full name', 'Synthetic Customer'); acknowledge()
  api.post.mockResolvedValueOnce({ data: { ...dto, receipt: makeReceipt(dto, { decision: 'decline', reason: 'A different decision' }) } }); click('Approve this revision')
  expect(await screen.findByRole('alert')).toHaveTextContent('did not return a matching decision receipt'); expect(screen.queryByText('Approved by Synthetic Customer')).not.toBeInTheDocument()
})
