# QA-CHECKLIST.md — Revv

Run through every item for every diff. CRITICAL items block ship. HIGH items must be noted in report.

> **For ship-readiness / pre-launch / full-QA runs, use the `pre-launch-audit` skill instead.** It supersets this checklist (adds mobile UI on iPhone, currency formatting, schema drift, cron health, etc.). Bryan invokes it via "do a full QA of Revv" or `/pre-launch-audit revv`. This checklist remains the floor for per-diff reviews in the build pipeline.

---

## Dispatch De-Dupe Preflight (Run First)

- [ ] Read latest `CLAUDE.md` Dispatch Log entry before opening new dispatches
- [ ] If issue is marked **DONE + VERIFIED**, require new repro evidence (timestamp + steps + screenshot/log) before redispatch
- [ ] Confirm whether issue is **new**, **regression**, or **not reproduced**
- [ ] Add result to QA report so same job is not dispatched twice

---

## CRITICAL — Block ship if any are true

- [ ] DELETE or UPDATE query missing `AND shop_id = $N` ownership check
- [ ] User input string-interpolated into SQL (not parameterized)
- [ ] New route missing `auth` middleware
- [ ] Admin-only route missing `requireAdmin` middleware
- [ ] Hardcoded shop ID or user ID in query
- [ ] `catch` block that swallows errors silently (empty body or only `return`)
- [ ] JWT secret, API key, or credential logged or returned in response

## HIGH — Flag in report, must fix before next build

- [ ] Missing input validation on user-facing numeric fields (no range check)
- [ ] Missing null/undefined check before `.property` access on DB result
- [ ] SMS send with no logging of outcome (success SID or error reason)
- [ ] New async function with no try/catch
- [ ] Response sent after async error (double-send crash)
- [ ] `dbGet` result used without null check

## MEDIUM — Note in report

- [ ] Error message leaks internal details (stack trace, file path, DB query)
- [ ] Missing rate limiting on new auth-adjacent endpoint
- [ ] Frontend API call with no error state shown to user
- [ ] Unused import or variable left in
- [ ] Console.log left in that outputs sensitive data

---

## Revv-Specific Patterns to Watch

- `queueStatusSMS` — must log at every gate, not silently bail
- Twilio send — must log outcome with SID or error reason
- RO status changes — must include shop_id scope on all queries
- Customer lookup — must scope to shop via repair_orders join, not direct
