import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock('../../lib/auth', () => ({ getRole: vi.fn(() => 'owner'), isAdmin: vi.fn(() => true) }))
import api from '../../lib/api'
import { getRole, isAdmin } from '../../lib/auth'
import PanelEstimator from '../PanelEstimator'
const base = '/estimate-items/ro-1/panel-estimator'
const panel = () => ({ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light', operation: 'repair', body_hours: 2, refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0, photo_ids: ['photo-1'], reviewed: true, customer_notes: '' })
const state = (assessments = []) => ({ version: 1, assessments, scenarios: [{ payer: 'cash', provenance: 'shop_prepared', allocation: null }], presets: [], active_revision_id: null })
const calculated = () => ({ version: 1, input_hash: 'hash-1', review_flags: [], quote: { lines: [], totals: { net_cents: 40000, tax_cents: 4000, total_cents: 44000 } } })
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const click = name => fireEvent.click(screen.getByRole('button', { name }))
async function mount(data = state()) { api.get.mockResolvedValue({ data }); const result = render(<PanelEstimator roId="ro-1" vehicle="2020 Test Sedan" photos={[{ id: 'photo-1', label: 'Hood photo' }]} />); await screen.findByText('1. Select damaged panels'); return result }
beforeEach(() => { vi.clearAllMocks(); getRole.mockReturnValue('owner'); isAdmin.mockReturnValue(true) })
afterEach(cleanup)
it('keyboard selects and edits real panel inputs, retains edits on canceled removal and saves/reloads the exact API draft', async () => {
  let saved = state()
  api.put.mockImplementation(async (url, body) => { saved = { ...saved, version: 2, assessments: body.assessments, scenario: body.scenario }; return { data: saved } })
  const { container, unmount } = await mount()
  fireEvent.click(screen.getByText('Select panels with keyboard'))
  const hood = screen.getByRole('checkbox', { name: 'Hood', exact: true }); hood.focus(); await userEvent.keyboard(' ')
  expect(screen.getByRole('button', { name: 'Hood Incomplete' })).toBeInTheDocument()
  change('Body style', 'sedan'); change('Severity', 'heavy'); change('Operation', 'repair'); change('Body hours', '2.5'); change('Materials sell ($)', '45.25')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hood photo' }))
  click('Remove Hood'); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); click('Keep editing')
  expect(screen.getByLabelText('Body hours')).toHaveValue(2.5)
  click('Cancel unsaved changes'); click('Keep editing')
  click('Save draft')
  await screen.findByText(/Draft saved/)
  expect(api.put).toHaveBeenCalledWith(`${base}/draft`, expect.objectContaining({ expected_version: 1, scenario: expect.objectContaining({ payer: 'cash' }), assessments: [expect.objectContaining({ severity: 'heavy', body_hours: 2.5, materials_sell_cents: 4525, body_rate_cents: null, photo_ids: ['photo-1'] })] }))
  expect(container.querySelector('.xl\\:grid-cols-\\[minmax\\(240px\\,0\\.85fr\\)_minmax\\(280px\\,1\\.2fr\\)_minmax\\(240px\\,0\\.85fr\\)\\]')).toBeTruthy()
  unmount(); await mount(saved); click('Hood Incomplete'); expect(screen.getByLabelText('Body hours')).toHaveValue(2.5)
})
it('invalidates preview on edits and blocks inspection commits', async () => {
  api.post.mockResolvedValue({ data: calculated() }); await mount(state([panel()])); click('Preview calculation'); await screen.findByText('Calculated sell preview')
  click('Hood Reviewed'); change('Severity', 'moderate'); expect(screen.queryByText('Calculated sell preview')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Commit reviewed draft' })).toBeDisabled()
  change('Operation', 'inspection-required'); expect(screen.getByText(/Inspection required — this scope/)).toBeInTheDocument()
  expect(screen.getByLabelText('I reviewed this panel’s inputs and applicability')).toBeDisabled()
})
it('blocks duplicate clicks, reuses idempotency after ambiguous failure, and fetches customer quote separately', async () => {
  let rejectCommit
  api.post.mockImplementation((url) => url.endsWith('/preview') ? Promise.resolve({ data: calculated() }) : new Promise((resolve, reject) => { rejectCommit = reject }))
  await mount(state([panel()])); click('Preview calculation'); await screen.findByText('Calculated sell preview'); fireEvent.click(screen.getByLabelText('I reviewed this calculated draft'))
  click('Commit reviewed draft'); click('Commit reviewed draft')
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/commit'))).toHaveLength(1)
  const key = api.post.mock.calls[1][1].idempotency_key
  await act(async () => rejectCommit(new Error('network failure')))
  expect(await screen.findByRole('alert')).toHaveTextContent('local edits are preserved')
  api.post.mockResolvedValue({ data: { revision_id: 'r1', version: 2 } }); click('Retry'); await screen.findByText(/Reviewed revision saved/)
  expect(api.post.mock.calls[2][1].idempotency_key).toBe(key)
  api.get.mockResolvedValue({ data: { revision_id: 'r1', vehicle: 'Fetched vehicle', lines: [], totals: {}, allocation: {} } }); click('Preview customer quote')
  expect(await screen.findByRole('article', { name: 'Customer quote' })).toHaveTextContent('Fetched vehicle')
  expect(api.get).toHaveBeenLastCalledWith(`${base}/quote?revision_id=r1`)
})
it('loads missing private costs separately and saves only the cost-settings contract', async () => {
  await mount(state([panel()])); api.get.mockResolvedValue({ data: { complete: false, known_subtotal_cents: 19000, direct_cost_cents: null, missing: [{ id: 'materials', reason: 'missing_unit_cost' }] } }); click('Owner cost drawer')
  expect(await screen.findByText(/Known subtotal: \$190.00/)).toBeInTheDocument(); expect(screen.getByText('materials: missing_unit_cost')).toBeInTheDocument(); expect(screen.getByText(/Gross contribution: Unknown/)).toBeInTheDocument()
  change('Materials cost ($)', '30'); change('Private cost review note / reason', 'Supplier quote'); api.put.mockResolvedValue({ data: { version: 2 } }); click('Save private cost settings')
  await screen.findByText(/Cost settings saved/)
  expect(api.put).toHaveBeenLastCalledWith(`${base}/cost-settings`, expect.objectContaining({ expected_version: 1, reason: 'Supplier quote', lines: [expect.objectContaining({ panel_id: 'hood', materials_cost_cents: 3000 })] }))
})
it.each(['technician', 'customer'])('does not request or show private costs for %s', async role => {
  getRole.mockReturnValue(role); isAdmin.mockReturnValue(false); await mount(state([panel()])); expect(screen.queryByRole('button', { name: 'Owner cost drawer' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled(); expect(api.get).toHaveBeenCalledTimes(1)
})
it('shows service failure and retries without inserting synthetic state', async () => {
  api.get.mockRejectedValueOnce(new Error('404')); render(<PanelEstimator roId="ro-1" />); expect(await screen.findByRole('alert')).toHaveTextContent('service may be unavailable'); expect(screen.queryByText('1. Select damaged panels')).not.toBeInTheDocument()
  api.get.mockResolvedValue({ data: state() }); click('Retry'); expect(await screen.findByText('1. Select damaged panels')).toBeInTheDocument()
})
it('drops an old RO response after navigation', async () => {
  let resolveOld; api.get.mockImplementation(url => url.includes('ro-1') ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ data: state() }))
  const { rerender } = render(<PanelEstimator roId="ro-1" />); rerender(<PanelEstimator roId="ro-2" />); await screen.findByText('1. Select damaged panels'); await act(async () => resolveOld({ data: state([panel()]) })); expect(screen.queryByRole('button', { name: 'Hood Reviewed' })).not.toBeInTheDocument()
})
it('switches payer without changing scope or rates and uses real photo API state', async () => {
  await mount(state([panel()])); click('Hood Reviewed'); change('Payer', 'insurance')
  expect(screen.getByLabelText('Body sell rate ($)')).toHaveValue(100)
  expect(screen.getByText('Customer responsibility: Unknown')).toBeInTheDocument()
  api.get.mockResolvedValue({ data: { photos: [{ id: 'real-photo-2', caption: 'Actual RO photo' }] } }); click('Load repair-order photos'); await screen.findByLabelText('Actual RO photo'); fireEvent.click(screen.getByLabelText('Actual RO photo'))
  change('Payer', 'cash'); api.put.mockResolvedValue({ data: state([panel()]) }); click('Save draft'); await screen.findByText(/Draft saved/)
  expect(api.get).toHaveBeenCalledWith('/photos/ro-1')
  expect(api.put).toHaveBeenLastCalledWith(`${base}/draft`, expect.objectContaining({ scenario: expect.objectContaining({ payer: 'cash', allocation: null }), assessments: [expect.objectContaining({ body_rate_cents: 10000, photo_ids: ['photo-1', 'real-photo-2'] })] }))
})
it('retains edited inputs on a version conflict until explicit discard', async () => {
  await mount(state([panel()])); click('Hood Reviewed'); change('Body hours', '5'); api.put.mockRejectedValue({ response: { status: 409 } }); click('Save draft'); expect(await screen.findByRole('alert')).toHaveTextContent('changed on the server')
  expect(screen.getByLabelText('Body hours')).toHaveValue(5); click('Reload saved draft'); click('Keep editing'); expect(screen.getByLabelText('Body hours')).toHaveValue(5)
  click('Reload saved draft'); click('Discard and reload'); await waitFor(() => expect(screen.getByLabelText('Body hours')).toHaveValue(2))
})
