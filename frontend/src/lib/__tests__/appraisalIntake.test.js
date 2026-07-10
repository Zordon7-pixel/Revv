import { describe, expect, it } from 'vitest'
import {
  findAppraisalCustomerMatch,
  findAppraisalClaimMatches,
  findAppraisalVehicleMatch,
  parsedAppraisalToFields,
} from '../appraisalIntake'

describe('appraisal intake matching', () => {
  it('maps extracted metadata and matches existing records by exact contact and VIN', () => {
    const fields = parsedAppraisalToFields({
      customer_name: 'Miles Customer',
      customer_phone: '(718) 555-0100',
      customer_email: 'miles@example.com',
      vehicle: '2024 Toyota Camry',
      vin: '1hgbh41jxmn109186',
      insurance_company: 'Progressive',
      claim_number: 'CLM-100',
      estimate_totals: { deductible: 1000 },
    })
    const customer = { id: 'customer-1', phone: '7185550100', email: 'miles@example.com' }
    const vehicle = { id: 'vehicle-1', vin: '1HGBH41JXMN109186', year: 2024, make: 'Toyota', model: 'Camry' }

    expect(fields.year).toBe('2024')
    expect(fields.make).toBe('Toyota')
    expect(fields.model).toBe('Camry')
    expect(fields.deductible).toBe('1000')
    expect(findAppraisalCustomerMatch([customer], fields)).toEqual({ customer, reason: 'phone' })
    expect(findAppraisalVehicleMatch([vehicle], fields)).toEqual({ vehicle, reason: 'VIN' })
  })

  it('does not match on name alone', () => {
    expect(findAppraisalCustomerMatch([{ id: 'customer-1', name: 'John Smith' }], { customer_name: 'John Smith' })).toBeNull()
  })

  it('finds exact duplicate claim numbers without partial matches', () => {
    const rows = [
      { id: 'ro-1', claim_number: 'CLM-100' },
      { id: 'ro-2', insurance_claim_number: 'CLM-100-OLD' },
    ]
    expect(findAppraisalClaimMatches(rows, 'clm-100')).toEqual([rows[0]])
  })
})
