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
  it('extracts CCC line items, labor buckets, and reconciling totals in dollars', () => {
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
        parts: 2976.73,
        body_labor_hours: 48.2,
        body_labor_rate: 50,
        body_labor_cost: 2410,
        paint_labor_hours: 20.5,
        paint_labor_rate: 50,
        paint_labor_cost: 1025,
        mechanical_labor_hours: 2.2,
        mechanical_labor_rate: 50,
        mechanical_labor_cost: 110,
        frame_labor_hours: 0,
        frame_labor_rate: 0,
        frame_labor_cost: 0,
        glass_labor_hours: 0,
        glass_labor_rate: 0,
        glass_labor_cost: 0,
        paint_supplies_hours: 20.5,
        paint_supplies_rate: 30,
        paint_supplies_cost: 615,
        miscellaneous: 0,
        other_charges: 0,
        costs_total: 0,
        subtotal: 7136.73,
        sales_tax_basis: 7136.73,
        sales_tax_rate: 8.875,
        sales_tax_cost: 633.38,
        county_tax_basis: 0,
        county_tax_rate: 0,
        county_tax_cost: 0,
        other_tax_1_basis: 0,
        other_tax_1_rate: 0,
        other_tax_1_cost: 0,
        total_cost_of_repairs: 7770.11,
        deductible: 0,
        total_adjustments: 0,
        net_cost_of_repairs: 7770.11,
        revenue: 7770.11,
      },
      line_items: [
        {
          type: 'labor',
          description: 'Front bumper cover',
          quantity: 1.2,
          unit_price: 50,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 1.2,
          labor_type: 'body',
          extended: 60,
        },
        {
          type: 'labor',
          description: 'Refinish front bumper cover',
          quantity: 2.5,
          unit_price: 50,
          operation_code: 'Refn',
          operation: 'Refn',
          part_number: null,
          part_type: null,
          labor_units: 2.5,
          labor_type: 'paint',
          extended: 125,
        },
        {
          type: 'parts',
          description: 'Grille assembly',
          quantity: 1,
          unit_price: 425.1,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: '71121-TVA-A01',
          part_type: 'OEM',
          labor_units: null,
          labor_type: null,
          extended: 425.1,
        },
        {
          type: 'labor',
          description: 'Aim front radar sensor',
          quantity: 0.8,
          unit_price: 50,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 0.8,
          labor_type: 'mechanical',
          extended: 40,
        },
        {
          type: 'parts',
          description: 'Bumper bracket',
          quantity: 1,
          unit_price: 75.5,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'AM-1042',
          part_type: 'aftermarket',
          labor_units: null,
          labor_type: null,
          extended: 75.5,
        },
        {
          type: 'parts',
          description: 'Left headlamp assembly',
          quantity: 1,
          unit_price: 120,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'LKQ-8821',
          part_type: 'recycled',
          labor_units: null,
          labor_type: null,
          extended: 120,
        },
        {
          type: 'parts',
          description: 'Reconditioned wheel',
          quantity: 1,
          unit_price: 210,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'RW-2200',
          part_type: 'reconditioned',
          labor_units: null,
          labor_type: null,
          extended: 210,
        },
        {
          type: 'sublet',
          description: 'Hazardous waste disposal',
          quantity: 1,
          unit_price: 35,
          operation_code: 'Subl',
          operation: 'Subl',
          part_number: null,
          part_type: null,
          labor_units: null,
          labor_type: null,
          extended: 35,
        },
      ],
      total_allowed: null,
      detected_format: 'ccc',
      needs_review: false,
      review_reasons: [],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/_cents"\s*:/);
  });

  it('marks malformed CCC estimates for review without silently plugging tax or other', () => {
    const parsed = parseCccEstimate(fixture('ccc-estimate-low-confidence.txt'));

    expect(parsed.needs_review).toBe(true);
    expect(parsed.review_reasons).toEqual(expect.arrayContaining([
      'low_confidence_line_1',
      'low_confidence_line_2',
      'total_cost_does_not_reconcile',
    ]));
    expect(parsed.estimate_totals.sales_tax_cost).toBe(32);
    expect(parsed.estimate_totals.other_charges).toBe(0);
    expect(parsed.estimate_totals.total_cost_of_repairs).toBe(450);
    expect(parsed.line_items).toEqual([]);
  });
});
