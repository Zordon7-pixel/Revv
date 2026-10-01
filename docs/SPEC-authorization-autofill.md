# Authorization autofill — guarded scope, corrected 2026-10-01

The September 27 record referenced production `9291a5f` and branch `codex/revv-autofill-20260927`. That historical reference does not establish current deployment, tenant import or legal approval. This implementation is not deployment approval. Current mission boundaries and verification commands are in [readiness remediation](READINESS-REMEDIATION-20261001.md).

## Actual preparation scope

`agreementAutofill.js` supplies a tenant-scoped RO/customer/vehicle summary, saved RO dollar total, deductible and source labels. A draft marked `needs_review` suppresses the suggested total; no total is inferred from OCR rows, net insurer payments or legacy ambiguous-unit estimate fields. Deductible still comes from the saved RO and requires staff review. Missing/invalid values remain staff inputs. The estimate reference is a label derived from saved timestamps, not an independently signed estimate archive.

Loss date comes from a valid saved RO loss date, or the latest non-voided intake preparation when name, VIN and claim match. This lookup is within the same RO/shop; it does not require that earlier intake to be signed. Completion is stricter: both preview and creation require a signed intake for the same shop/RO/template and matching name, VIN and claim (including matching blank claims).

Prepared PDFs are limited to the three recognized Miles profiles in `milesAgreements.js`, gated by exact tenant ID, preparation kind and pinned original-PDF hash. Other shops' static uploaded PDFs do not acquire automatic field maps. Revised attorney-review PDFs remain inactive; no import or legal signoff is claimed here.

The preparation, prepared preview and creation routes use repeatable-read source snapshots. Prepared preview/create require a current lowercase 64-hex `source_revision`; missing, null, malformed and stale values fail with 409. Static-template creation may omit the property; if present, it must pass the same strict check. The frontend sends revisions for prepared templates. Static creation without a revision does not receive the prepared-source freshness guarantee.

Staff review money, stage and overrides. The UI resets review on edits and discards stale responses after switching ROs. Preview validates supplied or saved email using the same helper as creation, before display truncation; absent email remains allowed for tablet signing. Preview creates no signing request, token or audit event and sends no notification. Prepared creation freezes the document/details; signing and downloads compare stored document hashes. These hashes do not make audit events hash-chained or JSON audit exports cryptographically signed.

## Phase2 source disposition and remaining verification

Source and existing tests cover mandatory prepared/optional strict static revisions, invalid/null email parity, completion claim matching, and owner/admin-only void of pending requests. `awaiting_shop` still blocks duplicate creation but cannot be voided; conflict copy now says only pending requests can be voided by an owner/admin. The UI exposes void only for pending requests with manager capability. This phase inspects those results without claiming a new PostgreSQL, frontend/browser or PDF visual pass.

Hermes must run the explicit local disposable database tests and frontend gates on the final committed SHA. Historical test counts or production references do not satisfy that gate. Browser checks with synthetic data, PDF visual inspection, any Miles import and legal approval require their own actual evidence. No merge/deploy is part of this implementation mission. OpenAI/eBay/Twilio/Resend remain LIVE UNKNOWN; no provider credential inspection or activation is performed.
