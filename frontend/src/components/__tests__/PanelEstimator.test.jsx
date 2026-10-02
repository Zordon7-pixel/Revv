import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock('../../lib/auth', () => ({ getRole: vi.fn(() => 'owner') }))
import api from '../../lib/api'
import { getRole } from '../../lib/auth'
import PanelEstimator from '../PanelEstimator'
import VehicleDiagram from '../VehicleDiagram'

// Contract tests use the production normalizers, assembler and hashes. Transport is
// stubbed here; these tests are not HTTP/DB/browser receipt coverage.
const require = createRequire(import.meta.url)
const n = require('../../../../backend/src/services/panelEstimatorStore.js')
const { assembleDraft, hashInputs } = require('../../../../backend/src/services/panelEstimatorDraft.js')
const { normalizePreset, safeSnapshot } = require('../../../../backend/src/services/panelEstimatorPresets.js')
const base = '/estimate-items/ro-1/panel-estimator'
const panel = (extra = {}) => n.assessments([{ panel_id: 'hood', label: 'Hood', body_style: 'sedan', severity: 'light', operation: 'repair', refinish: true, body_hours: 2, refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0, taxable: { body: true, refinish: true, parts: true, materials: true, sublet: false }, photo_ids: ['photo-1'], reviewed: true, customer_notes: '', ...extra }])[0]
const state = (assessments = []) => ({ version: 1, ...n.publicSnapshot({ assessments }), presets: [], active_revision_id: null })
const preset = (extra = {}) => {
  const p = panel()
  const normalized = normalizePreset({ contract_version: 1, name: 'Hood refinish', match: { panel_id: 'hood', body_style: 'sedan', operation: 'repair', severity: 'light', area: 'upper', paint_system: 'Waterborne' }, sell_settings: { ...Object.fromEntries(['body_hours', 'refinish_hours', 'refinish', ...n.SELL, 'taxable', 'package', 'extras', 'materials_pricing'].map(key => [key, p[key]])), minimum_cents: 70000, override_policy: 'owner_admin', ...extra }, private_cost_config: {}, reason: 'Explicit shop setup' })
  return { ...safeSnapshot({ ...normalized, id: 'version-1', family_id: 'family-1', version: 1 }), archived: false }
}
let saved, privateSaved
function previewOf(body = saved) {
  const draft = n.publicSnapshot(body)
  const quote = assembleDraft({ draft, costs: privateSaved, taxRateBps: 1000, paidCents: 0 }).sell
  return { version: saved.version, input_hash: hashInputs({ draft, costs: privateSaved }), quote, review_flags: quote.review_flags }
}
function privateResult() {
  const costs = assembleDraft({ draft: n.publicSnapshot(saved), costs: privateSaved, taxRateBps: 1000, paidCents: 0 }).costs
  return { version: saved.version, input_hash: previewOf().input_hash, costs: { ...costs, settings: { version: saved.version, ...privateSaved } } }
}
const change = (name, value, scope = screen) => fireEvent.change(scope.getByLabelText(name), { target: { value } })
const click = (name, scope = screen) => fireEvent.click(scope.getByRole('button', { name, exact: true }))
const check = name => fireEvent.click(screen.getByRole('checkbox', { name, exact: true }))
async function mounted(data = state([panel()]), options) { saved = data; const result = render(<PanelEstimator roId="ro-1" photos={[{ id: 'photo-1', label: 'Hood photo' }]} />, options); await screen.findByText('1. Select damaged panels'); return result }
async function saveDraft() { click('Save draft'); await screen.findByText(/Draft saved\./) }
async function calculate() { click('Preview calculation'); await screen.findByText('Calculated sell preview') }
beforeEach(() => {
  vi.clearAllMocks(); getRole.mockReturnValue('owner'); vi.stubGlobal('confirm', vi.fn(() => false))
  privateSaved = n.privateSnapshot({ lines: [], target_margin_bps: null, overhead_cents: null })
  saved = state([panel()])
  api.get.mockImplementation(async url => ({ data: url.endsWith('/cost-summary') ? privateResult() : url.includes('/quote?') ? { revision_id: 'r1', quote_hash: 'a'.repeat(64), version: saved.version, quote: { ...previewOf().quote, revision_id: 'r1', quote_hash: 'a'.repeat(64), reviewed: true } } : url === '/estimate-items/panel-presets' ? { presets: saved.presets } : saved }))
  api.put.mockImplementation(async (url, body) => {
    if (body.expected_version !== saved.version) throw { response: { status: 409, data: { error: 'VERSION_CONFLICT' } } }
    if (url.endsWith('/cost-settings')) { privateSaved = n.privateSnapshot(body); saved = { ...saved, version: saved.version + 1 }; return { data: { version: saved.version } } }
    saved = { ...saved, ...n.publicSnapshot(body), version: saved.version + 1 }
    const { presets, ...response } = saved // PUT really omits catalog.
    return { data: response }
  })
  api.post.mockImplementation(async (url, body) => {
    if (url.endsWith('/preview')) return { data: previewOf(body) }
    if (url.endsWith('/commit')) { saved = { ...saved, ...n.publicSnapshot(body), version: saved.version + 1, active_revision_id: 'r1' }; return { data: { revision_id: 'r1', version: saved.version } } }
    throw new Error('Unexpected route')
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('opens the first saved assessment, focuses selection, reopens SVG selection and confirms explicit removal', async () => {
  const { container } = await mounted()
  expect(screen.getByLabelText('Body hours')).toHaveValue(2)
  const choice = screen.getByRole('button', { name: 'Hood Editing Reviewed' }); choice.focus(); fireEvent.click(choice)
  await waitFor(() => expect(screen.getByRole('heading', { name: /2. Configure panel work/ })).toHaveFocus())
  expect(choice).toHaveAttribute('aria-current', 'true')
  click('Close panel editor'); expect(choice).toHaveFocus()
  expect(choice).not.toHaveAttribute('aria-current'); expect(choice).toHaveTextContent('Reviewed'); expect(choice).not.toHaveTextContent('Editing')
  fireEvent.click(container.querySelector('svg [aria-label="Hood"]'))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(screen.getByLabelText('Body hours')).toHaveValue(2)
  const remove = screen.getByRole('button', { name: 'Remove selected panel' }); remove.focus(); fireEvent.click(remove)
  expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus(); click('Keep editing'); expect(remove).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Hood Editing Reviewed' })).toBeInTheDocument()
})
it('preserves the legacy diagram toggle contract and keyboard selection', async () => {
  const onChange = vi.fn(); const { container, unmount } = render(<VehicleDiagram value={['hood']} onChange={onChange} />)
  fireEvent.click(container.querySelector('svg [aria-label="Hood"]')); expect(onChange).toHaveBeenCalledWith([]); unmount()
  await mounted(state()); fireEvent.click(screen.getByText('Select panels with keyboard'))
  screen.getByRole('checkbox', { name: 'Hood', exact: true }).focus(); await userEvent.keyboard(' ')
  expect(screen.getByLabelText('Body hours')).toHaveValue(null)
})
it('saves and reloads manual tax, exclusive quantity/rate materials, mixed package allocations and distinct/shared extras through real normalizers', async () => {
  const { unmount } = await mounted()
  change('Materials pricing method', 'quantity_rate'); expect(screen.queryByLabelText('Materials sell ($)')).not.toBeInTheDocument()
  change('Materials quantity', '2.5'); change('Materials unit rate ($)', '12.35'); change('Parts tax treatment', 'false')
  check('Use one fixed package price'); change('Package name', 'Repair and parts'); change('Package price ($)', '350')
  check('Include Body labor'); check('Include Parts'); check('Allocate package selling price by category')
  change('Body labor package allocation ($)', '250'); change('Parts package allocation ($)', '100')
  click('Add extra operation'); change('Operation key', 'mask'); change('Operation scope', 'job'); change('Extra category', 'refinish'); change('Extra description', 'Shared masking'); change('Extra quantity', '1'); change('Extra unit price ($)', '20'); change('Extra tax treatment', 'true')
  click('Add extra operation')
  const extras = screen.getAllByRole('group', { name: /Extra operation \d/ }); const second = within(extras[1])
  change('Operation key', 'remove_trim', second); change('Operation scope', 'hood', second); change('Extra category', 'body', second); change('Extra description', 'Removal and reinstallation', second); change('Extra quantity', '1.5', second); change('Extra unit price ($)', '30', second); change('Extra tax treatment', 'false', second)
  check('I reviewed this panel’s inputs and applicability'); await saveDraft()
  expect(saved.assessments[0]).toMatchObject({ materials_sell_cents: null, materials_pricing: { method: 'quantity_rate', quantity: 2.5, unit_rate_cents: 1235 }, package: { name: 'Repair and parts', price_cents: 35000, taxable: null, included_operations: ['body', 'parts'], sell_allocation_cents: { body: 25000, parts: 10000 } }, taxable: { parts: false, sublet: false }, extras: expect.arrayContaining([expect.objectContaining({ key: 'mask', scope: 'job', unit_price_cents: 2000 }), expect.objectContaining({ key: 'remove_trim', scope: 'hood', quantity: 1.5 })]) })
  const reload = saved; unmount(); await mounted(reload)
  expect(screen.getByLabelText('Materials quantity')).toHaveValue(2.5); expect(screen.getByLabelText('Parts package allocation ($)')).toHaveValue(100)
  await calculate(); expect(previewOf().quote.complete).toBe(true); expect(screen.getByLabelText('Calculated packages')).toHaveTextContent('One package price before discounts: $350.00'); expect(screen.getByLabelText('Calculated packages')).toHaveTextContent('Tax allocation within this price: Body labor $250.00; Parts $100.00')
})
it('requires a tax choice for zero categories and never turns absent prices into zero', async () => {
  await mounted(state([panel({ taxable: { body: true, refinish: true, parts: true, materials: true, sublet: null }, materials_sell_cents: null })]))
  expect(screen.getByLabelText('I reviewed this panel’s inputs and applicability')).toBeDisabled()
  change('Sublet tax treatment', 'false'); expect(screen.getByLabelText('Materials sell ($)')).toHaveValue(null)
  await calculate(); expect(screen.getByRole('button', { name: 'Commit reviewed draft' })).toBeDisabled()
  expect(screen.getByText(/Missing materials inputs/)).toBeInTheDocument()
})
it('applies safe preset match/sell inputs, keeps version identity and policy outside assessments, and preserves catalog after PUT', async () => {
  const item = preset(); await mounted({ ...state([panel()]), presets: [item] })
  change('Shop preset', item.id)
  expect(screen.getByLabelText('Damage area')).toHaveValue('upper'); expect(screen.getByLabelText('Paint system (optional match)')).toHaveValue('Waterborne')
  expect(screen.getByLabelText('Body hours')).toBeDisabled(); change('Customer-safe preset override reason', 'Additional access work'); expect(screen.getByLabelText('Body hours')).not.toBeDisabled()
  change('Body hours', '3'); await saveDraft()
  const payload = api.put.mock.calls[0][1].assessments[0]
  expect(payload.preset_version_id).toBe('version-1'); expect(payload.preset_override).toEqual({ reason: 'Additional access work' })
  expect(payload).not.toHaveProperty('minimum_cents'); expect(payload).not.toHaveProperty('override_policy')
  expect(payload.application_snapshot.id).toBe('version-1'); expect(screen.getByLabelText('Shop preset')).toHaveValue('version-1')
  expect(api.get.mock.calls.some(([url]) => /cost/.test(url))).toBe(false)
})
it('locks controlled edits and retains an archived historical application without offering it to other panels', async () => {
  const item = preset({ override_policy: 'locked' }); item.archived = true
  const historical = panel({ ...item.sell_settings, ...item.match, preset_version_id: item.id, application_snapshot: item })
  await mounted({ ...state([historical]), presets: [item] })
  expect(screen.getByLabelText('Body hours')).toBeDisabled(); expect(screen.queryByLabelText('Customer-safe preset override reason')).not.toBeInTheDocument()
  expect(screen.getByText(/Retained historical application/)).toBeInTheDocument()
  change('Shop preset', ''); expect(screen.getByLabelText('Body hours')).not.toBeDisabled(); expect(screen.queryByRole('option', { name: /Hood refinish/ })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Body hours')).toHaveValue(2)
})
it.each(['incomplete_insurance_allocation', 'missing_posted_payments'])('permits complete warning-only %s while sending the server-reviewed hash', async code => {
  await mounted(state([panel()])); api.post.mockImplementation(async (url, body) => url.endsWith('/preview') ? { data: { ...previewOf(body), quote: { ...previewOf(body).quote, review_flags: [{ panel_id: null, code }], complete: true } } } : { data: { revision_id: 'r1', version: 2 } })
  await calculate(); check('I reviewed this calculated draft'); expect(screen.getByRole('button', { name: 'Commit reviewed draft' })).not.toBeDisabled(); click('Commit reviewed draft'); await screen.findByText(/Reviewed revision saved\. Customer response/)
  expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ reviewed: true, input_hash: expect.stringMatching(/^[a-f0-9]{64}$/), expected_version: 1 })
})
it.each([{ code: 'unreviewed', complete: true }, { code: 'new_server_block', complete: true }, { code: 'incomplete_insurance_allocation', complete: false }])('blocks server flag/completeness $code $complete', async ({ code, complete }) => {
  await mounted(); api.post.mockResolvedValue({ data: { ...previewOf(), quote: { ...previewOf().quote, complete, review_flags: [{ code }] } } }); await calculate(); expect(screen.getByLabelText('I reviewed this calculated draft')).toBeDisabled()
})
it('keeps explicit insurance values, null unknowns, provenance and scope on payer changes', async () => {
  await mounted(); change('Payer', 'insurance'); change('Estimate provenance', 'imported_carrier'); change('Covered amount before deductible ($)', '400'); change('Applicable deductible ($)', '50'); change('Coverage reduction / adjustment ($)', '0')
  expect(screen.getByLabelText('Uncovered charges ($)')).toHaveValue(null); change('Payer', 'cash'); change('Payer', 'insurance'); expect(screen.getByLabelText('Applicable deductible ($)')).toHaveValue(50)
  await saveDraft(); expect(saved.scenario).toEqual({ payer: 'insurance', provenance: 'imported_carrier', allocation: { covered_cents: 40000, deductible_cents: 5000, uncovered_cents: null, adjustment_cents: 0 } }); expect(saved.assessments[0].body_rate_cents).toBe(10000)
  expect(JSON.stringify(api.put.mock.calls)).not.toContain('carrier_approved')
})
it('uses exact server targets for scoped/global discounts and estimate minimum', async () => {
  await mounted(); await calculate(); click('Add scoped discount'); change('Discount ID', 'body_discount'); change('Scoped discount amount ($)', '10'); check('Hood · Body labor · Hood'); change('Global discount ($)', '5'); change('Estimate minimum ($)', '200'); await saveDraft()
  expect(saved.adjustments).toEqual({ discount_cents: 500, minimum_cents: 20000, discounts: [{ id: 'body_discount', amount_cents: 1000, line_ids: ['hood:body'], package_ids: [] }] })
  await calculate(); expect(screen.getByText('Calculated sell preview')).toBeInTheDocument()
})
it('loads complete private saved settings only on explicit request, retains both dirty domains and increments the shared version', async () => {
  const extra = { key: 'mask', scope: 'job', category: 'body', description: 'Mask', quantity: 1, unit_price_cents: 1000, taxable: true }
  privateSaved = n.privateSnapshot({ lines: [{ panel_id: 'hood', body_cost_rate_cents: 4000, refinish_cost_rate_cents: 4000, parts_cost_cents: 7000, materials_cost_cents: 3000, sublet_cost_cents: 0, cost_sources: { body_cost_rate_cents: 'estimated', materials_cost_cents: 'quoted', parts_cost_cents: 'actual' }, extras: [{ key: 'mask', scope: 'job', cost_unit_cents: 500, cost_source: 'quoted' }], private_notes: 'Panel vendor note' }], private_notes: 'Shop-only note', target_margin_bps: 4000, overhead_cents: 2000, include_overhead_in_target: true, reason: 'Old audit' })
  await mounted(state([panel({ extras: [extra] })])); expect(api.get).toHaveBeenCalledTimes(1); click('Owner cost drawer'); const drawer = within(await screen.findByRole('region', { name: 'Private owner costs' }))
  expect(drawer.getByLabelText('Materials cost ($)')).toHaveValue(30); expect(drawer.getByLabelText('Materials cost source')).toHaveValue('quoted'); expect(drawer.getByLabelText('Private estimate notes')).toHaveValue('Shop-only note'); expect(drawer.getByLabelText('Private panel notes')).toHaveValue('Panel vendor note'); expect(drawer.getByLabelText('Include allocated overhead in target margin price')).toBeChecked()
  change('Customer-visible notes', 'Unsaved public scope'); change('Materials cost ($)', '35', drawer); change('Extra unit cost ($)', '7', drawer); change('Extra cost source', 'actual', drawer); change('Private estimate notes', 'Updated shop note', drawer); change('Private cost audit reason', 'Confirmed supplier quote', drawer)
  click('Close cost drawer'); expect(screen.getByRole('button', { name: 'Preview calculation' })).toBeDisabled(); click('Owner cost drawer'); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(35)
  const before = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(before); expect(before.defaultPrevented).toBe(true)
  click('Save private cost settings'); await screen.findByText(/Cost settings saved/)
  expect(screen.getByLabelText('Customer-visible notes')).toHaveValue('Unsaved public scope'); expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  expect(privateSaved.lines[0]).toMatchObject({ extras: [{ key: 'mask', scope: 'job', cost_unit_cents: 700, cost_source: 'actual' }], materials_cost_cents: 3500, cost_sources: { parts_cost_cents: 'actual' }, private_notes: 'Panel vendor note' })
  expect(privateSaved).toMatchObject({ private_notes: 'Updated shop note', target_margin_bps: 4000, overhead_cents: 2000, include_overhead_in_target: true })
  await saveDraft(); expect(api.put.mock.calls.at(-1)[1].expected_version).toBe(2)
  click('Reload private costs'); await screen.findByText('Cost inputs complete'); expect(screen.getByLabelText('Extra unit cost ($)')).toHaveValue(7)
  await calculate(); expect(screen.getByText(/Selling price meets the target floor/)).toBeInTheDocument()
})
it('retains unsaved private fields across public save and refuses silent private reload', async () => {
  await mounted(); click('Owner cost drawer'); await screen.findByLabelText('Private cost audit reason'); change('Materials cost ($)', '17'); change('Private cost audit reason', 'Review'); change('Body hours', '3'); await saveDraft()
  expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(17); click('Reload private costs'); expect(window.confirm).toHaveBeenCalled(); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(17)
  click('Cancel unsaved changes'); click('Keep editing'); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(17)
})
it.each(['assistant', 'technician', 'customer', 'employee', 'staff', 'superadmin'])('denies private/catalog controls for exact role %s', async role => {
  getRole.mockReturnValue(role); await mounted(); expect(screen.queryByRole('button', { name: 'Owner cost drawer' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Manage owner presets' })).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Optional cosmetic work' })).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(1); if (role !== 'assistant') expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
})
it('retains eligible cosmetic deferrals with both acknowledgements and a reference, keeping reviewed fields unchanged', async () => {
  await mounted(state([panel({ operation: 'paint-only', body_hours: 0, parts_sell_cents: 0, sublet_sell_cents: 0, optional_cosmetic: true })])); check('Defer and retain this cosmetic assessment'); change('Deferral reason', 'Customer defers cosmetic finish'); change('Customer acknowledgement reference', 'RO note, October 1'); check('I acknowledge this retained deferral as estimator'); check('I recorded the customer acknowledgement at the reference above')
  await saveDraft(); expect(saved.assessments).toHaveLength(1); expect(saved.assessments[0]).toMatchObject({ reviewed: true, optional_cosmetic: true, deferral: { reason: 'Customer defers cosmetic finish', estimator_acknowledged: true, customer_acknowledged: true, customer_acknowledgement_reference: 'RO note, October 1' } }); expect(screen.getByLabelText('Body hours')).toBeDisabled()
  expect(screen.getByText(/not digital approval, signature or carrier authorization/)).toBeInTheDocument()
})
it('disables optional classification for required work and renders scope conflicts while retaining edits', async () => {
  await mounted(); expect(screen.getByLabelText('Classify as optional cosmetic work')).toBeDisabled(); change('Body hours', '1'); api.put.mockRejectedValue({ response: { status: 409, data: { error: 'SCOPE_RECONCILIATION_REQUIRED' } } }); click('Save draft'); expect(await screen.findByRole('alert')).toHaveTextContent('Required or previously selected work'); expect(screen.getByLabelText('Body hours')).toHaveValue(1)
})
it('guards BrowserRouter links with public or private dirty inputs without requiring a data router', async () => {
  window.history.replaceState({ idx: 0 }, '', '/')
  render(<BrowserRouter><Link to="/away">Leave estimator</Link><Routes><Route path="/" element={<PanelEstimator roId="ro-1" />} /><Route path="/away" element={<p>Other page</p>} /></Routes></BrowserRouter>)
  await screen.findByText('1. Select damaged panels'); click('Owner cost drawer'); await screen.findByLabelText('Materials cost ($)'); change('Materials cost ($)', '10'); fireEvent.click(screen.getByRole('link', { name: 'Leave estimator' })); expect(window.confirm).toHaveBeenCalled(); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(10)
  window.confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('link', { name: 'Leave estimator' })); expect(await screen.findByText('Other page')).toBeInTheDocument(); window.history.replaceState(null, '', '/')
})
it('blocks duplicate submits and reuses commit idempotency after ambiguous failure; quote uses its actual envelope', async () => {
  await mounted(); await calculate(); check('I reviewed this calculated draft'); let rejectCommit
  api.post.mockImplementation(() => new Promise((resolve, reject) => { rejectCommit = reject })); click('Commit reviewed draft'); click('Commit reviewed draft'); const commitCalls = api.post.mock.calls.filter(([url]) => url.endsWith('/commit')); expect(commitCalls).toHaveLength(1); const key = commitCalls[0][1].idempotency_key
  await act(async () => rejectCommit(new Error('Network'))); expect(await screen.findByRole('alert')).toHaveTextContent('local edits are preserved')
  api.post.mockResolvedValue({ data: { revision_id: 'r1', version: 2 } }); click('Retry'); await screen.findByText(/Reviewed revision saved\. Customer response/); expect(api.post.mock.calls.at(-1)[1].idempotency_key).toBe(key)
  click('Preview customer quote'); expect(await screen.findByRole('article', { name: 'Customer quote' })).toHaveTextContent('Revision 1'); expect(api.get).toHaveBeenLastCalledWith(`${base}/quote?revision_id=r1`)
})
it('retains edits on version conflict and discards only after explicit reload confirmation', async () => {
  await mounted(); change('Body hours', '5'); api.put.mockRejectedValue({ response: { status: 409, data: { error: 'VERSION_CONFLICT' } } }); click('Save draft'); expect(await screen.findByRole('alert')).toHaveTextContent('changed on the server'); click('Reload saved draft'); click('Keep editing'); expect(screen.getByLabelText('Body hours')).toHaveValue(5); click('Reload saved draft'); click('Discard and reload'); await waitFor(() => expect(screen.getByLabelText('Body hours')).toHaveValue(2))
})
it('retries load errors without synthetic state and drops late responses from the previous RO', async () => {
  api.get.mockRejectedValueOnce(new Error('Unavailable')); const { rerender } = render(<PanelEstimator roId="ro-1" />); expect(await screen.findByRole('alert')).toHaveTextContent('service may be unavailable'); expect(screen.queryByText('1. Select damaged panels')).not.toBeInTheDocument(); click('Retry'); await screen.findByText('1. Select damaged panels')
  let resolveOld; api.get.mockImplementation(url => url.includes('ro-2') ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ data: state() })); rerender(<PanelEstimator roId="ro-2" />); rerender(<PanelEstimator roId="ro-3" />); await screen.findByText('1. Select damaged panels'); await act(async () => resolveOld({ data: state([panel()]) })); expect(screen.queryByRole('button', { name: 'Hood Editing Reviewed' })).not.toBeInTheDocument()
})
it('does not unlock preset pricing or read private config for an assistant', async () => {
  getRole.mockReturnValue('assistant'); const item = preset(); await mounted({ ...state([panel()]), presets: [item] }); change('Shop preset', item.id)
  expect(screen.getByLabelText('Body hours')).toBeDisabled(); expect(screen.queryByLabelText('Customer-safe preset override reason')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(1)
  change('Shop preset', ''); expect(screen.getByLabelText('Body hours')).not.toBeDisabled()
})
it('renders a below-floor warning from matching server results and clears that comparison after an edit', async () => {
  privateSaved = n.privateSnapshot({ lines: [{ panel_id: 'hood', body_cost_rate_cents: 8000, refinish_cost_rate_cents: 8000, parts_cost_cents: 15000, materials_cost_cents: 5000, sublet_cost_cents: 0 }], overhead_cents: 0, target_margin_bps: 5000 })
  await mounted(); click('Owner cost drawer'); await screen.findByText('Cost inputs complete'); await calculate(); expect(screen.getByText('Selling price is below the target floor.')).toBeInTheDocument()
  change('Body hours', '3'); expect(screen.queryByText('Selling price is below the target floor.')).not.toBeInTheDocument(); expect(screen.getByText(/local edits are not included/)).toBeInTheDocument()
})
it('discards a late private response when moving to another RO', async () => {
  const { rerender } = await mounted(); let finish
  api.get.mockImplementation(url => url.endsWith('/cost-summary') ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ data: state() }))
  click('Owner cost drawer'); const old = privateResult(); old.costs.settings.private_notes = 'Old RO private note'
  rerender(<PanelEstimator roId="ro-2" />); await screen.findByText('1. Select damaged panels'); await act(async () => finish({ data: old }))
  expect(screen.queryByRole('region', { name: 'Private owner costs' })).not.toBeInTheDocument(); expect(screen.queryByText('Old RO private note')).not.toBeInTheDocument()
})
it('switching materials back to explicit requires a newly entered amount and omits quantity/rate settings', async () => {
  await mounted(); change('Materials pricing method', 'quantity_rate'); change('Materials quantity', '2'); change('Materials unit rate ($)', '10'); change('Materials pricing method', 'explicit'); expect(screen.getByLabelText('Materials sell ($)')).toHaveValue(null); expect(screen.queryByLabelText('Materials quantity')).not.toBeInTheDocument(); change('Materials sell ($)', '0'); await saveDraft(); expect(saved.assessments[0]).toMatchObject({ materials_sell_cents: 0, materials_pricing: { method: 'explicit' } })
})
it('retains catalog dirty state in navigation guards and forbids closing it during an active write', async () => {
  await mounted(); click('Manage owner presets'); await screen.findByRole('button', { name: 'Create preset from current panel settings' }); await waitFor(() => expect(screen.queryByText('Load catalog…')).not.toBeInTheDocument()); click('Create preset from current panel settings')
  change('Preset name', 'Pending catalog'); change('Catalog audit reason', 'New shop version'); check('I reviewed these private costs; blanks remain unknown, not free')
  const before = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(before); expect(before.defaultPrevented).toBe(true)
  click('Close preset catalog'); expect(screen.getByLabelText('Preset name')).toHaveValue('Pending catalog')
  let resolve; api.post.mockImplementation(() => new Promise(done => { resolve = done })); click('Create preset family'); expect(screen.getByRole('button', { name: 'Close preset catalog' })).toBeDisabled()
  await act(async () => resolve({ data: preset() })); await screen.findByText(/immutable version 1/)
})
it('cancels native BrowserRouter back without dropping local fields or adding a history entry', async () => {
  window.history.replaceState({ idx: 2 }, '', '/')
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  render(<BrowserRouter><PanelEstimator roId="ro-1" /></BrowserRouter>); await screen.findByText('1. Select damaged panels'); change('Customer-visible notes', 'Keep this local work')
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } })))
  expect(go).toHaveBeenCalledWith(1); expect(window.confirm).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Customer-visible notes')).toHaveValue('Keep this local work')
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 2 } })))
  expect(window.confirm).toHaveBeenCalledTimes(1); window.history.replaceState(null, '', '/')
})

it('discloses the server minimum adjustment and its tax without adding client charges', async () => {
  await mounted(state([panel({ taxable: { body: true, refinish: true, parts: true, materials: true, sublet: true } })])); change('Estimate minimum ($)', '500'); await calculate(); expect(screen.getByLabelText('Calculated adjustments')).toHaveTextContent('Estimate minimum adjustment: $50.00 · Tax $5.00 · Already included in totals')
})

const linkResponse = () => ({ link_id: 'link-1', revision_id: 'r1', quote_hash: 'a'.repeat(64), disclosure_version: 'panel-quote-v1', expires_at: '2026-10-08T12:00:00Z', link: `/approve/pe_${'b'.repeat(64)}` })
async function savedRevision() { await mounted({ ...state([panel()]), active_revision_id: 'r1' }); click('Preview customer quote'); await screen.findByRole('article', { name: 'Customer quote' }) }
it('issues the exact loaded revision/hash, supports manual copy/open, and revokes the exact link', async () => {
  await savedRevision(); const response = linkResponse()
  api.post.mockResolvedValueOnce({ data: response }); click('Seek customer approval'); const link = await screen.findByLabelText('Private approval link')
  expect(api.post).toHaveBeenCalledWith(`${base}/approval-link`, { revision_id: 'r1', quote_hash: 'a'.repeat(64) })
  expect(link).toHaveValue(response.link); const open = screen.getByRole('link', { name: 'Open approval link' }); expect(open).toHaveAttribute('href', response.link); expect(open).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('button', { name: 'Seek customer approval' })).toBeDisabled()
  const write = vi.fn().mockResolvedValue(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
  click('Copy approval link'); await screen.findByText(/Link copied/); expect(write).toHaveBeenCalledWith(new URL(response.link, window.location.origin).href)
  api.post.mockResolvedValueOnce({ data: { link_id: response.link_id, revoked_at: '2026-10-01T13:00:00Z' } }); click('Revoke this approval link')
  await screen.findByText(/This approval link was revoked/); expect(api.post).toHaveBeenLastCalledWith(`${base}/approval-link/link-1/revoke`, {}); expect(screen.queryByLabelText('Private approval link')).not.toBeInTheDocument()
  expect(api.post.mock.calls.some(([url]) => /sms|email|send/.test(url))).toBe(false)
})
it('blocks customer actions with public or private edits and never mixes edited scope into the saved hash', async () => {
  await savedRevision(); change('Customer-visible notes', 'New scope not committed')
  for (const name of ['Seek customer approval', 'Download quote PDF', 'Preview customer quote']) expect(screen.getByRole('button', { name })).toBeDisabled()
  expect(screen.queryByRole('article', { name: 'Customer quote' })).not.toBeInTheDocument(); click('Seek customer approval'); expect(api.post).not.toHaveBeenCalled()
  await saveDraft(); expect(screen.getByRole('button', { name: 'Seek customer approval' })).toBeDisabled()
  click('Preview customer quote'); await screen.findByRole('article'); click('Owner cost drawer'); await screen.findByLabelText('Private cost audit reason'); change('Private estimate notes', 'Unsaved private note')
  for (const name of ['Seek customer approval', 'Download quote PDF', 'Preview customer quote']) expect(screen.getByRole('button', { name })).toBeDisabled()
  expect(screen.getByLabelText('Customer-visible notes')).toHaveValue('New scope not committed')
})
it('downloads authenticated PDF and revokes the blob URL without navigating to an API URL', async () => {
  await savedRevision(); const blob = new Blob(['%PDF synthetic']); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owner-quote'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  api.get.mockResolvedValueOnce({ data: blob }); click('Download quote PDF'); await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(blob))
  expect(api.get).toHaveBeenLastCalledWith(`${base}/quote.pdf?revision_id=r1`, { responseType: 'blob' }); expect(clickAnchor).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owner-quote')
})
it('rejects unsafe or incorrectly bound returned links and gives a safe stale-hash error', async () => {
  await savedRevision(); api.post.mockResolvedValueOnce({ data: { ...linkResponse(), link: 'https://outside.invalid/secret' } }); click('Seek customer approval')
  expect(await screen.findByRole('alert')).toHaveTextContent('failed'); expect(screen.queryByRole('link', { name: 'Open approval link' })).not.toBeInTheDocument()
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'APPROVAL_REVISION_CONFLICT' } } }); click('Seek customer approval')
  expect(await screen.findByRole('alert')).toHaveTextContent('revision or quote hash changed'); expect(screen.getByLabelText('Body hours')).toHaveValue(2)
})
it('drops late quote/link/PDF responses after an RO change', async () => {
  const { rerender } = await mounted({ ...state([panel()]), active_revision_id: 'r1' }); let finish
  api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Preview customer quote'); rerender(<PanelEstimator roId="ro-2" />); await screen.findByText('1. Select damaged panels')
  await act(async () => finish({ data: { revision_id: 'r1', quote_hash: 'a'.repeat(64), quote: { ...previewOf().quote, revision_id: 'r1', quote_hash: 'a'.repeat(64) } } })); expect(screen.queryByRole('article')).not.toBeInTheDocument()
  cleanup(); await savedRevision(); api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Seek customer approval'); cleanup(); await mounted({ ...state([panel()]), active_revision_id: 'r1' })
  await act(async () => finish({ data: linkResponse() })); expect(screen.queryByLabelText('Private approval link')).not.toBeInTheDocument()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late'); api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Download quote PDF'); cleanup(); await mounted()
  await act(async () => finish({ data: new Blob() })); expect(URL.createObjectURL).not.toHaveBeenCalled()
})
it('clears quote/link binding on a new commit and never permits a second in-flight issue request', async () => {
  await savedRevision(); let finish; api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Seek customer approval'); click('Seek customer approval'); expect(api.post).toHaveBeenCalledTimes(1)
  await act(async () => finish({ data: linkResponse() })); change('Customer-visible notes', 'New reviewed scope'); expect(screen.queryByLabelText('Private approval link')).not.toBeInTheDocument()
  api.post.mockImplementation(async (url, body) => ({ data: url.endsWith('/preview') ? previewOf(body) : { revision_id: 'r2', version: 3, quote_hash: 'c'.repeat(64) } }))
  check('I reviewed this panel’s inputs and applicability'); await calculate(); check('I reviewed this calculated draft'); click('Commit reviewed draft'); await screen.findByText(/Reviewed revision saved\. Customer response/)
  expect(screen.getByRole('button', { name: 'Seek customer approval' })).toBeDisabled(); expect(screen.queryByRole('article')).not.toBeInTheDocument()
})
it('blocks actions and ignores a late link while catalog edits change the owner context', async () => {
  await savedRevision(); click('Manage owner presets'); await screen.findByRole('button', { name: 'Create preset from current panel settings' }); await waitFor(() => expect(screen.queryByText('Load catalog…')).not.toBeInTheDocument())
  let finish; api.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })); click('Seek customer approval')
  click('Create preset from current panel settings'); change('Preset name', 'Unsaved catalog change'); await act(async () => finish({ data: linkResponse() }))
  expect(screen.queryByLabelText('Private approval link')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Download quote PDF' })).toBeDisabled()
})

it('keeps editing selection separate from Reviewed and Configured status', async () => {
  await mounted(state([panel(), panel({ panel_id: 'roof', label: 'Roof', reviewed: false })]))
  const hood = screen.getByRole('button', { name: 'Hood Editing Reviewed' })
  const roof = screen.getByRole('button', { name: 'Roof Configured' })
  expect(hood).toHaveAttribute('aria-current', 'true'); expect(roof).not.toHaveAttribute('aria-current')
  fireEvent.click(roof)
  expect(roof).toHaveAttribute('aria-current', 'true'); expect(roof).toHaveTextContent('Editing'); expect(roof).toHaveTextContent('Configured')
  expect(hood).not.toHaveAttribute('aria-current'); expect(hood).not.toHaveTextContent('Editing'); expect(hood).toHaveTextContent('Reviewed')
})
it('uses panel singular/plural in the compact diagram and retains generic zone wording elsewhere', () => {
  const { rerender } = render(<VehicleDiagram compact value={['hood']} onChange={() => {}} />)
  expect(screen.getByText(/1 panel selected/)).toBeInTheDocument()
  rerender(<VehicleDiagram compact value={['hood', 'roof']} onChange={() => {}} />)
  expect(screen.getByText(/2 panels selected/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Interior (0)' }))
  expect(screen.getByText(/2 panels selected/)).toBeInTheDocument()
  rerender(<VehicleDiagram value={['hood']} onChange={() => {}} />)
  expect(screen.getByText(/1 zone selected/)).toBeInTheDocument()
})
it.each([3, undefined])('labels the saved revision from the immutable quote binding (%s), never draft version', async version => {
  const { container } = await mounted({ ...state([panel()]), version: 19, active_revision_id: 'r1' })
  expect(screen.getByText('Reviewed revision saved')).toBeInTheDocument()
  expect(container.textContent).not.toContain('Revision 19')
  api.get.mockResolvedValueOnce({ data: { revision_id: 'r1', quote_hash: 'a'.repeat(64), version, quote: { ...previewOf().quote, revision_id: 'r1', quote_hash: 'a'.repeat(64) } } })
  click('Preview customer quote'); await screen.findByRole('article')
  expect(screen.getByText(version ? 'Revision 3' : 'Reviewed revision saved')).toBeInTheDocument()
  api.post.mockResolvedValueOnce({ data: linkResponse() }); click('Seek customer approval'); await screen.findByLabelText('Private approval link')
  expect(screen.getByRole('region', { name: 'Approval link' })).toHaveTextContent(`${version ? 'Revision 3' : 'Reviewed revision saved'} · Approval link`)
  expect(api.post).toHaveBeenCalledWith(`${base}/approval-link`, { revision_id: 'r1', quote_hash: 'a'.repeat(64) })
  expect(container.textContent).not.toContain('Revision r1'); expect(container.textContent).not.toContain('Revision 19')
})
