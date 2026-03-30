# REVV Full Bug Fix — Colonel Zordon Dispatch

You are Claude Code (CW2) operating under Colonel Zordon's orders. Fix ALL issues listed below in the REVV codebase. Commit everything in logical groups. Do not skip anything. Do not invent new features — fix what is broken.

## REPO
Working directory: /Users/zordon/.openclaw/workspace/Revv

---

## BUG #1 — CRITICAL: Forgot-Password Never Sends Email
**File:** `backend/src/routes/auth.js` lines 121–135

The `/forgot-password` route generates a token and saves it to `password_reset_tokens` but NEVER calls sendMail. The `mailer.js` service exists and works. Fix: after saving the token, call `sendMail` with a password reset link.

- Import `sendMail` from `../services/mailer`
- Build reset URL: `${process.env.FRONTEND_URL || "https://revvshop.app"}/reset-password?token=${token}`
- Send email to `user.email` with subject "Reset your REVV password" and a clear HTML body containing the reset link
- Log the send outcome (Resend ID or error)
- If sendMail fails, still respond `{ ok: true }` (security: do not reveal if email exists/failed)

The `password_reset_tokens` table uses `SMALLINT DEFAULT 0` for `used`. The query `used = 0` is correct — no change needed there.

---

## BUG #2 — HIGH: Portal.jsx crashes when RO has pending parts (missing Clock import)
**File:** `frontend/src/pages/Portal.jsx`

`Clock` component is rendered inside the pending parts section but is not in the lucide-react import. Add `Clock` to the import line.

---

## BUG #3 — HIGH: Schedule.jsx — loadMonthShifts has no try/catch
**File:** `frontend/src/pages/Schedule.jsx`

`loadMonthShifts()` calls `api.get(...)` with no error handling. Wrap in try/catch. On error: set an error state or show a toast.

---

## BUG #4 — HIGH: TimeClock.jsx — deleteEntry has no try/catch
**File:** `frontend/src/pages/TimeClock.jsx`

`deleteEntry()` calls `api.delete(...)` + `refresh()` with no try/catch. Wrap in try/catch. Show user-visible error on failure.

---

## BUG #5 — HIGH: Users.jsx — deleteUser has no try/catch
**File:** `frontend/src/pages/Users.jsx`

`deleteUser()` calls `api.delete(...)` + `load()` with no try/catch. Wrap in try/catch. Show user-visible error on failure.

---

## BUG #6 — HIGH: ROPhotos.jsx — deletePhoto and load have no error handling
**File:** `frontend/src/components/ROPhotos.jsx`

- `deletePhoto()` has no try/catch
- `load()` has no `.catch()`

Fix both. On error: show user feedback (console.error at minimum, toast preferred).

---

## BUG #7 — MEDIUM: InspectionPublic.jsx — null crash on payload destructure
**File:** `frontend/src/pages/InspectionPublic.jsx`

After the `if (loading)` and `if (error)` early returns, `payload` is destructured but could still be null. Add: `if (!payload) return <div className="text-slate-400 text-center p-8">No inspection data found.</div>` before the destructure.

---

## BUG #8 — MEDIUM: ADASCalibration.jsx — Refresh button onClick unhandled rejection
**File:** `frontend/src/pages/ADASCalibration.jsx`

The Refresh button calls `loadQueue()` directly with no `.catch()`. Change onClick to: `onClick={() => loadQueue().catch(() => {})}` OR add a catch block inside loadQueue that sets error state.

---

## BUG #9 — MEDIUM: RODetail.jsx — advance() has no try/catch
**File:** `frontend/src/pages/RODetail.jsx`

`advance()` function uses `await api.put(...)` with no try/catch. Wrap in try/catch with user-visible error (toast or alert).

---

## BUG #10 — MEDIUM: RODetail.jsx — updatePartsReqStatus has no try/catch
**File:** `frontend/src/pages/RODetail.jsx`

`updatePartsReqStatus()` has no error handling. Wrap in try/catch.

---

## BUG #11 — MEDIUM: Performance.jsx — null crash on avg_hours_per_ro.toFixed()
**File:** `frontend/src/pages/Performance.jsx`

Line ~122: `stat.avg_hours_per_ro.toFixed(1)` crashes if value is null/undefined. Change to: `Number(stat.avg_hours_per_ro || 0).toFixed(1)`. Check line ~142 in the footer summary for the same pattern.

---

## BUG #12 — MEDIUM: Portal.jsx — missing .catch() on API calls in useEffect
**File:** `frontend/src/pages/Portal.jsx`

Both `api.get` calls in useEffect at lines ~40–41 have no `.catch()`. Add `.catch(() => {})` to both.

---

## BUG #13 — MEDIUM: RODetail.jsx — copyClaimLink() has no try/catch
**File:** `frontend/src/pages/RODetail.jsx`

`copyClaimLink()` calls `navigator.clipboard.writeText(url)` with no try/catch. Clipboard access can throw if permissions denied. Wrap in try/catch.

---

## BUG #14 — MEDIUM: StorageHold.jsx — load() has no catch, loadCharges has no try/catch
**File:** `frontend/src/pages/StorageHold.jsx`

- `load()` has try/finally but no catch — add a catch that sets error state or shows feedback
- `loadCharges()` has no try/catch at all — wrap in try/catch

---

## BUG #15 — MEDIUM: Settings.jsx — saveProfile has no try/catch
**File:** `frontend/src/pages/Settings.jsx`

`saveProfile()` calls `api.put(...)` with no error handling. Wrap in try/catch. Show error to user on failure.

---

## COMMIT STRATEGY
Group fixes logically:
1. `fix(auth): forgot-password now sends reset email via Resend`
2. `fix(portal): add Clock import, add .catch() to API calls`
3. `fix(error-handling): wrap async ops in try/catch across Schedule, TimeClock, Users, ROPhotos, RODetail, Performance, InspectionPublic, ADASCalibration, StorageHold, Settings`

---

## QA-CHECKLIST REQUIREMENTS
Before committing, verify:
- No new route missing auth middleware
- No user input interpolated into SQL (not parameterized)
- No secrets logged or returned in responses
- All new async functions have try/catch
- No double-send after async error

---

When completely finished, run:
openclaw system event --text "Done: REVV full bug fix — 15 issues fixed including forgot-password email, Portal Clock crash, and 13 missing try/catch handlers. Ready for smoke test." --mode now
