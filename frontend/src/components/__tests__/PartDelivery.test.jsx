import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import PartDeliveryEditor from '../PartDeliveryEditor'
import CustomerPartsStatus from '../CustomerPartsStatus'
vi.mock('../../lib/api',()=>({default:{get:vi.fn(),put:vi.fn()}}))
import api from '../../lib/api'
const part={id:'p1',part_name:'Headlamp',quantity:4,received_quantity:0,status:'ordered',delivery_revision:3,tracking_status:'delivered'}
afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks();api.get.mockResolvedValue({data:{events:[]}});api.put.mockResolvedValue({data:{...part,status:'partially_received',received_quantity:2}})})
describe('part delivery editor',()=>{
  it('saves reviewed supplier, ETA, partial receipt and customer note with revision',async()=>{
    const saved=vi.fn();render(<PartDeliveryEditor part={part} onClose={()=>{}} onSaved={saved}/>);
    fireEvent.change(screen.getByLabelText('Supplier order reference'),{target:{value:'PO-123'}});
    fireEvent.change(screen.getByLabelText('Order status'),{target:{value:'partially_received'}});
    fireEvent.change(screen.getByLabelText('Quantity received and checked'),{target:{value:'2'}});
    fireEvent.change(screen.getByLabelText('Expected parts arrival'),{target:{value:'2026-10-01'}});
    fireEvent.change(screen.getByLabelText('ETA source'),{target:{value:'supplier'}});
    fireEvent.change(screen.getByLabelText('Customer-visible update'),{target:{value:'Waiting for remaining parts'}});
    fireEvent.click(screen.getByRole('button',{name:'Save delivery update'}));
    await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/parts/p1/delivery',expect.objectContaining({supplier_order_ref:'PO-123',status:'partially_received',received_quantity:2,delivery_revision:3,eta_source:'supplier',customer_note:'Waiting for remaining parts'}));
  });
  it('carrier delivery does not preselect received and conflicts cannot silently overwrite',async()=>{
    api.put.mockRejectedValue({response:{status:409,data:{error:'This order changed.'}}});
    render(<PartDeliveryEditor part={part} onClose={()=>{}} onSaved={()=>{}}/>);
    expect(screen.getByLabelText('Order status')).toHaveValue('ordered');expect(screen.getByLabelText('Quantity received and checked')).toHaveValue(0);
    expect(screen.getByText(/carrier reports delivery/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Save delivery update'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('This order changed.');expect(screen.getByRole('button',{name:'Save delivery update'})).toBeDisabled();
  });
  it('preserves previously checked units when changing shipment status',async()=>{
    render(<PartDeliveryEditor part={{...part,status:'partially_received',received_quantity:2}} onClose={()=>{}} onSaved={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Order status'),{target:{value:'shipped'}});
    expect(screen.getByLabelText('Quantity received and checked')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button',{name:'Save delivery update'}));
    await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/parts/p1/delivery',expect.objectContaining({status:'shipped',received_quantity:2})));
  });
  it('shows a history failure without blocking current delivery editing',async()=>{
    api.get.mockRejectedValue(new Error('offline'));render(<PartDeliveryEditor part={part} onClose={()=>{}} onSaved={()=>{}}/>);
    expect(await screen.findByText('History could not be loaded.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Save delivery update'})).toBeEnabled();
  });
})
it('customer view shows uncertain ETA, checked quantity and customer note without private data',()=>{
  render(<CustomerPartsStatus parts={[{...part,carrier_delivered:true,eta_source:'supplier',expected_date:'2026-10-01',customer_note:'We are confirming the remaining shipment.',notes:'PRIVATE',vendor:'PRIVATE',unit_cost:999}]} summary={{message:'Waiting on parts.',latest_expected_date:null,disclaimer:'Parts estimates do not confirm repair completion.'}}/>);
  expect(screen.getByText('Waiting on parts.')).toBeInTheDocument();expect(screen.getByText(/2026-10-01 · Supplier estimate/)).toBeInTheDocument();expect(screen.getByText('0 of 4 received by the shop')).toBeInTheDocument();expect(screen.getByText(/awaiting the shop’s receipt check/)).toBeInTheDocument();expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
})
