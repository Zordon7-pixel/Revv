# REVV Inbound SMS Auto-Reply (customer-safe acknowledgement)

> Backend-only. Builds on the working inbound webhook (`POST /api/sms/webhook`) which already saves inbound rows + returns empty TwiML. Goal: send ONE safe automated acknowledgement when a customer texts in and no human is actively replying — without spamming, without impersonating a live person, and STOP/HELP-compliant.

## Current state (verified)
- `backend/src/routes/sms.js` webhook: finds shop by `To`, matches RO by `From` phone, inserts `sms_messages` (direction `inbound`, status `received`), then returns `<Response></Response>` (no reply). Keep the empty-TwiML response.
- `backend/src/services/sms.js`: `sendSMS(phone,message,{shopId})` (env/db Twilio config) + `messageWithComplianceFooter()` which AUTO-APPENDS `Reply STOP to opt out, HELP for help.` for customer-facing sends (so auto-reply copy MUST NOT include that line — it gets appended).
- `sms_messages(id, shop_id, ro_id, direction CHECK in(outbound,inbound), from_phone, to_phone, body, twilio_sid, status DEFAULT 'sent', created_at)`. `status` is free-text → use `status='auto_reply'` to mark auto-reply rows (NO migration needed for dedup).
- Existing tests: `__tests__/sms-compliance.test.js`, `__tests__/customerOptInConfirmation.test.js` (injects a `send` fn — follow this mock pattern).
- Toll-free number `+18668259523`: Twilio's default Advanced Opt-Out handles STOP/HELP at the carrier level for toll-free, so REVV must NOT send its own STOP/HELP reply (would double up).

## Design decisions

### 1. Copy (base; footer auto-appended)
`Thanks — {shopName} received your message. A team member will review it and follow up during business hours.`
- `shopName` = `shops.name` for the matched shop; fallback `our shop` if null. Do NOT hardcode "Miles".
- Result after `messageWithComplianceFooter` (customerFacing): `...business hours.\n\nReply STOP to opt out, HELP for help.`
- Sounds automated ("received your message", "will review"), not a live human; names the shop; no internal data.
- Export the base template as a const for tests.

### 2. Auto-reply ONLY when ALL true
- valid external `From` (E.164) + non-empty `Body`.
- shop found for `To` AND SMS configured for that shop.
- `From` !== the shop's own Twilio number (no self/loop).
- `Body` is NOT a STOP/HELP/START keyword (handled separately — see §4).
- `From` is NOT opted out for this shop (no row in `sms_opt_outs`).
- NO manual staff outbound to `From` in the last 30 min (status not 'auto_reply') — a human is actively engaged, don't step on it.
- NO auto-reply (`status='auto_reply'`) to `From` in the last 12 h (dedup window).

### 3. NEVER auto-reply when
- any §2 condition fails; STOP/HELP/keyword; opted out; recent manual staff reply; within 12h dedup; self/loop; missing From/Body; shop missing/unconfigured. In all these, STILL save the inbound row and STILL return empty TwiML 200.

### 4. HELP / STOP / START
- Detect (case-insensitive, trimmed, whole-message) keyword classes:
  - STOP-class: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT → upsert into `sms_opt_outs(shop_id, phone)`, send NO REVV reply (Twilio sends the unsubscribe confirmation).
  - START-class: START, UNSTOP, YES → delete the opt-out row (resubscribe), send NO REVV reply.
  - HELP-class: HELP, INFO → send NO REVV reply (Twilio sends help).
- `sendSMS` MUST check `sms_opt_outs` and refuse to send to an opted-out (shop,phone) → return `{ok:false, reason:'opted_out'}` (belt-and-suspenders; Twilio also blocks). Make this check skip-able for the opt-in confirmation path only if needed, but default-on.

### 5. Dedup / spam prevention
- Auto-reply outbound rows are inserted with `status='auto_reply'`.
- Pre-send query: exists `sms_messages` where shop_id=shop, to_phone=From, direction='outbound', status='auto_reply', created_at > now()-interval '12 hours' → skip.
- Active-human query: exists outbound to From in last 30 min with status != 'auto_reply' → skip.

## Implementation
- New module `backend/src/services/smsAutoReply.js`: pure-ish `maybeSendInboundAutoReply({ shop, from, to, body, db, send, now })` — injectable `db` (query helpers) + `send` (defaults to real `sendSMS`) so it is unit-testable like `customerOptInConfirmation`. It runs the §2-§5 decision, records opt-out/resubscribe, and on send inserts the outbound `status='auto_reply'` row. Returns `{action:'auto_reply'|'opt_out'|'resubscribe'|'help'|'suppressed', reason}`.
- Wire it into the webhook AFTER the existing inbound insert, inside the `if (shop)` block, wrapped in try/catch so a failure never breaks the 200/empty-TwiML response.
- Add `sms_opt_outs` table in `backend/src/db/migrate.js`: `(shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE, phone TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (shop_id, phone))`.
- Add the opt-out suppression check inside `sendSMS` (services/sms.js).
- Keep the webhook returning empty TwiML in ALL paths. Backend only — no UI change (auto-reply + inbound already show in the existing `/api/sms/inbox`).

## Tests (node:test, mocked — NO real Twilio, NO real customer)
New `backend/src/__tests__/smsAutoReply.test.js` with injected `db` + `send` mocks:
1. First inbound from a fresh number → `send` called once with the exact base copy incl. resolved shopName; an `status='auto_reply'` row recorded.
2. Second inbound within 12h → `send` NOT called (dedup).
3. STOP inbound → opt-out upserted, `send` NOT called.
4. After STOP, a normal inbound from same number → `send` NOT called (opted out).
5. START after STOP → opt-out removed, `send` NOT called.
6. HELP inbound → `send` NOT called.
7. From === shop's own number → `send` NOT called (loop guard).
8. Recent manual staff outbound (<30m, status!='auto_reply') → `send` NOT called (human active).
9. `sendSMS` returns `{ok:false, reason:'opted_out'}` for an opted-out number (mock the opt-out lookup).
10. Decision never throws on missing shop/from/body; webhook contract (empty TwiML 200, inbound still saved) preserved — assert via a webhook-level test or by asserting the function is side-effect-safe.
Keep existing sms-compliance + opt-in tests green.

## DoD
- `node --check` touched files; `node --test backend/src/__tests__/*.test.js` green (incl. new + existing SMS tests); frontend untouched (no FE build needed) but run `npm run test:run`/`build` if any FE file changes.
- Independent Claude Code QA (opus-4-8): confirm STOP/HELP correctness, dedup, opt-out suppression in sendSMS, loop guard, empty-TwiML preserved, no secret exposure, no customer-data mutation beyond sms_messages + sms_opt_outs.
- DEPLOY HELD for Bryan's explicit OK — this is customer-facing copy going to REAL Miles customers. No real-customer messages during tests.

## Out of scope
Business-hours time logic; AI/LLM replies; inbox UI redesign; per-shop custom copy editor (future).
