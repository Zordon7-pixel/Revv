import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../lib/auth', () => ({ isAssistant: () => false }))
import api from '../../lib/api'
import PartCapture from '../PartCapture'
import Inventory from '../../pages/Inventory'
const listing = { id: 'listing', part_number: 'AB123', brand: 'Example', description: 'Headlamp', source: 'eBay listing', source_url: 'https://www.ebay.com/itm/123', match: 'exact_number', specifications: [] }
const found = (stock = [], candidates = []) => ({ part_number: 'AB123', stock, catalog: { status: 'available', candidates, message: 'Check the source.' } })
beforeEach(() => { cleanup(); vi.clearAllMocks(); URL.createObjectURL = vi.fn(() => 'blob:photo'); URL.revokeObjectURL = vi.fn() })
async function search(number = 'AB123', brand = 'Example') {
  fireEvent.change(screen.getByLabelText('Part number'), { target: { value: number } })
  fireEvent.change(screen.getByLabelText('Brand (if known)'), { target: { value: brand } })
  fireEvent.click(screen.getByRole('button', { name: 'Find matching parts' }))
  await screen.findByText('Check the source.')
}
it('photo reading is read-only and existing stock requires review', async () => {
  api.post.mockResolvedValue({ data: { raw_text: 'Example AB123', candidates: [{ part_number: 'AB123', brand: 'Example' }] } })
  const item = { id: 'stock', name: 'Headlamp', part_number: 'AB123', qty_on_hand: 2, location: 'B3', brand_match: 'match' }
  api.get.mockResolvedValue({ data: found([item]) }); const useStock = vi.fn(), create = vi.fn()
  render(<PartCapture preparePhoto={async () => new Blob(['photo'], { type: 'image/jpeg' })} onUseStock={useStock} onCreate={create} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Part label photo'), { target: { files: [new File(['photo'], 'part.jpg', { type: 'image/jpeg' })] } })
  await waitFor(() => expect(screen.getByLabelText('Part number')).toHaveValue('AB123'))
  expect(api.get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Find matching parts' }))
  expect(await screen.findByText('2 on hand · B3')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Review existing stock' }))
  expect(useStock).toHaveBeenCalledWith(item); expect(create).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1)
})
it('matching sourced details prefill but do not save', async () => {
  api.get.mockResolvedValue({ data: found([], [listing]) }); const create = vi.fn()
  render(<PartCapture onCreate={create} onClose={() => {}} />); await search()
  fireEvent.click(screen.getByRole('button', { name: 'Review details for new stock' }))
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ part_number: 'AB123', name: 'Headlamp', brand: 'Example', source_details: expect.objectContaining({ source: 'eBay listing' }) })); expect(api.post).not.toHaveBeenCalled()
})
it('different candidate MPN requires another stock check', async () => {
  api.get.mockResolvedValue({ data: found([], [{ ...listing, part_number: 'AB124', match: 'possible' }]) }); const create = vi.fn()
  render(<PartCapture onCreate={create} onClose={() => {}} />); await search()
  expect(screen.queryByRole('button', { name: 'Review details for new stock' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check this part’s stock first' }))
  expect(screen.getByLabelText('Part number')).toHaveValue('AB124'); expect(screen.queryByText('Your shop’s stock')).not.toBeInTheDocument(); expect(create).not.toHaveBeenCalled()
})
it('different known brand can be added with a collision warning', async () => {
  api.get.mockResolvedValue({ data: found([{ id: 'old', name: 'Other part', qty_on_hand: 3, part_number: 'AB123', brand: 'Other', brand_match: 'different' }]) })
  render(<PartCapture onCreate={() => {}} onClose={() => {}} />); await search()
  expect(screen.getByText('The saved brand differs. Check the part before using this stock.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Enter new stock details' })).toBeInTheDocument()
})
it('stale lookup cannot populate a changed part number', async () => {
  let resolve; api.get.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<PartCapture onCreate={() => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Part number'), { target: { value: 'OLD123' } }); fireEvent.click(screen.getByRole('button', { name: 'Find matching parts' }))
  fireEvent.change(screen.getByLabelText('Part number'), { target: { value: 'NEW123' } }); resolve({ data: found([], [listing]) })
  await waitFor(() => expect(screen.getByLabelText('Part number')).toHaveValue('NEW123'))
  expect(screen.queryByText('Your shop’s stock')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(1)
})
it('inventory confirmation asks for actual quantity and saves explicitly', async () => {
  api.get.mockImplementation((path) => Promise.resolve({ data: path === '/inventory' ? { items: [] } : found([], [listing]) })); api.post.mockResolvedValue({ data: { item: {} } })
  render(<Inventory />); fireEvent.click(screen.getByRole('button', { name: 'Scan part label' })); await search()
  fireEvent.click(screen.getByRole('button', { name: 'Review details for new stock' }))
  expect(screen.getByLabelText('Item name')).toHaveValue('Headlamp'); expect(screen.getByLabelText('Quantity on hand')).toHaveValue(null); expect(api.post).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Quantity on hand'), { target: { value: '2' } }); fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'B3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save item' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/inventory', expect.objectContaining({ part_number: 'AB123', brand: 'Example', qty_on_hand: 2, location: 'B3' })))
})
