# Shop stock and part-label capture — proposed design

## Current evidence

`backend/src/routes/inventory.js` already stores shop-scoped `parts_inventory` with part number, name, quantity on hand, reorder point, cost, supplier and shelf location. `backend/src/routes/catalog.js` instead calls `services/partsCatalog.js`, which uses supplier search when configured and otherwise falls back to static/sample parts and generated numbers, descriptions, prices, availability and suggested fitment. These catalog results are not evidence of stock owned by a shop.

## Proposed workflow

1. Make Shop Inventory the primary parts screen. Show quantity available, shelf/bin, condition, photo and reservation status. Keep supplier catalog/search as a separate, clearly labeled sourcing action; never display sample/generated availability as shop stock.
2. Capture a clear label/part-number photo on a phone or tablet. Prefer barcode extraction where available, then OCR the printed part number, manufacturer/brand and readable description. Keep the image, raw text, extraction source and any uncertain characters. OCR proposes fields; it does not infer physical quantity or shelf location.
3. Match normalized manufacturer + part number inside the authenticated shop first. Preserve the printed identifier. Normalize case, whitespace and separators for matching, but flag ambiguous O/0 or I/1 rather than silently changing them.
4. If the item is already recorded, display current quantity, reserved quantity, available quantity and location before offering Receive stock or Use stock. If new, prefill only observed or verified fields, and ask staff to confirm description, count, condition and bin.
5. Add a stock-movement ledger and transactional reservations linked to the RO. Receiving, reserving, consuming, returning and adjusting stock update counts atomically. Show who changed it and why; avoid double subtraction on retries.
6. Before a parts request/order, match the part number against this shop's available stock. Show 'Already available: 2, shelf B3' and offer reservation/use before purchase. Fitment or supersession requires a verified manufacturer/supplier source or staff confirmation.

## Inputs needed for implementation

A few representative photos of actual labels/part numbers (including difficult ones), the preferred shelf/bin naming scheme, whether new/used/returned parts must be separate, and who can adjust counts. Existing inventory can be reused; where a label only provides a number and no reliable catalog match exists, staff must supply the description. Supplier API credentials are needed only for verified external enrichment, not for OCR or matching existing shop stock.

This is an implementation proposal, not a built or deployed scanner. No inventory records were changed during the e-signature build.
