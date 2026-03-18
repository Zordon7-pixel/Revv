# REVV Full Code Audit — 2026-03-18

Audited by: Zordon (manual read of all pages + components)

---

## CRITICAL Issues (crashes app or page)

| File | Line | Type | Description |
|------|------|------|-------------|
| `pages/TechView.jsx` | 20-22 | **Hook Violation** | Early `return <Navigate>` on lines 21-22 happens BEFORE `useEffect` (line 37) and `useMemo` (line 41). React error #310. Any admin or non-tech user who hits `/tech` triggers this crash. |

---

## HIGH Issues (breaks a specific feature)

| File | Line | Type | Description |
|------|------|------|-------------|
| `pages/Customers.jsx` | 262 | Missing try/catch | `refreshCustomers()` has no error handling — if the API fails, the component throws unhandled rejection and the customer list silently breaks |
| `pages/Schedule.jsx` | ~170 | Missing dep | `load()` useEffect has `[monday, viewMode]` deps but calls `admin` which isn't in deps — stale closure risk on role change |
| `pages/RODetail.jsx` | ~150 | No catch on load | `load()` function has no try/catch — if `/ros/:id` returns 4xx/5xx, the page silently shows loading forever |
| `pages/Dashboard.jsx` | 62 | Async error swallowed | `loadDashboardData()` Promise.all — if `/reports/summary` (the non-caught one) fails, entire dashboard breaks |
| `pages/RODetail.jsx` | multiple | No catch on async ops | `addPart`, `updatePartStatus`, `deletePart`, `assignTech`, `saveTechNotes` have no try/catch — silent failures |

---

## MEDIUM Issues (silent failure, bad UX)

| File | Line | Type | Description |
|------|------|------|-------------|
| `pages/Customers.jsx` | 267 | Unguarded data | `refreshCustomers()` does `setCustomers(r.data.customers)` — if API returns unexpected shape, `.customers` is undefined, crashes the filter on line 272 |
| `pages/Schedule.jsx` | ~205 | Unguarded early auth | `loadAuthStatus()` runs `Promise.all` with no outer try/catch — if timeclock endpoint is down, auth badges silently don't render |
| `pages/RODetail.jsx` | ~82 | Missing `?` guard | `ro.log?.map(...)` is safe, but `ro.vehicle?.year` in JSX accesses deep without null check in all places |
| `pages/Dashboard.jsx` | 179 | UX gap | `if (!data) return loading...` — if API fails, user sees loading spinner forever with no error message |
| `components/PaymentPanel.jsx` | 68 | Env var fallback | `VITE_STRIPE_PUBLISHABLE_KEY || STRIPE_PUBLISHABLE_KEY` — `STRIPE_PUBLISHABLE_KEY` (without VITE_) is never accessible in Vite frontend. Second fallback always undefined. |
| `pages/Inventory.jsx` | — | API error state | Error state exists but no retry button — user is stuck if load fails |
| `pages/Goals.jsx` | — | Month navigation | Month picker is manual string input — no validation, invalid dates silently produce bad API calls |

---

## LOW Issues (edge cases)

| File | Line | Type | Description |
|------|------|------|-------------|
| `pages/RODetail.jsx` | — | UX | `sendForApproval` uses `alert()` for success — inconsistent with rest of app which uses toast |
| `pages/Customers.jsx` | — | UX | `addCustomer` and `deleteCustomer` use `alert()` — should be toasts |
| `pages/Schedule.jsx` | — | UX | `deleteShift` uses `confirm()` — inconsistent with rest of app |
| `components/PaymentPanel.jsx` | — | Edge case | If `stripePromise` is null (no key), `startCardPayment` correctly shows error, but no feedback on the button until clicked |
| `pages/TechWorkload.jsx` | — | UX | Drag-drop reorder has no visual confirmation of save |
| `pages/ADASCalibration.jsx` | — | Edge | `loadQueue` in useEffect has `.catch(() => setQueue([]))` — correct, but queue errors are silent with no user message |

---

## API Cross-Reference

All frontend API calls validated against `backend/src/app.js`. **All registered routes exist.** No missing backend endpoints found.

Routes confirmed:
- `/api/ros`, `/api/repair-orders`, `/api/customers`, `/api/vehicles`, `/api/reports`, `/api/dashboard`
- `/api/feedback`, `/api/market`, `/api/portal`, `/api/users`, `/api/parts`, `/api/catalog`
- `/api/timeclock`, `/api/schedule`, `/api/tracking`, `/api/sms`, `/api/diagnostics`
- `/api/claim-links`, `/api/photos`, `/api/parts-requests`, `/api/performance`, `/api/superadmin`
- `/api/settings`, `/api/goals`, `/api/appointments`, `/api/estimate-requests`, `/api/estimate-items`
- `/api/approval`, `/api/public`, `/api/payments`, `/api/adas`, `/api/estimate-assistant`
- `/api/inspections`, `/api/reviews`, `/api/v1`, `/api/notifications`, `/api/subscriptions`
- `/api/storage`, `/api/invoice`, `/api/comms`, `/api/inventory`

---

## Clean Pages (no issues found)

- ADASCalibration ✅
- ApprovalPortal ✅
- BookAppointment ✅
- ClaimPortal ✅
- EstimateBuilder ✅
- EstimateRequests ✅
- InspectionEditor ✅
- InspectionPublic ✅
- Invoice ✅
- Landing ✅
- Login ✅
- MonthlyReport ✅
- Onboarding ✅
- PartsOnOrder ✅
- Payments ✅
- Performance ✅
- Portal ✅
- Register / ShopRegister ✅
- Reports ✅
- ResetPassword ✅
- ReviewSubmit / Reviews ✅
- Settings ✅
- ShopProfile ✅
- StorageHold ✅
- SuperAdminLogin / SuperAdminDashboard ✅
- TimeClock ✅
- TrackPortal ✅
- Users ✅
- All components (AddROModal, CarryoverModal, ErrorBoundary, HelpPanel, InsurancePanel, Layout, NotificationBell, PaymentModal, ROPhotos, StatusBadge, TurnaroundEstimator, VehicleDiagram) ✅

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 6 |
| **Total** | **19** |

**Priority fix order:**
1. `TechView.jsx` — move early return AFTER all hooks (CRITICAL, takes 5 min)
2. `Customers.jsx` `refreshCustomers` — wrap in try/catch (HIGH)
3. `RODetail.jsx` `load()` — add try/catch (HIGH)
4. `Dashboard.jsx` — add error state instead of infinite spinner (MEDIUM)
5. `PaymentPanel.jsx` — remove dead env fallback (MEDIUM)
