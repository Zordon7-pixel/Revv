import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/auth', () => ({
  getRole: vi.fn(() => 'owner'),
  getTokenPayload: vi.fn(() => ({ id: 'owner-1', role: 'owner' })),
  isAdmin: vi.fn(() => true),
  isAssistant: vi.fn(() => false),
  isEmployee: vi.fn(() => false),
}))

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key }),
}))

vi.mock('../../lib/imageUpload', () => ({
  optimizeImageForUpload: vi.fn((file) => Promise.resolve(file)),
}))

vi.mock('../RepairOrders', () => ({
  STATUS_COLORS: {
    intake: '#64748b',
    estimate: '#3b82f6',
    approval: '#eab308',
    parts: '#8b5cf6',
    repair: '#f97316',
    paint: '#06b6d4',
    qc: '#10b981',
    delivery: '#22c55e',
    closed: '#374151',
    total_loss: '#dc2626',
  },
  STATUS_LABELS: {
    intake: 'Intake',
    estimate: 'Estimate',
    approval: 'Approval',
    parts: 'Parts',
    repair: 'Repair',
    paint: 'Paint',
    qc: 'QC Check',
    delivery: 'Delivery',
    closed: 'Closed',
    total_loss: 'Total Loss',
  },
}))

vi.mock('../../components/StatusBadge', () => ({
  default: ({ status }) => <span>{status}</span>,
}))
vi.mock('../../components/PaymentStatusBadge', () => ({
  default: () => <span>payment badge</span>,
  normalizePaymentStatus: () => 'unpaid',
}))
vi.mock('../../components/PaymentPanel', () => ({ default: () => null }))
vi.mock('../../components/LibraryAutocomplete', () => ({ default: () => null }))
vi.mock('../../components/ROPhotos', () => ({ default: () => <div>Photo workspace</div> }))
vi.mock('../../components/TurnaroundEstimator', () => ({ default: () => null, formatTurnaroundRange: () => '' }))
vi.mock('../../components/PartsSearch', () => ({ default: () => null }))
vi.mock('../../components/VehicleDiagram', () => ({ default: () => null }))
vi.mock('../../components/ClaimStatusCard', () => ({ default: () => null }))
vi.mock('../../components/InsurancePanel', () => ({ default: () => <div>Insurance workspace</div> }))
vi.mock('../../components/SupplementFinderPanel', () => ({
  default: ({ variant }) => <div data-testid="supplement-finder" data-variant={variant}>Supplement Finder workspace</div>,
}))
vi.mock('../../components/ROOperations', () => ({ default: () => null }))
vi.mock('../../components/ClaimTrackerPanel', () => ({ default: () => null }))

import api from '../../lib/api'
import { getRole, getTokenPayload, isAdmin, isAssistant, isEmployee } from '../../lib/auth'
import RODetail from '../RODetail'
import Dashboard from '../Dashboard'
import Reports from '../Reports'
import JobCosting from '../JobCosting'
import OwnerKpis from '../OwnerKpis'

const completeDto = {
  source: 'panel_estimator_revision', revision_id: 'revision-frozen-10h',
  contribution_cents: 60000, direct_cost_cents: 40000, margin_bps: 6000,
  complete: true, missing_count: 0,
}
const missingDto = { ...completeDto, contribution_cents: null, direct_cost_cents: null,
  margin_bps: null, complete: false, missing_count: 2 }
const zeroDto = { ...completeDto, contribution_cents: 0, direct_cost_cents: 100000, margin_bps: 0 }
function makeRo(dto = completeDto, selected = true) {
  return { id: 'ro-1', ro_number: 'RO-PANEL', status: 'repair', intake_date: '2026-06-01',
    payment_received: 0, payment_status: 'unpaid', parts_cost: 0, labor_cost: 1000, sublet_cost: 0,
    tax: 100, total: 1100, deductible: 0, deductible_waived: 0, referral_fee: 0, goodwill_repair_cost: 0,
    true_profit: 920, notes: '', damaged_panels: '[]', parts: [], log: [],
    vehicle: { year: 2022, make: 'Honda', model: 'Civic' },
    customer: { id: 'cust-1', name: 'Jane Customer' }, customer_name: 'Jane Customer',
    profit_breakdown: { costProfileApplied: true, trueProfit: 920, margin: 92,
      breakdown: { labor_profit: 920, parts_profit: 0, materials_profit: 0, sublet_profit: 0 } },
    ...(selected ? { panel_estimator_selected: true, panel_economics: dto } : {}),
  }
}
function fixtures({ dto = completeDto, selected = true, aggregate = {}, omitDto = false } = {}) {
  const ro = makeRo(dto, selected)
  if (omitDto) delete ro.panel_economics
  const complete = dto.complete
  const metadata = selected ? { profit_source: 'panel_estimator_revision', profit_complete: complete,
    unknown_count: complete ? 0 : 1, known_profit_cents: complete ? dto.contribution_cents : 0 } : {}
  const profit = selected ? (dto.contribution_cents == null ? null : dto.contribution_cents / 100) : 920
  const summary = { total: 1, active: 1, completed: 0, revenue: 1100, profit,
    byType: [], byStatus: [], ...metadata, ...aggregate }
  const job = { totalJobs: 1, totalRevenue: 1100, totalCost: dto.direct_cost_cents == null ? null : dto.direct_cost_cents / 100,
    grossProfit: profit, avgMargin: complete ? 54.55 : null, profitableCount: complete ? (profit > 0 ? 1 : 0) : null,
    rows: [ro], ...metadata, ...aggregate }
  const instruments = { revenue_mtd_cents: 110000, revenue_goal_cents: 200000,
    true_profit_cents: profit == null ? null : profit * 100, profit_margin_percent: complete ? 54.55 : null,
    supplement_opportunity_cents: 0, ...metadata, ...aggregate }
  api.get.mockImplementation(async url => {
    if (url === '/ros/ro-1') return { data: ro }
    if (url.startsWith('/reports/summary')) return { data: summary }
    if (url.startsWith('/ros/job-cost/summary')) return { data: job }
    if (url === '/dashboard/instruments') return { data: instruments }
    if (url === '/market/shop') return { data: { monthly_revenue_target: 2000 } }
    if (url === '/repair-orders' || url === '/ros') return { data: { ros: [] } }
    if (url === '/dashboard/weekly' || url === '/claim-links/ro/ro-1') return { data: null }
    if (url === '/estimate-items/ro-1') return { data: { items: [
      { type: 'labor', quantity: 1, unit_price: 1000, total: 1000 },
      { type: 'labor', quantity: 1, unit_price: 0, total: 0 },
    ], summary: null } }
    return { data: {} }
  })
  api.put.mockResolvedValue({ data: ro })
  api.patch.mockResolvedValue({ data: ro })
}
const pages = [
  ['RODetail', RODetail], ['Dashboard', Dashboard], ['Reports', Reports],
  ['JobCosting', JobCosting], ['OwnerKpis', OwnerKpis],
]
async function show(Page) {
  const view = render(<MemoryRouter initialEntries={['/ros/ro-1']}><Routes><Route path="/ros/:id" element={<Page />} /></Routes></MemoryRouter>)
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  await waitFor(() => expect(view.container.textContent).not.toMatch(/Loading (repair order|dashboard|reports|job costing|owner KPIs)/i))
  if (Page === RODetail) await screen.findByText('RO-PANEL')
  if (Page === JobCosting) await screen.findAllByText('RO-PANEL')
  return view
}
function setRole(role) {
  getRole.mockReturnValue(role)
  getTokenPayload.mockReturnValue({ id: 'owner-1', role })
  isAdmin.mockReturnValue(['owner', 'admin'].includes(role))
  isAssistant.mockReturnValue(role === 'assistant')
  isEmployee.mockReturnValue(role === 'technician')
}
function stat(label) {
  return screen.getByText(label, { exact: true }).closest('button, article, section') || screen.getByText(label).parentElement
}

beforeEach(() => { vi.clearAllMocks(); setRole('owner'); fixtures() })
afterEach(() => cleanup())

describe.each(pages)('%s selected economics', (name, Page) => {
  it.each(['owner', 'admin'])('uses the frozen server contribution as %s, never stale profit', async role => {
    setRole(role)
    const { container } = await show(Page)
    expect(container.textContent).toContain('$600')
    expect(container.textContent).not.toContain('$920')
    expect(container.textContent).not.toContain('True Shop Profit Breakdown')
    expect(screen.queryByRole('button', { name: 'Edit true profit' })).not.toBeInTheDocument()
    if ([RODetail, JobCosting, OwnerKpis].includes(Page)) {
      expect(container.textContent).toContain('$400')
      expect(container.textContent).toContain('60.0%')
      expect(container.textContent).toContain('Revision revision-frozen-10h')
    }
    if (Page === Reports) expect(stat('Contribution / profit margin').textContent).toContain('Not supplied')
    if (Page === Dashboard) expect(screen.getByTestId('stat-value-true-profit').closest('button')).toHaveTextContent('54.5%')
  })

  it('retains missing costs and margins without a profit editor or false zero', async () => {
    fixtures({ dto: missingDto })
    const { container } = await show(Page)
    expect(container.textContent).toContain('Not supplied')
    expect(container.textContent).not.toContain('$920')
    expect(container.textContent).not.toMatch(/(?:60\.0|100\.0)%/)
    expect(screen.queryByRole('button', { name: 'Edit true profit' })).not.toBeInTheDocument()
    if (Page === RODetail) {
      const region = screen.getByRole('region', { name: 'Panel estimator economics' })
      expect(within(region).getAllByText('Not supplied')).toHaveLength(3)
      expect(region.textContent).not.toContain('$0')
    }
    if (Page === Dashboard) {
      const card = screen.getByTestId('stat-value-true-profit').closest('button')
      expect(card.querySelector('svg')).toBeNull()
      expect(screen.getByTestId('stat-value-true-profit')).toHaveTextContent('Not supplied')
    }
    if ([JobCosting, OwnerKpis, Reports].includes(Page)) {
      const label = Page === JobCosting ? 'Average margin' : Page === OwnerKpis ? 'Average RO margin' : 'Contribution / profit margin'
      expect(stat(label).textContent).toContain('Not supplied')
    }
  })

  it('preserves an explicit known zero contribution', async () => {
    fixtures({ dto: zeroDto, aggregate: { avgMargin: 0, profit_margin_percent: 0 } })
    const { container } = await show(Page)
    expect(container.textContent).toContain('$0')
    expect(container.textContent).not.toContain('$920')
    if (Page !== Reports) expect(container.textContent).toContain('0.0%')
    if (Page === RODetail) expect(screen.getByRole('region', { name: 'Panel estimator economics' }).textContent).not.toContain('Not supplied')
  })

  it.each(['assistant', 'technician', 'customer', 'superadmin'])('does not expose a malicious private DTO to %s', async role => {
    setRole(role)
    const { container } = await show(Page)
    expect(container.textContent).not.toMatch(/\$600|\$400|\$920|60\.0%|revision-frozen-10h/)
    expect(screen.queryByRole('region', { name: 'Panel estimator economics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit true profit' })).not.toBeInTheDocument()
  })
})

it.each([['RODetail', RODetail], ['JobCosting', JobCosting], ['OwnerKpis', OwnerKpis]])('%s never treats the selected flag as a private DTO', async (_name, Page) => {
  fixtures({ omitDto: true })
  const { container } = await show(Page)
  if (Page === RODetail) expect(screen.getByRole('region', { name: 'Panel estimator economics' }).textContent).not.toContain('$')
  else {
    const row = Page === JobCosting ? container.querySelector('tbody tr') : screen.getByText('RO-PANEL - Jane Customer').closest('button')
    expect(row.textContent).not.toMatch(/\$600|\$400|\$920|60\.0%/)
    expect(row.textContent).toContain('Not supplied')
  }
})

it.each(pages)('%s preserves legacy metrics without estimator metadata', async (_name, Page) => {
  fixtures({ selected: false })
  const { container } = await show(Page)
  expect(container.textContent).toContain('$920')
  expect(container.textContent).not.toContain('Estimated gross contribution')
  if (Page === RODetail) {
    fireEvent.click(screen.getByRole('button', { name: 'Edit true profit' }))
    const input = screen.getByDisplayValue('920')
    fireEvent.change(input, { target: { value: '800' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ros/ro-1', { true_profit: 800 }))
  }
})

it.each([['Dashboard', Dashboard], ['Reports', Reports], ['JobCosting', JobCosting], ['OwnerKpis', OwnerKpis]])('%s labels a known subtotal as partial and suppresses inconsistent stale totals', async (_name, Page) => {
  fixtures({ aggregate: { profit_source: 'panel_contribution_and_legacy_profit', profit_complete: false,
    unknown_count: 1, known_profit_cents: 12345, profit: 920, grossProfit: 920, true_profit_cents: 92000,
    profit_margin_percent: 92, avgMargin: 92, totalCost: 920, profitableCount: 1 } })
  const { container } = await show(Page)
  expect(container.textContent).toContain('Partial known subtotal: $123.45')
  expect(container.textContent).toContain('not a total')
  expect(container.textContent).toContain('Estimated contribution + recorded legacy profit')
  expect(container.textContent).not.toMatch(/\$920|92(?:\.0)?%/)
  if (Page === JobCosting) for (const label of ['Total cost', 'Jobs profitable', 'Average margin']) expect(stat(label).textContent).toContain('Not supplied')
})

it('Reports uses a supplied aggregate margin without deriving it from tax-inclusive revenue', async () => {
  fixtures({ aggregate: { profit_margin_percent: 60 } })
  await show(Reports)
  expect(stat('Contribution / profit margin').textContent).toContain('60%')
})

it.each([['Dashboard', Dashboard], ['Reports', Reports], ['JobCosting', JobCosting], ['OwnerKpis', OwnerKpis]])('%s honors unknown_count even if a stale completeness flag says true', async (_name, Page) => {
  fixtures({ aggregate: { profit_complete: true, unknown_count: 1, known_profit_cents: undefined } })
  const { container } = await show(Page)
  expect(container.textContent).not.toContain('Partial known subtotal')
  const label = Page === Dashboard ? 'Estimated gross contribution' : Page === Reports ? 'Contribution / profit margin' : Page === JobCosting ? 'Jobs profitable' : 'Average RO margin'
  expect(stat(label).textContent).toContain('Not supplied')
  if (Page === Dashboard) expect(stat(label).querySelector('svg')).toBeNull()
})

it.each([['Dashboard', Dashboard], ['Reports', Reports], ['JobCosting', JobCosting], ['OwnerKpis', OwnerKpis]])('%s retains the supplied 60 percent aggregate margin', async (_name, Page) => {
  fixtures({ aggregate: { profit_margin_percent: 60, avgMargin: 60 } })
  await show(Page)
  const label = Page === Dashboard ? 'Estimated gross contribution' : Page === Reports ? 'Contribution / profit margin' : Page === JobCosting ? 'Average margin' : 'Average RO margin'
  expect(stat(label).textContent).toMatch(/60(?:\.0)?%/)
})
