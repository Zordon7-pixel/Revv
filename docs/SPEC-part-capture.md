# Photo-to-part inventory sequence — 2026-09-26

## Delivered in this branch

Shop Inventory → Scan part label → photograph/upload → review number and brand → find shop stock and external candidates → review existing stock or prefill a new item → confirm quantity/location and save. This branch starts from main c46aa0d and is independent of e-signature PR #15. It is not deployed.

A browser resizes JPEG/PNG/WebP photos to at most 1600px and strips original metadata by canvas encoding. Server uploads are memory-only, limited to one 4MB image, with image-signature checks and staff/shop authentication before paid processing. The existing Anthropic integration reads only printed label information. No image is published or retained by REVV; provider processing/retention follows its configured account. Reviewable transcription can be saved as item provenance after confirmation. Unsupported HEIC inputs get an explicit conversion instruction. Barcode decoding without printed text is not implemented.

Shop matching normalizes case and separators, preserving O/0 and I/1. Results show on-hand counts and bin, with brand conflict warnings. Known distinct brands can share a number; same/unknown-brand collisions prevent creation. Creation/editing uses a per-shop PostgreSQL advisory transaction lock, so simultaneous normalized duplicates cannot both succeed through the application. Existing ambiguous records remain editable; no existing inventory rows are deleted or merged. These are on-hand counts, not reservations or guaranteed available-to-promise counts.

The external adapter uses official eBay OAuth client credentials plus Browse search/item APIs for US Motors parts. It retrieves seller-provided descriptions, photos, aspects/specifications, listing price, condition, and source link. It never treats a listing as verified manufacturer fitment or copies listing price into inventory cost. Different candidate numbers/brands require another stock search before prefill; missing MPN cannot prefill. No mock/generated catalog fallback is called. Manufacturer/supplier feeds can be added once the shops identify their suppliers and provide supported API access.

No inventory mutation occurs during extraction or lookup. Staff explicitly save the review form, including actual quantity. Source data is staff-confirmed provenance, not a provider attestation. New parts have no inferred quantity, bin, compatibility, cost, supplier relationship, or reservation.

## Files and routes

- `backend/src/services/partCapture.js`: bounded photo extraction and sourced external candidate lookup.
- `backend/src/services/stockCapture.js`: shared schema, normalized matching, validation, transactional saves.
- `backend/src/routes/partCapture.js`: authenticated, rate-limited `/capabilities`, `/extract`, `/lookup`.
- `backend/src/routes/inventory.js`: existing create/edit API now uses shared stock service.
- `backend/src/db/index.js`: startup invokes the same idempotent stock migration.
- `frontend/src/components/PartCapture.jsx`: mobile/desktop capture, review, source selection, stale-request protection.
- `frontend/src/pages/Inventory.jsx`: scan action, brand display and stock confirmation.

Schema migration adds `brand` and `source_details`, preserves legacy cost-only rows, supports UUID/TEXT shop identifiers, and replaces the old `(shop_id,part_number)` unique index with a normalized lookup index. Brand-aware duplicate enforcement is in the locked save service; future import/stock writers must use that service or the same lock/check protocol. Older code should not run alongside this branch during rollout because it can recreate the old uniqueness rule. A rollback should retain the new columns/data and account for legitimate distinct-brand same-number records.

## Configuration and validation

- `ANTHROPIC_API_KEY`: valid server-side image-reading credentials; optional `PART_LABEL_MODEL`.
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`: approved production Browse API access; server-side only. No credentials entered in the client.
- Missing/failed providers return explicit unavailable states while typed-number shop matching remains usable. Tokens are short-lived, cached in memory, and excluded from responses. Provider requests have bounded timeouts; source URLs/images are HTTPS-host allowlisted. Capture/inventory payloads are scrubbed from Sentry events.

Local verification: 129 frontend checks; 20 backend checks including disposable PostgreSQL, UUID/TEXT legacy schema, preserved cost, tenant separation, duplicate/concurrent saves, brand ambiguity and existing mixed-ID guards. Frontend production build passed. Independent reviewer separately ran 16 backend and 6 frontend checks and reported no blockers. Desktop/mobile Chromium verified actual photo resizing/upload, mocked provider results, real database creation and existing-stock review; no page errors or horizontal overflow.

Live extraction was attempted once with a synthetic label and the existing local credential was rejected (401). No production provider success is claimed. External catalog credentials were absent locally, so the OAuth/search/detail integration was tested with fixtures, not a live account. Production activation still requires valid provider access and a real-label acceptance check. No real customer information was used.

Commands (from repository root unless noted):

```
PARTS_TEST_DATABASE_URL=postgresql://revv_test@127.0.0.1:55439/revv_parts_test node --test backend/test/partCapture.test.js backend/test/stockCapture.integration.test.js backend/test/idTypeCastGuard.test.js
# From frontend/
npm run test:run
npm run build
```

The PostgreSQL test suite accepts only a localhost database named `revv_parts_test`; it creates/drops an isolated schema. No standalone lint/typecheck scripts are defined.

This build covers the numbered photo-to-stock sequence. Supplier order synchronization, delivery ETA changes, customer notifications, and inventory reservations remain separate work; no messages were sent and no production stock was changed.

Provider references: https://platform.claude.com/docs/en/build-with-claude/vision ; https://developer.ebay.com/api-docs/buy/api-browse.html ; https://developer.ebay.com/develop/guides/sell/authorization .
