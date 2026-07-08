# REVV — Launch Readiness Spec (what's actually missing to launch)
_Authored 2026-07-02 (Hermes). Supersedes the feature-gap framing in SPEC-missed-ops-engine.md as the LAUNCH priority. Missed-ops is post-launch offense; this doc is the go-live gate._

## 0. Corrected assessment (read this first)
After reading the actual codebase (not the old positioning spec), REVV is **feature-complete**, not feature-poor. 50+ backend routes (16.5k LOC), 50+ frontend pages. The competitor "gaps" I first listed already exist in-app:
- Digital Vehicle Inspection -> `inspections.js` + `InspectionEditor/Public.jsx` ✅
- Payments / text-to-pay -> `payments.js` + Stripe service + `PaymentModal` ✅
- QuickBooks -> REAL Intuit OAuth (`services/quickbooks.js`, 488 LOC) ✅ (needs prod creds)
- Two-way SMS + auto-reply + Messaging Service provisioning ✅ (needs A2P registration)
- Reviews/reputation, ADAS, supplements, scheduling/booking, inventory, floor mode, timeclock, owner KPIs, storage/total-loss, leads/CRM, superadmin/multi-tenant ✅

**So the launch blocker is NOT building features. It's productionizing integrations + a fresh QA.** Only two genuine feature-level stubs exist: parts catalog is MOCK data, and QuickBooks/A2P need external provisioning.

## 1. Launch-blocking items (must-do), in priority order

### Phase 0 — Fresh full QA + stale-audit reconciliation
- WHAT: run a current end-to-end QA against PROD env. The only QA/audit on file is 2026-03-18/03-30 and lists issues (TechView hook crash, missing try/catch in Customers/RODetail/Dashboard, Portal.jsx `Clock` import) that were likely fixed since. Verify each is closed on live; re-log anything still open.
- WHY: 3+ months of shipping with no fresh full QA. Can't launch on a stale ship-NO verdict.
- HOW: Claude Code QA lane, live dogfood of every authed screen at 375/768/1440px, seed demo, exercise each core flow (intake->estimate import->RO->parts->invoice->payment->portal->review).
- GATE: 0 CRITICAL, 0 unresolved HIGH, responsive proof attached; stale audit items each marked fixed/open.

### Phase 1 — SMS A2P 10DLC compliance [hard external blocker]
- WHAT: register Twilio A2P Brand + Campaign for REVV. Code already auto-provisions a Messaging Service + attaches numbers, but there is NO brand/campaign registration — US carriers filter/throttle unregistered A2P traffic.
- WHY: REVV is comms-heavy (status SMS, approvals, text-to-pay). Unregistered = messages silently dropped for real shops. This is the #1 thing that breaks quietly in production.
- HOW: register brand/campaign (sole-prop or Madera Technologies EIN), wire campaign SID into Messaging Service, confirm opt-in/opt-out (STOP/HELP) + SMS Terms page (already exists). See twilio-a2p-messaging skill.
- GATE: a live test number sends+receives without carrier filtering; opt-out honored; campaign APPROVED.

### Phase 2 — Payments go-live verification
- WHAT: confirm Stripe is in LIVE mode end-to-end (live secret + webhook secret on Railway), test a real charge + refund + webhook event, verify Connect/payout config if shops receive funds.
- WHY: Stripe key is env-driven — easy to launch still pointing at test keys. Silent revenue failure.
- HOW: verify Railway env, run a $1 live charge on demo, confirm webhook lands, refund it.
- GATE: live charge + webhook + refund all verified on prod.

### Phase 3 — QuickBooks production enablement (or honest gate)
- WHAT: provision Intuit production app credentials (QUICKBOOKS_CLIENT_ID/SECRET/REDIRECT_URI/ENV — NOT in .env.example today), pass Intuit's production app review, OR gate the QuickBooks connect button behind "Coming soon" until approved.
- WHY: the OAuth code is real but non-functional without creds + Intuit review. Selling "QuickBooks sync" that 500s on connect is worse than not listing it.
- HOW: create Intuit production app, add creds to Railway, run OAuth connect on demo shop, verify one invoice syncs. If review lags, feature-flag it off.
- GATE: either a real invoice syncs to a QBO sandbox->prod account, or the UI honestly shows not-yet-available.

### Phase 4 — Parts catalog: real or honest
- WHAT: `services/partsCatalog.js` returns MOCK_PARTS. Either integrate a real supplier (PartsTech/Nexpart) or reposition parts as manual/inventory-entry and remove any implication of live supplier lookup.
- WHY: a shop searching parts and getting fake results erodes trust instantly. Mock data cannot ship as a live feature.
- HOW: decision first (integration cost vs scope). v1 recommendation: keep parts as manual + inventory-driven, clearly labeled; defer live supplier API to post-launch.
- GATE: no mock data presented as live supplier results anywhere in the UI.

### Phase 5 — Estimate import (OCR) reliability [headline feature]
- WHAT: harden CCC ONE PDF extraction (`insuranceOcr.js` 1065 LOC + `bmsParser.js`). Per prior decision, BMS is abandoned; Miles gets insurer-written CCC ONE PDFs only — extraction quality IS the product.
- WHY: "bring your CCC estimate" is the core adoption hook. If import is unreliable, the whole positioning collapses.
- HOW: build a fixture set of real CCC ONE PDFs, measure field-level extraction accuracy (parts, ops, labor, totals), fix the worst-miss fields, add a manual-correct step in the import wizard for low-confidence fields.
- GATE: measured extraction accuracy on the fixture set meets an agreed bar (e.g. >90% line capture) with a human-correct fallback for the rest.

### Phase 6 — Production hardening
- WHAT: rate-limit + abuse protection on public AI/OCR/estimate-request endpoints (cost + abuse surface); confirm Sentry (`lib/sentry.js`) is live with alerting; verify DB backups/restore on Railway; CORS locked to prod origin.
- WHY: public endpoints hitting paid AI (Anthropic) are a cost/DoS risk; no monitoring = blind launch.
- HOW: add per-IP/shop rate limits, confirm Sentry DSN set + a test error surfaces, run a backup+restore drill.
- GATE: public AI endpoints rate-limited; a forced error appears in Sentry; a restore succeeds.

## 2. Explicitly NOT launch-blocking (post-launch backlog)
- Missed-Ops / Supplement Intelligence engine (SPEC-missed-ops-engine.md) — differentiation offense, build after paying shops onboard.
- Live parts supplier API (PartsTech/Nexpart).
- AI damage-photo cost prediction; 3D visualizer.

## 3. Launch definition of done
A new shop can: sign up self-serve, import their CCC estimate reliably, run an RO end-to-end, message the customer via a registered A2P number, take a live payment, and (optionally) sync to QuickBooks — with 0 CRITICAL bugs, monitoring on, and no mock data shown as real. Everything else is enhancement.
