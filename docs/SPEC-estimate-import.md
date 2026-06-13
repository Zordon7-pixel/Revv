# REVV Estimate Import — Structured BMS Ingestion (supersedes OCR feed)

> Status: DRAFT — scope locked to **Option 1 (single CIECA BMS XML parser)** 2026-06-13.
> Supersedes: `backend/src/routes/insuranceOcr.js` as the *primary* feed. OCR stays as degraded fallback only.
> Build gate: synthetic CIECA fixture validates parser; **one real Miles BMS export required for manual proof before ship.**

## 1. Problem / Goal
Today estimates enter REVV via OCR (`insuranceOcr.js`: pdf-parse + OpenAI + regex on Body/Paint labor lines).
OCR mangles labor units and part numbers, so the front desk retypes everything. Goal: kill double-entry by
ingesting a real structured estimate export (CIECA BMS XML) that maps directly to the `parsed` contract the
`EstimateImportWizard` already consumes — enriched with operation / labor / part-type / part-number — and
creates RO + customer + vehicle + parts-requests + operations through existing creation paths. Wizard becomes
the preview/confirm step. OCR remains only when no BMS export is available.

## 2. Scope decision (Option 1 — LOCKED)
Different Miles estimators author in different programs (CCC ONE / Mitchell / Audatex). Rather than build three
per-program parsers, **standardize the intake on CIECA BMS XML** — the industry interchange standard all three can
export. Build ONE safe XML parser. Programs that cannot export BMS fall back to OCR. This avoids a 3-parser fork
and covers every estimator with one code path.

## 3. The `parsed` contract (MUST MATCH EXACTLY — source: insuranceOcr.js:573-588, EstimateImportWizard.jsx:51-54)
```
parsed: {
  insurance_company, claim_number, adjuster_name, adjuster_phone, adjuster_email,
  customer_name, customer_phone,
  vehicle, vin, vehicle_year, vehicle_make, vehicle_model,
  total_allowed, estimate_totals,
  line_items: [{
    description: string,
    type: 'labor' | 'parts' | 'sublet' | 'other',   // wizard whitelist EstimateImportWizard.jsx:54
    quantity: number,
    unit_price: number,
    // --- NEW enrichment fields (additive, backward-compatible) ---
    operation_code: string|null,   // RNI/R&I/RPR/REPL/REFN/BLND etc from BMS
    labor_units: number|null,      // BMS labor hours/units (the field OCR mangles)
    part_type: string|null,        // OEM / aftermarket / recycled / remanufactured
    part_number: string|null       // BMS part number (the other field OCR mangles)
  }]
}
```
New fields are additive — wizard ignores unknown keys today, so OCR path stays valid. Operation→type mapping reuses
existing `classifyByOperationCodes` semantics (RNI/R&I/RPR = labor, not parts).

## 4. Architecture
- **New module** `backend/src/lib/bmsParser.js` — pure function `parseBms(xmlBuffer) -> parsed` (no I/O, unit-testable).
- **New route** `POST /api/estimate-import/parse-bms` mounted in `backend/src/app.js` next to `insurance-ocr`
  (`app.use('/api/estimate-import', require('./routes/estimateImport'))`). `auth` + same rate-limiter pattern.
- Wizard (EstimateImportWizard.jsx) unchanged contract-wise; gains a second source button (Import BMS)
  that POSTs the XML file to the new route and feeds the returned parsed object into the existing preview/confirm UI.
- XML library: fast-xml-parser (pure-JS, no native build). DTD/entity processing OFF -> XXE-safe by construction.

## 5. Security guardrails (NON-NEGOTIABLE - ship blockers)
- XXE off: parser MUST disable DTD, external entities, and entity expansion. No network/file access from XML.
- shop_id scoping: route runs under auth; every created RO/customer/vehicle/parts-request/operation is written
  through the existing creation paths so shop_id is enforced exactly as the OCR path does. Parser itself creates nothing.
- Miles data untouched: parser is a pure function returning parsed; it never reads/writes existing Miles tables.
- Size/shape limits: reject over 5MB, reject non-XML mime, cap line_items at a sane bound, same rate-limiter as OCR.

## 6. Phases
### Phase 1 - Parser + fixture + unit tests (NO route, NO UI)
- WHAT: backend/src/lib/bmsParser.js exporting pure parseBms(xmlBuffer) -> parsed; add fast-xml-parser dep
  (XXE-safe config); synthetic CIECA BMS fixture backend/test/fixtures/cieca-sample.xml; unit tests
  backend/test/bmsParser.test.js covering header mapping, line_items (labor/parts/sublet), operation->type via
  classifyByOperationCodes semantics, enrichment fields (operation_code/labor_units/part_type/part_number), plus an
  XXE-attack fixture that MUST parse inert (no entity expansion, no external fetch).
- WHY: prove the parser against the locked parsed contract with zero wiring risk; testable without a real export.
- HOW: reuse classification semantics from insuranceOcr.js; output shape MUST equal the OCR parsed object plus
  additive fields. No I/O in the module.
- GATE: npm test green in backend; XXE fixture proves no entity expansion; output validated field-by-field vs contract.

### Phase 2 - Route + wiring
- WHAT: backend/src/routes/estimateImport.js with POST /api/estimate-import/parse-bms (auth + rate-limit + size/mime
  guards), mounted in app.js next to insurance-ocr; calls parseBms, returns success+parsed envelope identical to OCR.
- WHY: expose the parser to the wizard behind the same auth/scoping as OCR.
- HOW: mirror insuranceOcr.js route guards; no new creation logic - returns parsed for the wizard to confirm.
- GATE: route test (supertest) for auth-required, size/mime rejection, happy path returns contract; OCR tests stay green.

### Phase 3 - Wizard Import-BMS source + manual proof
- WHAT: add a BMS source option to EstimateImportWizard; feed the returned parsed object into the existing
  preview/confirm flow; OCR stays as the fallback source.
- WHY: kill double-entry end-to-end through the existing confirm UI.
- HOW: additive UI only; existing OCR flow untouched.
- GATE: frontend test for the new source path; manual proof against one real Miles BMS export before ship (build gate).

## 7. Definition of Done
- Phases 1-3 each run the loop: Codex build -> Claude Code QA executes tests -> Hermes review -> ship.
- 0 CRITICAL and 0 unresolved HIGH; MED/LOW go to backlog Phase Nb in DAILY-OPS.
- XXE-safe proven by test; OCR fallback intact; Miles tables provably untouched.
- Ship of Phase 3 is blocked until one real Miles BMS export validates manually.
