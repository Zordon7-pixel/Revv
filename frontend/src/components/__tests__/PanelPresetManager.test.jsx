import { createRequire } from 'node:module'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../lib/auth', () => ({ getRole: vi.fn(() => 'owner') }))
import api from '../../lib/api'
import { getRole } from '../../lib/auth'
import PanelPresetManager from '../PanelPresetManager'
const require = createRequire(import.meta.url)
const n = require('../../../../backend/src/services/panelEstimatorStore.js')
const { normalizePreset, safeSnapshot } = require('../../../../backend/src/services/panelEstimatorPresets.js')
const base = '/estimate-items/panel-presets'
const panel = n.assessments([{ panel_id: 'hood', body_style: 'sedan', severity: 'light', operation: 'repair', refinish: true, body_hours: 2, refinish_hours: 1, body_rate_cents: 10000, refinish_rate_cents: 10000, parts_sell_cents: 10000, materials_sell_cents: 5000, sublet_sell_cents: 0, taxable: { body: true, refinish: true, parts: true, materials: true, sublet: false } }])[0]
const makePreset = (id = 'version-1', version = 1) => safeSnapshot({ id, family_id: 'family-id', version, contract_version: 1, name: 'Panel package', match: { panel_id: 'hood', body_style: 'sedan', severity: 'light', operation: 'repair', area: null, paint_system: null }, sell_settings: Object.fromEntries(['body_hours', 'refinish_hours', 'refinish', ...n.SELL, 'taxable', 'package', 'extras', 'materials_pricing'].map(key => [key, panel[key]])) })
const config = (amount = 4321) => ({ ...Object.fromEntries(n.COST.map(key => [key, key === 'materials_cost_cents' ? amount : null])), cost_sources: Object.fromEntries(n.COST.map(key => [key, key === 'materials_cost_cents' ? 'quoted' : null])), extras: [], private_notes: 'Version private note', target_margin_bps: 3500, overhead_cents: null, include_overhead_in_target: false })
let catalog
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const check = name => fireEvent.click(screen.getByRole('checkbox', { name, exact: true }))
async function mount(props = {}) { const result = render(<PanelPresetManager panel={panel} {...props} />); await waitFor(() => expect(screen.queryByText('Load catalog…')).not.toBeInTheDocument()); return result }
beforeEach(() => {
  vi.clearAllMocks(); getRole.mockReturnValue('owner'); vi.stubGlobal('confirm', vi.fn(() => false)); catalog = [{ ...makePreset(), archived: false }]
  api.get.mockImplementation(async url => ({ data: url.endsWith('/cost-config') ? { private_cost_config: config(), reason: 'Old setup', created_by: 'server-owner', effective_at: '2026-10-01T12:00:00Z' } : { presets: catalog } }))
  api.post.mockImplementation(async (url, body) => {
    if (url.endsWith('/archive')) { catalog = catalog.map(item => ({ ...item, archived: body.archived })); return { data: { family_id: 'family-id', archived: body.archived } } }
    const normalized = normalizePreset(body) // Reject any accidental field leakage using real strict schema.
    const result = safeSnapshot({ ...normalized, id: 'new-version-id', family_id: url.endsWith('/versions') ? 'family-id' : 'new-family-id', version: url.endsWith('/versions') ? 2 : 1 })
    catalog.push({ ...result, archived: false }); return { data: result }
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('creates a strict preset from explicit current settings and separately reviewed costs, with null unknowns', async () => {
  const dirty = vi.fn(); await mount({ onDirtyChange: dirty }); click('Create preset from current panel settings')
  expect(screen.getByLabelText('Body hours')).toHaveValue(2); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(null)
  change('Preset name', 'Owner hood work'); change('Damage area', 'upper'); change('Paint system (optional match)', 'Waterborne'); change('Preset panel minimum ($)', '200'); change('Override policy', 'locked'); change('Materials cost ($)', '21.75'); change('Materials cost source', 'actual'); change('Target margin (%)', '42.5'); change('Private panel notes', 'Supplier receipt'); change('Catalog audit reason', 'Approved shop catalog setup')
  expect(screen.getByRole('button', { name: 'Create preset family' })).toBeDisabled(); check('I reviewed these private costs; blanks remain unknown, not free'); click('Create preset family')
  expect(await screen.findByText(/Created Owner hood work, immutable version 1/)).toHaveTextContent('new-version-id')
  expect(api.post).toHaveBeenCalledWith(base, expect.objectContaining({ contract_version: 1, name: 'Owner hood work', match: { panel_id: 'hood', body_style: 'sedan', severity: 'light', operation: 'repair', area: 'upper', paint_system: 'Waterborne' }, sell_settings: expect.objectContaining({ minimum_cents: 20000, override_policy: 'locked', body_hours: 2 }), private_cost_config: expect.objectContaining({ materials_cost_cents: 2175, body_cost_rate_cents: null, target_margin_bps: 4250, overhead_cents: null, cost_sources: expect.objectContaining({ materials_cost_cents: 'actual' }), private_notes: 'Supplier receipt' }), reason: 'Approved shop catalog setup' }))
  expect(dirty).toHaveBeenLastCalledWith(false)
})
it('loads private configuration by VERSION ID only on explicit action and versions the FAMILY ID', async () => {
  await mount(); change('Catalog version', 'version-1'); expect(api.get).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText('Materials cost ($)')).not.toBeInTheDocument()
  click('Load selected version private configuration'); await screen.findByLabelText('Materials cost ($)'); expect(api.get).toHaveBeenLastCalledWith(`${base}/version-1/cost-config`)
  expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(43.21); expect(screen.getByLabelText('Materials cost source')).toHaveValue('quoted')
  change('Body hours', '2.5'); change('Catalog audit reason', 'Revised shop hours'); check('I reviewed these private costs; blanks remain unknown, not free'); click('Create immutable version')
  await screen.findByText(/immutable version 2/); expect(api.post).toHaveBeenLastCalledWith(`${base}/family-id/versions`, expect.objectContaining({ private_cost_config: config(), sell_settings: expect.objectContaining({ body_hours: 2.5 }) }))
  const body = api.post.mock.calls[0][1]; expect(Object.keys(body).sort()).toEqual(['contract_version', 'match', 'name', 'private_cost_config', 'reason', 'sell_settings']); expect(body).not.toHaveProperty('id')
})
it('drops private configuration when changing versions and requires a new explicit private load/review', async () => {
  catalog.push({ ...makePreset('version-2', 2), archived: false }); await mount(); change('Catalog version', 'version-1'); click('Load selected version private configuration'); await screen.findByLabelText('Materials cost ($)')
  change('Catalog version', 'version-2'); expect(screen.queryByLabelText('Materials cost ($)')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Create immutable version' })).toBeDisabled()
  api.get.mockResolvedValueOnce({ data: { private_cost_config: config(9876), reason: 'New reason' } }); click('Load selected version private configuration'); await screen.findByLabelText('Materials cost ($)'); expect(screen.getByLabelText('Materials cost ($)')).toHaveValue(98.76); expect(api.get).toHaveBeenLastCalledWith(`${base}/version-2/cost-config`)
})
it('archives/unarchives families with strict bodies while retaining version list/history', async () => {
  await mount(); click('Archive Panel package'); await screen.findByText('Panel package · Archived — historical use retained'); expect(api.post).toHaveBeenLastCalledWith(`${base}/family-id/archive`, { archived: true }); expect(screen.getByRole('option', { name: /Version 1 · Archived/ })).toBeInTheDocument()
  click('Unarchive Panel package'); await screen.findByText('Panel package · Available'); expect(api.post).toHaveBeenLastCalledWith(`${base}/family-id/archive`, { archived: false })
})
it('preserves dirty catalog controls on cancel/version changes and guards duplicate writes', async () => {
  await mount(); click('Create preset from current panel settings'); change('Preset name', 'Pending'); change('Catalog audit reason', 'New family'); click('Cancel catalog edits'); expect(screen.getByLabelText('Preset name')).toHaveValue('Pending')
  change('Catalog version', 'version-1'); expect(screen.getByLabelText('Preset name')).toHaveValue('Pending'); check('I reviewed these private costs; blanks remain unknown, not free')
  let resolve; api.post.mockImplementation(() => new Promise(done => { resolve = done })); click('Create preset family'); click('Create preset family'); expect(api.post).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Cancel catalog edits' })).toBeDisabled()
  await act(async () => resolve({ data: makePreset('new-version', 2) })); expect(await screen.findByText(/immutable version 2/)).toBeInTheDocument()
})
it('shows load failure/retry and retains inputs on uncertain write without blindly repeating a create', async () => {
  api.get.mockRejectedValueOnce(new Error('offline')); await mount(); expect(screen.getByRole('alert')).toHaveTextContent('Load catalog failed'); click('Retry catalog read'); await screen.findByRole('option', { name: /Panel package · Version 1/ })
  click('Create preset from current panel settings'); change('Preset name', 'Do not duplicate'); change('Catalog audit reason', 'New setup'); check('I reviewed these private costs; blanks remain unknown, not free'); api.post.mockRejectedValue(new Error('lost response')); click('Create preset family'); expect(await screen.findByRole('alert')).toHaveTextContent('uncertain write'); expect(screen.getByLabelText('Preset name')).toHaveValue('Do not duplicate'); click('Retry catalog read'); await waitFor(() => expect(screen.queryByText('Create immutable preset version…')).not.toBeInTheDocument()); expect(api.post).toHaveBeenCalledTimes(1)
})
it.each(['assistant', 'technician', 'customer', 'employee', 'staff', 'superadmin', null])('does not mount or fetch owner catalog for %s', role => {
  getRole.mockReturnValue(role); render(<PanelPresetManager panel={panel} />); expect(screen.queryByRole('region', { name: 'Owner preset catalog' })).not.toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled()
})
it('allows the exact admin role', async () => { getRole.mockReturnValue('admin'); await mount(); expect(screen.getByRole('button', { name: 'Create preset from current panel settings' })).toBeInTheDocument() })
it('keeps the immutable creation result when its follow-up list read fails', async () => {
  await mount(); click('Create preset from current panel settings'); change('Preset name', 'Confirmed created'); change('Catalog audit reason', 'Shop setup'); check('I reviewed these private costs; blanks remain unknown, not free'); api.get.mockRejectedValueOnce(new Error('List read failed')); click('Create preset family')
  expect(await screen.findByRole('alert')).toHaveTextContent('immutable version was created'); expect(screen.getByText(/Created Confirmed created, immutable version 1/)).toBeInTheDocument(); click('Retry catalog read'); await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument()); expect(api.post).toHaveBeenCalledTimes(1)
})
