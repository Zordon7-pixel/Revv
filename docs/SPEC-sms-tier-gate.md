# REVV SMS Tier Gate — SMS is a paid-tier feature (pro/agency), free excluded, Miles grandfathered

> Backend-only. Makes outbound SMS + inbound auto-reply a paid feature: only shops on **pro** or **agency** (or an explicit complimentary override) may send. **Free shops cannot send.** Miles is a permanent free comp shop and MUST keep SMS — grandfathered by its toll-free number so it can never be cut off.

## Decision (from Bryan)
- SMS feature = **pro (tier2) + agency (tier3)** only. **Free = no SMS.**
- **Miles will always be free but keeps SMS** → needs a per-shop complimentary override.
- OPEN QUESTION for Bryan (flag, do not assume): does a **free shop inside its 14-day trial** get SMS as a teaser? This spec gates STRICTLY (free = no SMS, trial or not, unless comp). If Bryan wants trial-included, change `smsEntitled` to also allow an active trial.

## Existing pieces to reuse (verified)
- `backend/src/middleware/planGuard.js` → `requirePlan(minPlan)` (rank-checks `shop.plan`).
- `shops.plan TEXT DEFAULT 'free'`, plans: free / pro / agency. `trial_ends_at` exists.
- `shops.twilio_phone_number` — Miles' is `+18668259523` (stable grandfather key).
- SMS send path: `backend/src/services/sms.js` `sendSMS()`; auto-reply: `backend/src/services/smsAutoReply.js`; routes: `backend/src/routes/sms.js`.

## Build (backend only)
1. **Migration** (`backend/src/db/migrate.js`): 
   - `ALTER TABLE shops ADD COLUMN IF NOT EXISTS sms_comp BOOLEAN DEFAULT FALSE` (complimentary SMS override).
   - Grandfather Miles (idempotent, safe to re-run every boot): `UPDATE shops SET sms_comp = TRUE WHERE twilio_phone_number = '+18668259523' AND sms_comp IS DISTINCT FROM TRUE`.
2. **Entitlement helper** in `services/sms.js` (export it): `function smsEntitled(shop){ return shop && (shop.plan === 'pro' || shop.plan === 'agency' || shop.sms_comp === true); }`. Treat missing plan as 'free' (not entitled).
3. **Gate the send path:** in `sendSMS`, after resolving the shop, if NOT `smsEntitled(shop)` return `{ ok:false, reason:'sms_not_entitled' }` BEFORE calling Twilio. (Fetch the shop's plan + sms_comp; reuse the existing shop lookup so it's one query.) This naturally also stops auto-replies, opt-in confirmations, and notifications for non-entitled shops — correct.
4. **Auto-reply path** (`smsAutoReply.js`): also short-circuit to `{action:'suppressed', reason:'not_entitled'}` when the shop isn't entitled (so it never even composes a reply). STOP/START opt-out RECORDING should still run regardless (compliance), but no send.
5. **/api/sms/status**: add an `entitled` boolean (computed via smsEntitled) + `plan` so the UI/admin can see why SMS is/ isn't active. `/api/sms/test`: if not entitled, return 402/403 with `{error:'SMS requires the Pro or Agency plan.'}`.
6. Do NOT change Twilio creds/env, plan/Stripe logic, or any customer/RO data. Only add the column + grandfather Miles + the entitlement checks.

## Tests (node:test, mocked)
`backend/src/__tests__/smsTierGate.test.js` (+ extend existing where natural):
- `smsEntitled`: true for plan 'pro', true for 'agency', true for free+sms_comp, FALSE for free (no comp), FALSE for missing/undefined plan.
- `sendSMS` returns `{ok:false, reason:'sms_not_entitled'}` (twilio NOT called) for a free non-comp shop; sends normally for pro/agency/comp.
- Auto-reply suppressed `reason:'not_entitled'` for free non-comp shop; STOP still records opt-out even when not entitled.
- Grandfather: assert the migration statement targets `twilio_phone_number = '+18668259523'` (string-level test acceptable).
Keep all existing SMS tests (compliance, opt-in, smsAutoReply — 46 currently) green.

## DoD + ship safety
- `node --check` + `node --test backend/src/__tests__/*.test.js` all green.
- Independent Claude Code QA (opus-4-8): confirm free is blocked, pro/agency allowed, **Miles (comp) NOT broken**, opt-out recording preserved, no regression to the 46 SMS tests, no secret/customer-data changes.
- **Ship-safety check before deploy:** the grandfather `UPDATE` must keep Miles (`+18668259523`) entitled. After deploy, verify Miles' `/api/sms/status` shows `entitled:true`. If anything is uncertain about cutting Miles off, HOLD and flag.

## Out of scope
Trial-as-teaser logic (pending Bryan's answer); UI upgrade-prompt/paywall screen; per-feature granular entitlements beyond SMS.
