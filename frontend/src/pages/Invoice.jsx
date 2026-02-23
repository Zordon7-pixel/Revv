import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import api from '../lib/api'

export default function Invoice() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/ros/${id}/invoice`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not load invoice. Make sure you are signed in.'))
  }, [id])

  if (error) return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', color: '#333' }}>
      <p>{error}</p>
    </div>
  )

  if (!data) return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', color: '#333' }}>
      <p>Loading invoice...</p>
    </div>
  )

  const { shop, customer, vehicle, parts, labor_cost, parts_cost, sublet_cost, tax, total, ro_number, intake_date, actual_delivery, payment_type, claim_number, insurer, notes } = data

  const subtotal = parseFloat(parts_cost || 0) + parseFloat(labor_cost || 0) + parseFloat(sublet_cost || 0)
  const taxAmt = parseFloat(tax || 0)
  const totalAmt = parseFloat(total || 0)

  const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
        body { margin: 0; background: #f3f4f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111; }
        * { box-sizing: border-box; }
      `}</style>

      {/* Print button — hidden on print */}
      <div className="no-print" style={{ background: '#1a1d2e', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          onClick={() => window.print()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.5rem 1.25rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
        >
          <Printer size={15} />
          Print Invoice
        </button>
        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{ro_number}</span>
      </div>

      {/* Invoice sheet */}
      <div style={{ maxWidth: '780px', margin: '1.5rem auto', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 8px rgba(0,0,0,0.1)', padding: '2.5rem' }}>

        {/* Header — shop info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', borderBottom: '2px solid #111', paddingBottom: '1.25rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.5px', textTransform: 'uppercase' }}>{shop?.name || 'Auto Body Shop'}</h1>
            {shop?.address && <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#444' }}>{shop.address}{shop.city ? `, ${shop.city}` : ''}{shop.state ? `, ${shop.state}` : ''} {shop.zip || ''}</p>}
            {shop?.phone && <p style={{ margin: '0.1rem 0 0', fontSize: '0.85rem', color: '#444' }}>{shop.phone}</p>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#111' }}>Invoice</h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#444' }}>RO: <strong>{ro_number}</strong></p>
            <p style={{ margin: '0.1rem 0 0', fontSize: '0.85rem', color: '#444' }}>Date: {today}</p>
            {intake_date && <p style={{ margin: '0.1rem 0 0', fontSize: '0.85rem', color: '#444' }}>Intake: {intake_date}</p>}
            {actual_delivery && <p style={{ margin: '0.1rem 0 0', fontSize: '0.85rem', color: '#444' }}>Delivered: {actual_delivery}</p>}
          </div>
        </div>

        {/* Customer + Vehicle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#888' }}>Bill To</h3>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{customer?.name || '—'}</p>
            {customer?.address && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>{customer.address}</p>}
            {customer?.phone && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>{customer.phone}</p>}
            {customer?.email && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>{customer.email}</p>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#888' }}>Vehicle</h3>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{vehicle?.year} {vehicle?.make} {vehicle?.model}</p>
            {vehicle?.color && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>Color: {vehicle.color}</p>}
            {vehicle?.vin && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>VIN: {vehicle.vin}</p>}
            {vehicle?.plate && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>Plate: {vehicle.plate}</p>}
            {vehicle?.mileage && <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#444' }}>Mileage: {vehicle.mileage.toLocaleString()}</p>}
          </div>
        </div>

        {/* Insurance / Payment info */}
        {payment_type === 'insurance' && (insurer || claim_number) && (
          <div style={{ background: '#f9fafb', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#444' }}>
            <span style={{ fontWeight: 700, marginRight: '1rem' }}>Insurance Claim</span>
            {insurer && <span style={{ marginRight: '1rem' }}>Carrier: <strong>{insurer}</strong></span>}
            {claim_number && <span>Claim #: <strong>{claim_number}</strong></span>}
          </div>
        )}

        {/* Parts table */}
        {parts && parts.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#888' }}>Parts</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Part #</th>
                  <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Unit Price</th>
                  <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p, i) => (
                  <tr key={p.id || i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.5rem 0.5rem' }}>{p.part_name}</td>
                    <td style={{ padding: '0.5rem 0.5rem', color: '#777', fontSize: '0.8rem' }}>{p.part_number || '—'}</td>
                    <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>{p.quantity || 1}</td>
                    <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>{fmt(p.unit_cost)}</td>
                    <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{fmt((p.unit_cost || 0) * (p.quantity || 1))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Labor + Sublet */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#888' }}>Services</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: 700, color: '#555', fontSize: '0.75rem', textTransform: 'uppercase' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {parseFloat(labor_cost || 0) > 0 && (
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.5rem 0.5rem' }}>Labor</td>
                  <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{fmt(labor_cost)}</td>
                </tr>
              )}
              {parseFloat(parts_cost || 0) > 0 && (parts && parts.length === 0) && (
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.5rem 0.5rem' }}>Parts</td>
                  <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{fmt(parts_cost)}</td>
                </tr>
              )}
              {parseFloat(sublet_cost || 0) > 0 && (
                <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.5rem 0.5rem' }}>Sublet Work</td>
                  <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{fmt(sublet_cost)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
          <div style={{ width: '260px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: '0.875rem', borderTop: '1px solid #e5e7eb' }}>
              <span style={{ color: '#555' }}>Subtotal</span>
              <span style={{ fontWeight: 600 }}>{fmt(subtotal)}</span>
            </div>
            {taxAmt > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: '0.875rem' }}>
                <span style={{ color: '#555' }}>Tax</span>
                <span style={{ fontWeight: 600 }}>{fmt(taxAmt)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', fontSize: '1.05rem', borderTop: '2px solid #111', marginTop: '0.25rem' }}>
              <span style={{ fontWeight: 800 }}>Total</span>
              <span style={{ fontWeight: 800 }}>{fmt(totalAmt > 0 ? totalAmt : subtotal + taxAmt)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {notes && (
          <div style={{ background: '#f9fafb', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#444' }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#888' }}>Notes</strong>
            {notes}
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1.25rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: '#333' }}>Thank you for your business.</p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#888' }}>
            {shop?.name}{shop?.phone ? ` · ${shop.phone}` : ''}
          </p>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: '#aaa' }}>
            Every repair tracked. Every dollar counted. Every customer impressed.
          </p>
        </div>

      </div>
    </>
  )
}
