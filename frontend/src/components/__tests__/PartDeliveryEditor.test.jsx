import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import api from '../../lib/api'
import PartDeliveryEditor from '../PartDeliveryEditor'

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }))
const part = {id:'part-test',part_name:'Synthetic lamp',quantity:1,status:'ordered',delivery_revision:2}
beforeEach(() => { vi.resetAllMocks(); api.get.mockResolvedValue({data:{events:[]}}) })
afterEach(cleanup)

it('keeps a successful save and explains cooldown per channel without a retry control', async () => {
  const saved = {...part,notification:{status:'complete',channels:[{channel:'sms',status:'skipped',reason:'cooldown'},{channel:'email',status:'accepted'}]}}
  api.put.mockResolvedValue({data:saved})
  const onSaved = vi.fn()
  render(<PartDeliveryEditor part={part} onClose={vi.fn()} onSaved={onSaved} />)
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', {name:'Save delivery update'}))
  expect(await screen.findByRole('heading', {name:'Delivery update saved'})).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Text message: Not sent: this customer recently had a parts notification attempted on this channel.')
  expect(screen.getByRole('status')).toHaveTextContent('This update was saved; no message is queued.')
  expect(screen.getByRole('status')).toHaveTextContent('Email: Accepted by the messaging provider. Delivery is not yet confirmed.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', {name:/retry|override|resend/i})).not.toBeInTheDocument()
  expect(api.put).toHaveBeenCalledWith('/parts/part-test/delivery', expect.objectContaining({notify_customer:true,delivery_revision:2}))
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', {name:'Done'}))
  expect(onSaved).toHaveBeenCalledWith(saved)
})
it('shows readable cooldown and unknown outcomes in saved history', async () => {
  api.get.mockResolvedValue({data:{events:[{revision:2,created_at:'2026-10-03T12:00:00Z',source:'staff',after_state:{status:'shipped',quantity:1,received_quantity:0},notification:{status:'complete',channels:[{channel:'sms',status:'skipped',reason:'cooldown'},{channel:'email',status:'unknown',reason:'verify_before_retry'}]}}]}})
  render(<PartDeliveryEditor part={part} onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(await screen.findByText(/Text: Not sent: this customer recently/)).toBeInTheDocument()
  expect(screen.getByText(/Email: Result could not be confirmed/)).toBeInTheDocument()
  expect(screen.queryByText(/Provider reference:/)).not.toBeInTheDocument()
})
it.each(['verify_before_retry','no_customer_change','consent_unavailable'])('keeps %s informational after a successful save', async reason => {
  api.put.mockResolvedValue({data:{...part,notification:{status:'unknown',reason,channels:[]}}})
  render(<PartDeliveryEditor part={part} onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', {name:'Save delivery update'}))
  await screen.findByRole('heading', {name:'Delivery update saved'})
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).not.toHaveTextContent('Notification result is unavailable.')
})
it('save-only remains default and returns the saved part immediately', async () => {
  const onSaved=vi.fn();api.put.mockResolvedValue({data:part})
  render(<PartDeliveryEditor part={part} onClose={vi.fn()} onSaved={onSaved} />)
  fireEvent.click(screen.getByRole('button', {name:'Save delivery update'}))
  await vi.waitFor(()=>expect(onSaved).toHaveBeenCalledWith(part))
  expect(api.put).toHaveBeenCalledWith('/parts/part-test/delivery',expect.objectContaining({notify_customer:false}))
})
