# REVV Estimate Import — Tier 1: Reliable per-RO Revenue + Labor/Paint Rates from PDF

> Supersedes the BMS-XML direction for Miles. Miles receives insurer-written CCC ONE estimate PDFs (not data files), so this is a PDF-extraction-QUALITY fix on the existing OCR path, NOT a new feed. Scope = the financial totals block only (Tier 2 = line-item table, separate).

## Goal
Miles uploads an insurance estimate PDF → the app reliably extracts the ESTIMATE TOTALS (labor rate, paint rate, category hours+costs, parts, subtotal, tax, net) and shows **what each RO brings into the shop**. Today this silently returns nulls on real CCC estimates.

## Root cause (confirmed against a real Miles CCC estimate)
`parseEstimateTotalsFromPdfText` (backend/src/routes/insuranceOcr.js ~line 182) assumes spaced text, but pdf-parse extracts CCC totals with the LABEL GLUED TO THE VALUE and no separating space, e.g. the real line is:
`Body Labor48.2 hrs@$ 50.00 /hr2,410.00`
The label finder `/^Body Labor\b/i` fails because `\b` cannot match between 
