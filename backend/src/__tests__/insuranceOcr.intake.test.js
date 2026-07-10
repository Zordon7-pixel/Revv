const assert = require('node:assert/strict');
const test = require('node:test');

const { INTAKE_PROMPT, normalizeIntakeParsed } = require('../routes/insuranceOcr');

test('appraisal intake normalizes metadata without estimate lines or totals', () => {
  const parsed = normalizeIntakeParsed({
    customer_name: 'Miles Customer',
    customer_phone: '(718) 555-0100',
    customer_email: 'miles@example.com',
    customer_address: '10 Main St',
    insurance_company: 'Progressive',
    claim_number: 'CLM-100',
    policy_number: 'POL-200',
    vehicle: '2024 Toyota Camry',
    vin: '1HGBH41JXMN109186',
    vehicle_color: 'Black',
    vehicle_plate: 'REVV24',
    vehicle_mileage: '12500',
    deductible: -1000,
    estimate_totals: { total_cost_of_repairs: 9969.25 },
    line_items: [{ description: 'Bumper', type: 'parts', quantity: 1, unit_price: 500 }],
  }, 'mitchell');

  assert.equal(parsed.intake_only, true);
  assert.equal(parsed.vehicle_year, '2024');
  assert.equal(parsed.vehicle_make, 'Toyota');
  assert.equal(parsed.vehicle_model, 'Camry');
  assert.equal(parsed.deductible, 1000);
  assert.equal(parsed.policy_number, 'POL-200');
  assert.deepEqual(parsed.line_items, []);
  assert.equal(parsed.estimate_totals, null);
});

test('appraisal intake prompt explicitly excludes estimate money and line items', () => {
  assert.match(INTAKE_PROMPT, /metadata only/i);
  assert.match(INTAKE_PROMPT, /Do not extract estimate line items, labor, parts, totals, or repair pricing/i);
  assert.doesNotMatch(INTAKE_PROMPT, /"line_items"/);
});
