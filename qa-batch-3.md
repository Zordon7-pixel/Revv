# REVV QA Batch 3 — Reports through Users + All Components
_Audited: 2026-03-18_

## Summary
- CRITICAL: 0
- HIGH: 4
- MEDIUM: 7
- Total files audited: 31

## Issues

### HIGH

#### Schedule.jsx — loadMonthShifts has no try/catch
- **File:** `frontend/src/pages/Schedule.jsx`
- **Line:** 199–206
- **Severity:** HIGH
- **Issue:** `loadMonthShifts()` is an async function that calls `api.get(...)` with no try/catch block. If the request fails, the error is unhandled and will propagate as an unhandled promise rejection. This function is called from two `useEffect` hooks (lines 209–212 and 226), and from the `load()` function. A network failure here will crash silently with no user feedback.

#### TimeClock.jsx — deleteEntry has no try/catch
- **File:** `frontend/src/pages/TimeClock.jsx`
- **Line:** 214–218
- **Severity:** HIGH
- **Issue:** `deleteEntry()` calls `api.delete(...)` and then `refresh()` with no try/catch wrapper. If either call fails (network error, server error), the error propagates as an unhandled rejection with no user-visible error message.

#### Users.jsx — deleteUser has no try/catch
- **File:** `frontend/src/pages/Users.jsx`
- **Line:** 43–47
- **Severity:** HIGH
- **Issue:** `deleteUser()` calls `api.delete(...)` and `load()` with no try/catch. A server error (e.g., attempting to delete the last owner) will produce an unhandled promise rejection with no feedback to the user.

#### ROPhotos.jsx — deletePhoto has no try/catch
- **File:** `frontend/src/components/ROPhotos.jsx`
- **Line:** 46–49
- **Severity:** HIGH
- **Issue:** `deletePhoto()` calls `api.delete(...)` and then `load()` with no try/catch wrapper. A failed delete request (auth error, server error) results in an unhandled rejection. The `load()` function itself also has no error handling.

---

### MEDIUM

#### Schedule.jsx — load() missing try/catch for week view path
- **File:** `frontend/src/pages/Schedule.jsx`
- **Line:** 214–225
- **Severity:** MEDIUM
- **Issue:** The `load()` function's week-view path (the `Promise.all` on lines 219–224) has no try/catch. The month-view branch delegates to `loadMonthShifts()` (also unguarded). A network failure here gives no error state or user feedback.

#### StorageHold.jsx — load() has finally but no catch
- **File:** `frontend/src/pages/StorageHold.jsx`
- **Line:** 27–39
- **Severity:** MEDIUM
- **Issue:** The `load()` function has `try/finally` but no `catch`. If `api.get('/storage')` or `api.get('/storage/summary')` fails, `setLoading(false)` is called but there is no error state set and no user feedback. The component will silently show an empty list rather than an error.

#### StorageHold.jsx — loadCharges has no try/catch
- **File:** `frontend/src/pages/StorageHold.jsx`
- **Line:** 43–45
- **Severity:** MEDIUM
- **Issue:** `loadCharges()` is an async function with no try/catch. It is called both directly and inside an inline async arrow function in the JSX (line 160). A failed request produces an unhandled rejection with no user feedback.

#### Settings.jsx — saveProfile has no try/catch
- **File:** `frontend/src/pages/Settings.jsx`
- **Line:** 220–224
- **Severity:** MEDIUM
- **Issue:** `saveProfile()` calls `api.put('/users/me', profile)` with no try/catch. If the request fails, there is no error handling — the promise rejection is unhandled and `profileSaved` will never be set, leaving the UI in an inconsistent state with no error message.

#### SuperAdminDashboard.jsx — selectShop catch swallows error silently
- **File:** `frontend/src/pages/SuperAdminDashboard.jsx`
- **Line:** 61–73
- **Severity:** MEDIUM
- **Issue:** The `selectShop()` catch block sets `shopDetail` to `null` but does not set any error state or display a message to the user. A failed detail load is completely invisible.

#### TrackPortal.jsx — loadData not wrapped in useEffect try/catch boundary
- **File:** `frontend/src/pages/TrackPortal.jsx`
- **Line:** 46–55
- **Severity:** MEDIUM
- **Issue:** `loadData` is defined as a `const` arrow function outside `useEffect` and called inside it. While it does have a try/catch internally, the outer `useEffect` at line 57–59 calls it without `await` and without its own try/catch. If `loadData` itself throws synchronously before the try block (e.g., a runtime error), the `useEffect` will produce an unhandled rejection. Low probability but worth noting.

#### ROPhotos.jsx — load() defined without try/catch
- **File:** `frontend/src/components/ROPhotos.jsx`
- **Line:** 19–20
- **Severity:** MEDIUM
- **Issue:** The `load` function (a one-liner arrow using `.then()`) has no `.catch()` chained. If `api.get(...)` fails, the error is silently swallowed. This function is called from `useEffect`, from `handleUpload`, and from `deletePhoto`. Any photo-load failure produces no user-visible feedback.

---

## Clean Files
The following files were audited and had **no hook violations, no conditional hooks, and no significant missing error handling or null crash issues**:

- `frontend/src/pages/Reports.jsx`
- `frontend/src/pages/ResetPassword.jsx`
- `frontend/src/pages/ReviewSubmit.jsx`
- `frontend/src/pages/Reviews.jsx`
- `frontend/src/pages/Settings.jsx` *(note: saveProfile medium issue above)*
- `frontend/src/pages/ShopProfile.jsx`
- `frontend/src/pages/ShopRegister.jsx`
- `frontend/src/pages/SuperAdminLogin.jsx`
- `frontend/src/pages/TechView.jsx`
- `frontend/src/pages/TechWorkload.jsx`
- `frontend/src/pages/TimeClock.jsx` *(note: deleteEntry HIGH issue above)*
- `frontend/src/pages/TrackPortal.jsx` *(note: medium issue above)*
- `frontend/src/pages/Users.jsx` *(note: deleteUser HIGH issue above)*
- `frontend/src/components/AddROModal.jsx`
- `frontend/src/components/CarryoverModal.jsx`
- `frontend/src/components/ErrorBoundary.jsx`
- `frontend/src/components/HelpPanel.jsx`
- `frontend/src/components/InsurancePanel.jsx`
- `frontend/src/components/Layout.jsx`
- `frontend/src/components/LibraryAutocomplete.jsx`
- `frontend/src/components/NotificationBell.jsx`
- `frontend/src/components/PaymentModal.jsx`
- `frontend/src/components/PaymentPanel.jsx`
- `frontend/src/components/PartsSearch.jsx`
- `frontend/src/components/TurnaroundEstimator.jsx`
- `frontend/src/components/VehicleDiagram.jsx`
- `frontend/src/contexts/LanguageContext.jsx`
