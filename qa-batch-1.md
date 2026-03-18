# QA Batch 1 — Hook Violations & Broken Code
**Files audited:** ADASCalibration, ApprovalPortal, BookAppointment, ClaimPortal, Customers, Dashboard, EstimateBuilder, EstimateRequests, Goals, InspectionEditor, InspectionPublic, Inventory, Invoice

---

## CRITICAL — 0 issues

None found.

---

## HIGH — 0 issues

None found.

---

## MEDIUM — 2 issues

### 1. `InspectionPublic.jsx` line 46 — NULL CRASH
**Category:** NULL_CRASH
**Description:** After the two early returns (`if (loading)` and `if (error)`), `payload` is destructured directly with no null guard:
```js
const { shop, vehicle, ro, inspection } = payload  // line 46
```
`payload` is initialized to `null`. If the API call resolves successfully but returns `null` (e.g., empty body or unexpected shape), `loading` becomes `false` and `error` stays `''`, so both early returns are skipped — then destructuring `null` throws `TypeError: Cannot destructure property 'shop' of null`.
**Fix:** Add `if (!payload) return <...error state...>` before line 46, or use optional chaining in the destructure.

---

### 2. `ADASCalibration.jsx` line 111 — MISSING ERROR HANDLING (onClick)
**Category:** MISSING TRY/CATCH (unhandled Promise rejection)
**Description:** The `loadQueue` function has `try/finally` but no `catch`. The `useEffect` callsite correctly adds `.catch(() => setQueue([]))`, but the Refresh button calls it without any handler:
```js
<button onClick={() => loadQueue()}>Refresh</button>  // line 111
```
If the API fails on a manual refresh, the rejected Promise is unhandled (no error is shown to the user, and no catch for the rejection).
**Fix:** Either add `.catch()` at the callsite: `onClick={() => loadQueue().catch(() => {})}`, or add a `catch` block inside `loadQueue` itself that sets an error/toast state.

---

## LOW — 0 additional issues

No conditional hooks, no hooks-after-early-return (React Error #310) violations, and no `.map()` on unguarded null arrays were found in any of the 13 files.

---

## File-by-file summary

| File | Hook Violations | Conditional Hooks | Missing Try/Catch | Null Crashes |
|---|---|---|---|---|
| ADASCalibration.jsx | ✅ None | ✅ None | ⚠️ onClick Refresh unhandled | ✅ None |
| ApprovalPortal.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| BookAppointment.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| ClaimPortal.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| Customers.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| Dashboard.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| EstimateBuilder.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| EstimateRequests.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| Goals.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| InspectionEditor.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| InspectionPublic.jsx | ✅ None | ✅ None | ✅ None | ⚠️ payload destructure |
| Inventory.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
| Invoice.jsx | ✅ None | ✅ None | ✅ None | ✅ None |
