# Parts customer notifications — corrected 2026-10-01

## Scope and consent limitation

An unchecked Notify customer control requests an outbound update for that save only. Save-only remains default. Only changed customer-visible status, ETA/source, checked quantities or customer note qualify; supplier/internal-only edits and carrier observations do not. Provider acceptance is not confirmed delivery.

`partsNotifications.js` requires literal channel consent TRUE, a compatible contact preference, a contact value and a shop switch that is not explicitly FALSE. Missing shop switch values do not themselves block sends. SMS additionally enforces plan entitlement and STOP suppression. These are boolean gates, **not proof of positive historical SMS consent**. Older defaults allowed TRUE without a recorded choice. New-path defaults are now FALSE, create requires explicit boolean TRUE, and legacy stored TRUE/FALSE/NULL and STOP records are preserved.

Source inspection of customer schema/migrations, customer/RO writes and STOP/START handling found no trustworthy positive historical SMS consent provenance: no durable link from a TRUE value to who consented, when, by what method and to which disclosure. STOP timestamps record opt-out, not opt-in; START removes suppression without creating that provenance. No tenant/database history was inspected. Parts SMS activation is held pending separate approved re-consent work: collect a fresh explicit in-person choice plus provenance, actual time and disclosure version; never fabricate timestamps or bulk-rewrite legacy values or STOP records.

## Delivery behavior and limits

A unique shop/part/revision claim prevents duplicate sends for one event, including ambiguous failures. It is **not a per-customer cooldown** across revisions or parts. Follow-up `NOTIFY-COOLDOWN` must define and test that limit before parts SMS activation. No automatic retries are added. An eight-second wait per channel bounds the caller's wait, not provider execution/cancellation; timeouts require verification before retry. Saving the part survives provider failure.

History stores channel outcomes and accepted provider references. The code does not deliberately copy recipient/body into notification result records, but provider references there are stringified/truncated, not cryptographically authenticated or allowlisted. This phase hardens only console logging in `mailer.js` and `sms.js`; it does not certify every persisted provider field. See follow-up `NOTIFY-REFERENCE-VALIDATION` in the disposition document.

Mailer no-config returns null. SMS no-config/suppression returns its existing failed outcome and body; provider exceptions preserve SMS reason or mailer's thrown error. Console logs now retain static outcomes, validated UUID email references, fixed-format Twilio message SIDs, bounded HTTP status and five-digit Twilio error codes. Raw addresses, phone numbers, subject/body, sender/auth data and provider messages/objects are excluded. Customer switches, provider calls, entitlement/STOP and returns remain unchanged.

## Evidence and activation boundary

The September 27 record reported 15 focused backend tests, 18 disposable PostgreSQL integration tests, 149 frontend tests and a build. These are historical reports, not final-candidate evidence. Current commands and the phase3 mocked privacy result are in [readiness remediation](READINESS-REMEDIATION-20261001.md); final-SHA receipts remain outside source.

OpenAI/eBay/Twilio/Resend remain **LIVE UNKNOWN**, excluded from live verification and activation. No provider calls, real messages, production access or configuration changes occur in this mission. This implementation does not add a runtime activation switch: existing explicit notification requests can still reach configured providers if someone activates/uses them. No newly enabled provider path is introduced here; keep activation held operationally. If future rollout needs an enforceable parts-specific hold, isolate that code scope for Codex rather than disabling unrelated messaging. Hermes owns commit/gates/advisory/final exact-SHA review; implementation and historical QA do not authorize deployment.
