import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMitchellEstimate } = require('../src/services/mitchellExtractor');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

describe('parseMitchellEstimate', () => {
  it('extracts Mitchell line items, labor buckets, part metadata, and reconciling totals in dollars', () => {
    const parsed = parseMitchellEstimate(fixture('mitchell-estimate-synthetic.txt'));

    expect(parsed).toEqual({
      insurance_company: 'Sample Casualty',
      claim_number: 'SYN-MIT-2002',
      adjuster_name: null,
      adjuster_phone: null,
      adjuster_email: null,
      customer_name: 'Jordan Ellis',
      customer_phone: null,
      vehicle: '2021 Toyota Camry SE',
      vin: '4T1G11AK0MU000002',
      vehicle_year: '2021',
      vehicle_make: 'Toyota',
      vehicle_model: 'Camry SE',
      estimate_totals: {
        parts: 1033,
        body_labor_hours: 3.6,
        body_labor_rate: 60,
        body_labor_cost: 216,
        paint_labor_hours: 2.8,
        paint_labor_rate: 60,
        paint_labor_cost: 168,
        mechanical_labor_hours: 1.5,
        mechanical_labor_rate: 60,
        mechanical_labor_cost: 90,
        frame_labor_hours: 0.5,
        frame_labor_rate: 60,
        frame_labor_cost: 30,
        glass_labor_hours: 0.4,
        glass_labor_rate: 60,
        glass_labor_cost: 24,
        paint_supplies_hours: 0,
        paint_supplies_rate: 0,
        paint_supplies_cost: 84,
        miscellaneous: 0,
        other_charges: 165,
        costs_total: 0,
        subtotal: 1810,
        sales_tax_basis: 1033,
        sales_tax_rate: 8.875,
        sales_tax_cost: 91.65,
        county_tax_basis: 0,
        county_tax_rate: 0,
        county_tax_cost: 0,
        other_tax_1_basis: 0,
        other_tax_1_rate: 0,
        other_tax_1_cost: 0,
        total_cost_of_repairs: 1901.65,
        deductible: 500,
        total_adjustments: 0,
        net_cost_of_repairs: 1401.65,
        revenue: 1401.65,
      },
      line_items: [
        {
          type: 'labor',
          description: 'Front bumper cover',
          quantity: 1.4,
          unit_price: 60,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 1.4,
          labor_type: 'body',
          extended: 84,
        },
        {
          type: 'parts',
          description: 'Front bumper cover',
          quantity: 1,
          unit_price: 512.4,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: '52119-06999',
          part_type: 'OEM',
          labor_units: null,
          labor_type: null,
          extended: 512.4,
        },
        {
          type: 'labor',
          description: 'Repair left fender',
          quantity: 3.8,
          unit_price: 60,
          operation_code: 'RPR',
          operation: 'RPR',
          part_number: null,
          part_type: null,
          labor_units: 3.8,
          labor_type: 'paint',
          extended: 228,
        },
        {
          type: 'labor',
          description: 'Blend left front door',
          quantity: 1.2,
          unit_price: 60,
          operation_code: 'Blend',
          operation: 'Blend',
          part_number: null,
          part_type: null,
          labor_units: 1.2,
          labor_type: 'paint',
          extended: 72,
        },
        {
          type: 'labor',
          description: 'Pre-repair scan',
          quantity: 1.5,
          unit_price: 60,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 1.5,
          labor_type: 'mechanical',
          extended: 90,
        },
        {
          type: 'labor',
          description: 'Frame setup and measure',
          quantity: 0.5,
          unit_price: 60,
          operation_code: 'RPR',
          operation: 'RPR',
          part_number: null,
          part_type: null,
          labor_units: 0.5,
          labor_type: 'frame',
          extended: 30,
        },
        {
          type: 'labor',
          description: 'Replace windshield glass',
          quantity: 0.4,
          unit_price: 60,
          operation_code: 'R&I',
          operation: 'R&I',
          part_number: null,
          part_type: null,
          labor_units: 0.4,
          labor_type: 'glass',
          extended: 24,
        },
        {
          type: 'parts',
          description: 'Bumper reinforcement',
          quantity: 1,
          unit_price: 225,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'AM-8842',
          part_type: 'aftermarket',
          labor_units: null,
          labor_type: null,
          extended: 225,
        },
        {
          type: 'parts',
          description: 'Left headlamp assembly',
          quantity: 1,
          unit_price: 170,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'LKQ-1402',
          part_type: 'recycled',
          labor_units: null,
          labor_type: null,
          extended: 170,
        },
        {
          type: 'parts',
          description: 'Reconditioned alloy wheel',
          quantity: 1,
          unit_price: 125.6,
          operation_code: 'Repl',
          operation: 'Repl',
          part_number: 'RW-3100',
          part_type: 'reconditioned',
          labor_units: null,
          labor_type: null,
          extended: 125.6,
        },
        {
          type: 'sublet',
          description: 'Sublet alignment',
          quantity: 1,
          unit_price: 165,
          operation_code: 'Subl',
          operation: 'Subl',
          part_number: null,
          part_type: null,
          labor_units: null,
          labor_type: null,
          extended: 165,
        },
      ],
      total_allowed: null,
      detected_format: 'mitchell',
      needs_review: false,
      review_reasons: [],
    });

    const totals = parsed.estimate_totals;
    const laborCents = cents(totals.body_labor_cost)
      + cents(totals.paint_labor_cost)
      + cents(totals.mechanical_labor_cost)
      + cents(totals.frame_labor_cost)
      + cents(totals.glass_labor_cost);
    const subtotalCents = cents(totals.parts) + laborCents + cents(totals.paint_supplies_cost) + cents(totals.other_charges);
    expect(subtotalCents).toBe(cents(totals.subtotal));
    expect(subtotalCents + cents(totals.sales_tax_cost)).toBe(cents(totals.total_cost_of_repairs));
    expect(cents(totals.total_cost_of_repairs) - cents(totals.deductible)).toBe(cents(totals.net_cost_of_repairs));
    expect(JSON.stringify(parsed)).not.toMatch(/"_?[a-zA-Z0-9]*_cents"/);
  });

  it('marks malformed Mitchell estimates for review without silently plugging tax or other', () => {
    const parsed = parseMitchellEstimate(fixture('mitchell-estimate-low-confidence.txt'));

    expect(parsed.needs_review).toBe(true);
    expect(parsed.review_reasons).toEqual(expect.arrayContaining([
      'low_confidence_line_1',
      'low_confidence_line_2',
      'sales_tax_total_unreadable',
      'total_cost_does_not_reconcile',
    ]));
    expect(parsed.estimate_totals.sales_tax_cost).toBe(0);
    expect(parsed.estimate_totals.other_charges).toBe(0);
    expect(parsed.estimate_totals.total_cost_of_repairs).toBe(570);
    expect(parsed.line_items).toEqual([]);
  });
});
