import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCccEstimate } = require('../src/services/cccExtractor');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

describe('parseCccEstimate', () => {
  it('extracts CCC line items, labor buckets, and reconciling totals in cents', () => {
    const parsed = parseCccEstimate(fixture('ccc-estimate-totals.txt'));

    expect(parsed).toEqual({
      insurance_company: 'Example Mutual Insurance',
      claim_number: 'SYN-CCC-1001',
      adjuster_name: null,
      adjuster_phone: null,
      adjuster_email: null,
      customer_name: 'Riley Parker',
      customer_phone: null,
      vehicle: '2022 Honda Accord EX',
      vin: '1HGCV1F30NA000001',
      vehicle_year: '2022',
      vehicle_make: 'Honda',
      vehicle_model: 'Accord EX',
      estimate_totals: {
        parts: 297673,
        body_labor_hours: 48.2,
        body_labor_rate: 5000,
        body_labor_cost: 241000,
        paint_labor_hours: 20.5,
        paint_labor_rate: 5000,
        paint_labor_cost: 102500,
        mechanical_labor_hours: 2.2,
        mechanical_labor_rate: 5000,
        mechanical_labor_cost: 11000,
        frame_labor_hours: 0,
        frame_labor_rate: 0,
        frame_labor_cost: 0,
        glass_labor_hours: 0,
        glass_labor_rate: 0,
        glass_labor_cost: 0,
        paint_supplies_hours: 20.5,
        paint_supplies_rate: 3000,
        paint_supplies_cost: 61500,
        miscellaneous: 0,
        other_charges: 0,
        costs_total: 0,
        subtotal: 713673,
        sales_tax_basis: 713673,
        sales_tax_rate: 8.875,
        sales_tax_cost: 63338,
        county_tax_basis: 0,
        county_tax_rate: 0,
        county_tax_cost: 0,
        other_tax_1_basis: 0,
        other_tax_1_rate: 0,
        other_tax_1_cost: 0,
        total_cost_of_repairs: 777011,
        deductible: 0,
        total_adjustments: 0,
        net_cost_of_repairs: 777011,
        revenue: 777011,
      },
      line_items: [
        {
          type: 'labor',
          description: 'Front bumper cover',
          quantity: 1.2,
          unit_price: 5000,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 1.2,
          labor_type: 'body',
          price_cents: 5000,
          extended_cents: 6000,
        },
        {
          type: 'labor',
          description: 'Refinish front bumper cover',
          quantity: 2.5,
          unit_price: 5000,
          operation_code: 'Refn',
          operation: 'Refn',
          part_number: null,
          part_type: null,
          labor_units: 2.5,
          labor_type: 'paint',
          price_cents: 5000,
          extended_cents: 12500,
        },
        {
          type: 'parts',
          description: 'Grille assembly',
          quantity: 1,
          unit_price: 42510,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: '71121-TVA-A01',
          part_type: 'OEM',
          labor_units: null,
          labor_type: null,
          price_cents: 42510,
          extended_cents: 42510,
        },
        {
          type: 'labor',
          description: 'Aim front radar sensor',
          quantity: 0.8,
          unit_price: 5000,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 0.8,
          labor_type: 'mechanical',
          price_cents: 5000,
          extended_cents: 4000,
        },
        {
          type: 'parts',
          description: 'Bumper bracket',
          quantity: 1,
          unit_price: 7550,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'AM-1042',
          part_type: 'aftermarket',
          labor_units: null,
          labor_type: null,
          price_cents: 7550,
          extended_cents: 7550,
        },
        {
          type: 'parts',
          description: 'Left headlamp assembly',
          quantity: 1,
          unit_price: 12000,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'LKQ-8821',
          part_type: 'recycled',
          labor_units: null,
          labor_type: null,
          price_cents: 12000,
          extended_cents: 12000,
        },
        {
          type: 'parts',
          description: 'Reconditioned wheel',
          quantity: 1,
          unit_price: 21000,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'RW-2200',
          part_type: 'reconditioned',
          labor_units: null,
          labor_type: null,
          price_cents: 21000,
          extended_cents: 21000,
        },
        {
          type: 'sublet',
          description: 'Hazardous waste disposal',
          quantity: 1,
          unit_price: 3500,
          operation_code: 'Subl',
          operation: 'Subl',
          part_number: null,
          part_type: null,
          labor_units: null,
          labor_type: null,
          price_cents: 3500,
          extended_cents: 3500,
        },
      ],
      total_allowed: null,
      detected_format: 'ccc',
      needs_review: false,
      review_reasons: [],
    });
  });

  it('marks malformed CCC estimates for review without silently plugging tax or other', () => {
    const parsed = parseCccEstimate(fixture('ccc-estimate-low-confidence.txt'));

    expect(parsed.needs_review).toBe(true);
    expect(parsed.review_reasons).toEqual(expect.arrayContaining([
      'low_confidence_line_1',
      'low_confidence_line_2',
      'total_cost_does_not_reconcile',
    ]));
    expect(parsed.estimate_totals.sales_tax_cost).toBe(3200);
    expect(parsed.estimate_totals.other_charges).toBe(0);
    expect(parsed.estimate_totals.total_cost_of_repairs).toBe(45000);
    expect(parsed.line_items).toEqual([]);
  });
});
