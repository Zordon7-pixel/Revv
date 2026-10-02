# Remy remediation — t_3ead3bd0, Phase 3 only

Implementation on `codex/revv-panel-estimator-20261001`, based on
`32bb393611538aed333cb53667a8edae1afc748d`. This is not a release receipt.
Hermes owns final gates, commit fallback, push, advisory/review routing and shipping.

## Consent re-confirmation

Customer create/edit and RO intake show **Customer agreed to texts**. Checking
requires **Verbal** or **Written**. Legacy TRUE, null, missing, or incomplete/invalid
provenance renders unchecked and unconfirmed. Only complete server provenance can
precheck a form. OCR fields cannot supply consent evidence; changing customer,
starting New, or applying OCR resets the prior attestation and method.

Unrelated saves omit all SMS fields. Returning to the original checkbox/method
also omits them. An intentional changed confirmation sends only `sms_consent: true`
and `sms_consent_method`; an intentional revocation sends only `sms_consent: false`.
Server Phase 1/2 code owns staff identity and timestamp. Frontend never submits
those evidence fields. New-customer intake sends attestation to POST /customers
once and omits it from POST /ros, avoiding a second timestamp/confirmation.
Existing confirmed intake does not refresh the timestamp or request confirmation.
Email consent remains independent; unrelated edits omit email/preferences as well.
STOP enforcement remains unchanged; re-confirmation does not clear a STOP record.

## Product switch and safe operational rollback

`PANEL_ESTIMATOR_ENABLED` is a **server environment variable**, default **ON**.
Trimmed, case-insensitive `false`, `0`, or `off` disables it. Other values, including
unset/empty, preserve ON behavior. **Restart all backend processes after changing
it.** The router resolves the value at startup, and both enforcement and availability
use that same value. Do not use a frontend/Vite variable as the control.

Authenticated `GET /api/estimate-items/panel-estimator/availability` returns
`{ "enabled": true|false }` with `Cache-Control: no-store`. This is the sole
availability exception to the estimator guard. Unauthenticated calls still fail
authentication. When OFF, all 15 estimator work endpoints return HTTP **503** with
`error` and `code` both **PANEL_ESTIMATOR_DISABLED**, before database work:

- Catalog/preset GET, create, version, archive and private cost config.
- Draft GET/save, preview, private cost summary/settings and revision commit.
- Quote JSON/PDF and approval-link creation/revocation.

EstimateBuilder shows only manual/insurance import until availability explicitly
returns boolean true. Disabled, pending, malformed or failed availability responses
hide Visual panels and do not mount PanelEstimator. Availability is checked on page
mount/RO change. Already-open clients may retain their visible editor until reload;
the server still rejects its work after restart. Reload to refresh the UI.

Rollback is **flag OFF + restart**, not database rollback. Preserve estimator tables,
presets, revisions, selected financial authority, payments, approval links/audit and
historical evidence. Do not delete data, clear the selected revision or run down
migrations. Existing money/RO reads keep using the stored selected revision; turning
off does not fall back to manual financial authority or reprice signed records.
Direct estimator quote endpoints are temporarily unavailable, but stored records
remain intact. Re-enable and restart to restore access.

**Existing public customer approval links intentionally continue** through their
separate public router, including reading/signing an already-issued quote. This
switch stops staff estimation/new quote and new link creation; it does not invalidate
issued approvals or roll back signed records. Existing expiry/revocation/conflict
rules remain in force. Staff link revocation on the guarded estimator router is also
unavailable while OFF. No public approval or financial service was changed here.

## Verification and remaining scope

Focused tests use Node **v22.23.2**, `env -i`, `NODE_ENV=test`, `CI=1`, mocked APIs/DB,
and no listening socket or external provider. Commands from repository root:

```sh
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node --test backend/test/panelEstimator.switch.test.js
cd frontend
env -i PATH=/opt/homebrew/opt/node@22/bin:/usr/bin:/bin NODE_ENV=test CI=1 /opt/homebrew/opt/node@22/bin/node node_modules/vitest/vitest.mjs run src/components/__tests__/AddROModal.feedback.test.jsx src/pages/__tests__/ConsentAndAvailability.phase3.test.jsx src/pages/__tests__/Customers.mobile.test.jsx src/pages/__tests__/EstimateBuilder.gapReview.test.jsx src/pages/__tests__/EstimateBuilder.phase31.test.jsx
```

Backend coverage traverses every actual estimator route's middleware/handler stack
for four OFF spellings (zero queries), authentication, default/explicit ON catalog
and normal validation/role rejection. Frontend rendered checks cover create/edit/
intake, exact consent payloads, legacy/provenance, unchanged confirmation, revocation,
method validation, customer/OCR reset, preserved email and editor non-mounting.
Final output and exit status are recorded in the CLAUDE.md phase log.

Ten changed files, including three focused test files. Safety-sensitive consent
provenance/timestamp behavior and access enforcement; exceeds the two-file review
threshold. No review requested by Codex. This phase does not resolve transactional
RO deletion, paid-RO technician deletion, payment overcharge or optional provider
abort (P3). Those remain subsequent remediation phases. Full gates, build/browser/
real-DB checks and broader older fixture updates remain Hermes/final-phase work.
In particular, `AddROModal.appraisal.test.jsx` still has older boolean-copy payload
expectations; update those in the deferred fixture pass. The prior 13+25 host checks
are parent-provided history, not rerun evidence for this phase.

Commit guard: `git add` failed with exit 128: unable to create
`/Volumes/Zordon Storage /openclaw-workspace/Revv/.git/worktrees/panel-estimator-20261001/index.lock`:
Operation not permitted. No staging/commit completed; HEAD remains the Phase 2 base.
Hermes must inspect the ten-file working diff, stage and commit on top (no amend or
rebase), then bind final gates to the resulting full SHA. No sandbox bypass attempted.
