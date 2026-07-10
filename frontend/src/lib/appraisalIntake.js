function clean(value) {
  return String(value ?? '').trim()
}

function splitVehicle(value) {
  const parts = clean(value).split(/\s+/).filter(Boolean)
  const year = /^\d{4}$/.test(parts[0] || '') ? parts.shift() : ''
  return {
    year,
    make: parts.shift() || '',
    model: parts.join(' '),
  }
}

export function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

export function normalizeVin(value) {
  return clean(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

export function findAppraisalClaimMatches(ros = [], claimNumber = '') {
  const claim = clean(claimNumber).toLowerCase()
  if (!claim) return []
  return ros.filter((ro) => {
    const candidate = clean(ro?.insurance_claim_number || ro?.claim_number).toLowerCase()
    return candidate === claim
  })
}

export function parsedAppraisalToFields(parsed = {}) {
  const vehicle = splitVehicle(parsed.vehicle)
  return {
    customer_name: clean(parsed.customer_name),
    customer_phone: clean(parsed.customer_phone),
    customer_email: clean(parsed.customer_email),
    customer_address: clean(parsed.customer_address),
    year: clean(parsed.vehicle_year || vehicle.year),
    make: clean(parsed.vehicle_make || vehicle.make),
    model: clean(parsed.vehicle_model || vehicle.model),
    vin: normalizeVin(parsed.vin),
    color: clean(parsed.vehicle_color),
    plate: clean(parsed.vehicle_plate),
    mileage: clean(parsed.vehicle_mileage),
    insurer: clean(parsed.insurance_company),
    claim_number: clean(parsed.claim_number),
    policy_number: clean(parsed.policy_number),
    adjuster_name: clean(parsed.adjuster_name),
    adjuster_phone: clean(parsed.adjuster_phone),
    adjuster_email: clean(parsed.adjuster_email),
    deductible: clean(parsed.deductible ?? parsed.estimate_totals?.deductible),
  }
}

export function findAppraisalCustomerMatch(customers = [], fields = {}) {
  const phone = normalizePhone(fields.customer_phone)
  const email = clean(fields.customer_email).toLowerCase()

  if (phone) {
    const matches = customers.filter((customer) => normalizePhone(customer?.phone) === phone)
    if (matches.length === 1) return { customer: matches[0], reason: 'phone' }
  }

  if (email) {
    const matches = customers.filter((customer) => clean(customer?.email).toLowerCase() === email)
    if (matches.length === 1) return { customer: matches[0], reason: 'email' }
  }

  return null
}

export function findAppraisalVehicleMatch(vehicles = [], fields = {}) {
  const vin = normalizeVin(fields.vin)
  if (vin) {
    const matches = vehicles.filter((vehicle) => normalizeVin(vehicle?.vin) === vin)
    if (matches.length === 1) return { vehicle: matches[0], reason: 'VIN' }
  }

  const year = clean(fields.year).toLowerCase()
  const make = clean(fields.make).toLowerCase()
  const model = clean(fields.model).toLowerCase()
  if (year && make && model) {
    const matches = vehicles.filter((vehicle) => (
      clean(vehicle?.year).toLowerCase() === year
      && clean(vehicle?.make).toLowerCase() === make
      && clean(vehicle?.model).toLowerCase() === model
    ))
    if (matches.length === 1) return { vehicle: matches[0], reason: 'year/make/model' }
  }

  return null
}
