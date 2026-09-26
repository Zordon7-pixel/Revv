# REVV agreements and electronic signatures

## Delivered first version — 2026-09-26

Built from production base c46aa0d on codex/revv-esignatures-20260926. This feature is not deployed.

- Owners/admins upload reusable static PDF templates in Settings → Core (10MB, 1–50 pages). Each upload creates a new immutable document version. Archiving a template prevents new requests without changing existing requests.
- Templates optionally require up to 12 named customer-initial sections and an owner/admin shop countersignature.
- Repair orders have an Agreements tab. Staff prepare a request using a fixed template and customer/RO/shop snapshot, then copy a private link or open it for signing on a shop tablet. The application does not automatically send SMS or email.
- Customer page renders the PDF with a locally hosted PDF.js worker, fonts and CMaps; supports page navigation, zoom and original download. Typed name, required initials and explicit electronic-signature consent are recorded.
- A signature record is appended to copies of the original pages. Signatures/initials are not overlaid at arbitrary positions in the uploaded PDF. This is a typed electronic-signature workflow, not a certificate-based PDF digital signature or independent identity-verification service.
- A final PDF becomes available after all required signatures. Until a required shop countersignature is added, the customer sees a saved-signature confirmation and can check status at the same link.
- Staff can download the original, final PDF and JSON signing record. Settings includes a searchable, paginated agreement archive, which remains usable if an RO is removed.

## Storage, authorization and record integrity

The new schema is idempotently initialized on first agreement request. New tables are `agreement_templates`, `agreement_requests`, and append-only-through-the-API `agreement_events`. PDFs are stored as private PostgreSQL BYTEA records, not public `/uploads` files; include the database in backup/retention operations. New IDs use UUIDs while shop/RO reference values use TEXT for compatibility with existing deployments. Historical agreement records intentionally do not cascade with RO deletion.

Every staff operation requires a shop-scoped staff JWT. Upload/archive and shop countersign/archive-list actions require owner/admin. Public access uses a random 256-bit bearer token; only its SHA-256 hash is stored. Shared URLs carry the secret in the fragment, and API calls use the Authorization header. Links expire after 30 days and replacement invalidates the old link, including any old document-open acknowledgement. Replacing a link never changes a signature or document.

Signing transactions lock the request row. Explicit boolean consent, current consent version, reviewed-document acknowledgement, original PDF hash and required initials are checked before writing. Duplicate or concurrent signing cannot replace a saved signature. Signed requests cannot be voided; a pending request can. A partial unique index prevents duplicate unsigned requests for the same template and RO.

Original and completed PDF hashes, server timestamps, signer names/initials, consent text/version, IP, user agent and authenticated shop actor are recorded. Document hashes are checked on source/final download. Customers are identified by possession of the private link and their entered name; there is no OTP or ID-document check. Do not describe this as verified identity or a guarantee of legal enforceability.

Signing pages suppress automatic feedback/Sentry reporting. Signing fragments are scrubbed from retained telemetry on later pages; agreement API bodies and authentication headers are scrubbed. Canvas PDF rendering does not execute PDF JavaScript. Uploaded PDFs must be unencrypted and have no interactive form fields or existing digital signatures.

## Verification and operation

The real-database integration suite uses only `AGREEMENTS_TEST_DATABASE_URL` pointing to localhost database `revv_esign_test`. Each run creates and drops its own schema. It never uses the application production database URL.

```
# backend directory; disposable local PostgreSQL database required
AGREEMENTS_TEST_DATABASE_URL=postgresql://revv_test@127.0.0.1:55439/revv_esign_test node --test test/agreements.test.js test/agreements.integration.test.js
# frontend directory
npm run test:run
npm run build
```

PDF.js browser resources are copied from the pinned package by `prebuild` and `predev`. Generated `frontend/public/pdfjs/` and `frontend/dist/` are not committed. Noto Sans is embedded in signature records; its OFL license ships with the font. Unsupported signer-name glyphs are rejected instead of silently replacing legal-name characters. Existing records use exact original PDF bytes; PDF page copying plus the appended record was visually verified with synthetic inputs.

Local QA includes disposable PostgreSQL lifecycle/tenant/expiry/replay/concurrency/retention tests; frontend signing and privacy tests; browser desktop/mobile signature and download; canvas rendering, multi-page navigation, zoom and scroll-reset checks; PDF rendering of accented names and a four-page result with all 12 initials and both signatures. No real customer contract or production signing has been exercised.

Final checks: frontend 132/132; backend agreement and estimate regressions 35/35; production frontend build passed. Independent review found no unresolved blockers and separately reran 12 frontend checks and 13 backend checks. The project does not define standalone lint or typecheck scripts.

## Shop configuration still needed

The shop's approved PDF agreement, whether the shop must countersign, and the exact page/section labels requiring initials. The first version can be configured for customer-only or customer-plus-shop without code changes. If signatures must appear directly on particular original-page signature lines, define those coordinates/fields and add a placement editor in a follow-up; the current version appends a signature record. Automatic delivery, stronger signer verification, drawn signatures, and specialized signing providers are not part of this first version.
